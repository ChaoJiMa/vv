"""报告会话：分离完整本地历史、受控AI分析和旧版枚举模板协议。"""

from datetime import datetime, timezone

from report_assistant.security.privacy import TEMPLATES, approved_request, choose_template
from report_assistant.conversation.questions import LocalQuery, LocalQuestionResolver
from report_assistant.conversation.analysis import AnalysisContext, AnalysisFailure, AnalysisStrategy
from report_assistant.security.privacy import PrivacyError
from report_assistant.conversation.service import local_service_topic, service_reply
from report_assistant.reports.score import score_family


class Conversation:
    """一份报告对应一个会话，按策略管理完整本地历史和最小模型上下文。"""

    def __init__(self, tools, history=None, strategy="template"):
        """绑定本地报告工具，可选从加密存储恢复该报告最近的完整问答。"""
        self.tools = tools
        self.history = history
        # public_history 只放 PublicRequest 枚举；local_history 可含个人信息，
        # 仅供本地回看。不能把两者合并后直接交给模型 SDK。
        self.public_history = []
        self.local_history = history.read(tools.history_scope) if history else []
        self.last_request = None
        self.last_fields = []
        self.last_query = None
        self.resolver = LocalQuestionResolver(tools)
        if strategy not in {"template", "analysis"}:
            raise ValueError("未知问答策略。")
        # 默认参数保留旧Python调用契约；终端入口显式使用analysis，新策略可被独立回归。
        self.strategy = strategy
        self.analysis = AnalysisStrategy(tools) if strategy == "analysis" else None
        self.analysis_context = None
        # 重启后只恢复用户可回看的本地历史。模型上下文从空白开始。

    def _local_query(self, question, request, previous=None):
        """本地模式/失败回退解析问题；匹配结果不授予原始字段外发资格。"""
        if request:
            fields = self.tools.topic_fields(request.topic, request.window)
            scope = [item for chosen in fields for item in self.resolver.metric_scope(chosen)]
            message = "" if fields else self.resolver.guidance("当前报告未登记该指标或指定周期，不能据此判断为0。")
            return LocalQuery(fields, scope, request.operation, message)
        return self.resolver.resolve(question, previous if previous is not None else self.last_query)

    def answer(self, question, client=None, model=None):
        """按策略生成一轮答案；只有加密保存成功才提交内存及追问上下文。

        analysis模式允许过滤四类个人信息后的报告事实参与模型分析；以下保留的template分支
        仍在本地取值前结束模型调用。保存失败由main停止处理，不生成明文备用。
        """
        if not isinstance(question, str) or not question.strip() or len(question) > 2000:
            raise ValueError("问题必须为1到2000字的文本。")
        if self.strategy == "analysis":
            return self._analysis_answer(question, client, model)
        # approved_request 返回有限枚举或 None；None 表示本轮必须在本地处理。
        # last_request 只帮助解析“这个指数呢”等指代，不保存原始问题或报告值。
        request = approved_request(question, self.last_request)
        template = TEMPLATES[0]
        if request and client is not None:
            try:
                template = choose_template(client, model, self.public_history, request)
            except Exception:
                # SDK/传输异常可能包含请求头、URL和响应正文，禁止打印或回传。
                # 模型失败不会把原问题作为“重试”发出，改用本地固定表达。
                template = TEMPLATES[0]
        # 模型调用到此结束；下面产生的字段、值、缺失状态和异常不再进入网络请求。
        query = self._local_query(question, request)
        fields = query.fields
        local_result = self.tools.render(fields, query.operation) if fields else ""
        if query.message:
            local_result = query.message + ("\n" + local_result if local_result else "")
        # 模型只选表达模板，真正报告值到这里才填进占位符，最终答案不再回传。
        answer = template.replace("{{local_result}}", local_result)
        entry = {
            "time": datetime.now(timezone.utc).isoformat(),
            "question": question, "answer": answer,
        }
        if self.history:
            # 保存成功后再提交内存历史；保存失败不会生成明文备用文件。
            self.history.append(self.tools.history_scope, entry)
        self.local_history.append(entry)
        self.last_fields = fields
        self.last_query = query
        # 本地未知问题和选字段操作会改变话题，清掉旧指代，避免串到上一字段。
        self.last_request = request
        if request:
            self.public_history.append(request)
            self.public_history = self.public_history[-8:]
        return answer

    def _analysis_answer(self, question, client, model):
        """执行AI策略或本地命令；加密保存成功后才更新上下文，失败不部分提交。"""
        context, notice, answer = None, "", None
        query = LocalQuery()
        local_command = question.strip().startswith("/") or question.strip().startswith("选择第")
        # 完整常见客服短句在本地回复；身份标签查询也不必带着原文进入模型。
        # 复合问题不截断，仍由既有隐私检查和语义路由处理。
        service_topic = None if local_command else local_service_topic(question)
        if service_topic:
            answer = service_reply(service_topic)
        if answer is None and client is not None and not local_command:
            try:
                self.analysis.guard.question(question)
            except PrivacyError:
                notice = "问题含可能的个人信息，本轮已留在本地；请去掉个人信息后再让AI分析。"
            else:
                try:
                    answer, context = self.analysis.answer(question, client, model, self.analysis_context)
                except AnalysisFailure as error:
                    # 只显示程序封闭分类，不拼接SDK错误或模型响应正文。
                    notice = str(error)
                except PrivacyError:
                    notice = "AI请求或工具返回未通过本地校验，本轮改用本地查询。"
                except Exception:
                    # SDK正文和模型协议异常只触发固定提示，不输出异常、不带原问题重试。
                    notice = "AI分析暂不可用，本轮改用本地查询。"
        if answer is None:
            request = approved_request(question, self.last_request)
            previous = None
            if (not local_command and self.analysis_context is not None
                    and len(self.analysis_context.field_refs) == 1):
                # AI正常回答不建立本地字段选择；后续模型失败时，仍按已核验引用恢复
                # 单一指代对象；整份报告或多指标不能自行选一个，也不能展开全部内容。
                fields = [self.analysis.projection.fields[ref]['local']
                          for ref in self.analysis_context.field_refs if ref in self.analysis.projection.fields]
                previous = LocalQuery(fields, [item for field in fields for item in self.resolver.metric_scope(field)])
            query = self._local_query(question, request, previous)
            if not local_command:
                # 所有自然指标问答统一走页面结果出口；模型失败不能暴露原值和代码规则。
                answer = self.analysis.projection.customer_answer(query.fields)
                if (len(query.fields) == 1 and score_family(query.fields[0], self.tools.theme)
                        and not notice.startswith("问题含可能")):
                    notice = ""
            else:
                answer = self.tools.render(query.fields, query.operation) if query.fields else ""
            if query.message and local_command:
                answer = query.message + ("\n" + answer if answer else "")
            if notice:
                answer = notice + "\n" + answer
            # 本地选定的可投影字段可支持下一轮AI追问；不把本地值和原始问题作为历史。
            if not notice and len(query.fields) == 1:
                refs = [r for r, item in self.analysis.projection.fields.items() if item["local"] == query.fields[0]]
                if refs:
                    label = self.analysis.projection.fields[refs[0]]["public"]["name"]
                    context = AnalysisContext(label, tuple(refs))
        else:
            request = None
        entry = {"time": datetime.now(timezone.utc).isoformat(), "question": question, "answer": answer}
        if self.history:
            self.history.append(self.tools.history_scope, entry)
        self.local_history.append(entry)
        self.last_request, self.last_query, self.last_fields = request, query, query.fields
        self.analysis_context = context
        return answer
