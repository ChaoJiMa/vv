"""报告会话：分离完整本地历史、受控AI分析和旧版枚举模板协议。"""

from datetime import datetime, timezone

from report_assistant.security.privacy import TEMPLATES, approved_request, choose_template
from report_assistant.conversation.questions import LocalQuery, LocalQuestionResolver, is_report_overview
from report_assistant.conversation.analysis import AnalysisContext, AnalysisFailure, AnalysisStrategy
from report_assistant.security.privacy import PrivacyError
from report_assistant.conversation.service import local_service_topic, service_reply, service_replies, append_service_answer
from report_assistant.conversation.local_intents import (split_catalog_request, catalog_answer,
                                                         explicitly_requests_overview, permits_failure_lookup,
                                                         permits_single_field_failure_answer,
                                                         permits_single_field_availability)
from report_assistant.conversation.targets import QuestionTargets
from report_assistant.conversation.module_selection import select_modules, selected_module_fallback
from report_assistant.reports.score import score_family


class Conversation:
    """一份报告对应一个会话，按策略管理完整本地历史和最小模型上下文。"""

    def __init__(self, tools, history=None, strategy="template", *, allow_personal=False):
        """绑定当前报告；终端显式开放个人资料，旧Python调用默认保留原过滤契约。"""
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
        self.analysis = AnalysisStrategy(tools, allow_personal=allow_personal) if strategy == "analysis" else None
        self.analysis_context = None
        # 只保留上一轮已明确列出/选中的当前报告模块ID；不从加密问答正文猜指代。
        self.module_context = None
        # 重启后只恢复用户可回看的本地历史。模型上下文从空白开始。

    def _local_query(self, question, request, previous=None):
        """本地模式/失败回退解析问题；匹配结果不授予原始字段外发资格。"""
        if request:
            fields = self.tools.topic_fields(request.topic, request.window)
            scope = [item for chosen in fields for item in self.resolver.metric_scope(chosen)]
            message = "" if fields else self.resolver.guidance("当前报告未登记该指标或指定周期，不能据此判断为0。")
            return LocalQuery(fields, scope, request.operation, message, '',
                              'no_match' if not fields else '')
        return self.resolver.resolve(question, previous if previous is not None else self.last_query)

    def _verified_failure_facts(self, fields):
        """模型失败时仅展示当前报告重新投影成功的页面结果；投影拒绝则不输出局部值。"""
        try:
            return self.analysis.projection.customer_answer(fields)
        except PrivacyError:
            return ''

    def answer(self, question, client=None, model=None):
        """按策略生成一轮答案；只有加密保存成功才提交内存及追问上下文。

        analysis模式按本会话allow_personal授权提供当前报告事实；以下保留的template分支
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
        working_question, catalog_prefix, selection = question, '', None
        next_module_context, explicit_full = None, False
        if not local_command:
            try:
                # 先核对整句，避免拆出目录后把同句凭据或旧模式个人值洗掉再外发。
                self.analysis.guard.question(question)
            except PrivacyError:
                pass
            else:
                catalog = split_catalog_request(question)
                if catalog.listing:
                    catalog_prefix = catalog_answer(self.tools, self.analysis.guard)
                    working_question = catalog.question
                    next_module_context = tuple(module['module_id'] for module in self.tools.current_modules()) or None
                    if not working_question:
                        answer, catalog_prefix = catalog_prefix, ''
                if answer is None:
                    selection = select_modules(working_question, self.tools,
                                               previous_module_ids=self.module_context)
                    if selection.error:
                        answer = selection.error
                    elif selection.matched and selection.remainder:
                        extra = QuestionTargets(selection.remainder, self.tools, self.analysis.projection, self.analysis_context)
                        if not extra.service_only:
                            answer = '请先明确本次要解读的模块范围，其他指标问题可以另外提问，避免遗漏。'
                    if selection.matched and selection.module_ids and answer is None:
                        next_module_context = selection.module_ids
                    if not selection.matched:
                        explicit_full = (is_report_overview(working_question)
                                         or explicitly_requests_overview(working_question))
                        if explicit_full and client is not None:
                            next_module_context = tuple(module['module_id'] for module in self.tools.current_modules()) or None
        # 完整客服短句在本地回复；已开放的个人资料查询进入报告流程，不复用旧拒答。
        # 复合问题不截断，仍执行本会话凭据检查、语义路由和事实来源校验。
        service_topic = None if local_command else local_service_topic(working_question)
        if service_topic == 'identity' and self.analysis.guard.allow_personal:
            service_topic = None
        if service_topic:
            answer = service_reply(service_topic, allow_personal=self.analysis.guard.allow_personal)
        if answer is None and client is not None and not local_command:
            try:
                self.analysis.guard.question(working_question)
            except PrivacyError:
                notice = ("问题含可能的登录凭据，本轮已留在本地；请去掉凭据后重新提问。"
                          if self.analysis.guard.allow_personal else
                          "问题含可能的个人信息，本轮已留在本地；请去掉个人信息后再让AI分析。")
            else:
                try:
                    answer, context = self.analysis.answer(
                        working_question, client, model, self.analysis_context,
                        previous_module_ids=self.module_context)
                except AnalysisFailure as error:
                    # 只显示程序封闭分类，不拼接SDK错误或模型响应正文。
                    notice = str(error)
                except PrivacyError:
                    notice = "AI请求或工具返回未通过本地校验。"
                except Exception:
                    # SDK正文和模型协议异常只触发固定提示，不输出异常、不带原问题重试。
                    notice = "AI分析暂不可用。"
        if answer is None and selection is not None and selection.matched and selection.module_ids:
            # 仅展示本地重新核实的所选范围结果，不发布被拒绝的模型小结，也不增加模型重试。
            answer = selected_module_fallback(self.tools, self.analysis.projection, selection)
            if selection.remainder:
                extra = QuestionTargets(selection.remainder, self.tools, self.analysis.projection, self.analysis_context)
                if extra.service_topics:
                    answer = append_service_answer(answer, extra.service_topics,
                                                   allow_personal=self.analysis.guard.allow_personal)
        if answer is None and explicit_full and (notice or client is None):
            # 整份报告有任一模块失败时不得发布已生成的局部小结，也不能退化为指标/周期澄清。
            answer = (notice + '\n这份报告的整体分析暂未完成，请稍后再试，或指定想了解的模块。'
                      if notice else '当前未开启AI分析，这份报告的整体分析暂未完成；可以询问具体模块或指标。')
            extra = QuestionTargets(working_question, self.tools, self.analysis.projection, self.analysis_context)
            if extra.service_topics:
                answer = append_service_answer(answer, extra.service_topics,
                                               allow_personal=self.analysis.guard.allow_personal)
        if answer is None and (notice or client is None) and not local_command:
            # 模型失败不等于本地指标查询适用；只对正向确认的查值诉求提供页面结果。
            # 开放分析、未知诉求和多目标歧义保留完整范围的未完成状态，不挑一个字段凑答案。
            if notice.startswith('问题含可能'):
                answer = notice
            else:
                targets = QuestionTargets(working_question, self.tools, self.analysis.projection,
                                          self.analysis_context)
                if targets.service_only:
                    answer = service_replies(targets.service_topics, local_complete=True,
                                             allow_personal=self.analysis.guard.allow_personal)
                else:
                    fallback = ''
                    if targets.is_closed_result_query() and len(targets.report_refs) <= 6:
                        fields = [self.analysis.projection.fields[ref]['local'] for ref in targets.report_refs]
                        query = LocalQuery(fields, [candidate for field in fields
                                                    for candidate in self.resolver.metric_scope(field)])
                        fallback = self._verified_failure_facts(fields)
                    elif permits_failure_lookup(working_question):
                        previous = None
                        if self.analysis_context is not None and len(self.analysis_context.field_refs) == 1:
                            fields = [self.analysis.projection.fields[ref]['local']
                                      for ref in self.analysis_context.field_refs
                                      if ref in self.analysis.projection.fields]
                            previous = LocalQuery(fields, [candidate for field in fields
                                                           for candidate in self.resolver.metric_scope(field)])
                        candidate = self._local_query(working_question,
                                                      approved_request(working_question, self.last_request), previous)
                        if candidate.issue in {'calendar', 'multiple_windows', 'referent'}:
                            fallback = candidate.clarification
                        elif (candidate.issue == 'safe_inference_followup' and len(candidate.fields) == 1
                              and self.analysis_context is not None
                              and tuple(targets.report_refs) == self.analysis_context.field_refs):
                            # 仅沿用上一轮唯一已核验目标，不能把“没有申请”推断当作事实。
                            query = candidate
                            fallback = self._verified_failure_facts(candidate.fields)
                        elif (len(candidate.fields) == 1 and len(targets.report_refs) == 1
                              and not targets.ambiguous and permits_single_field_availability(working_question)
                              and self.analysis.projection.fields[targets.report_refs[0]]['local'] == candidate.fields[0]):
                            # “能查到吗”只由目标账本已唯一绑定的本轮指标回答，不能靠本地候选碰巧唯一。
                            query = candidate
                            fallback = self._verified_failure_facts(candidate.fields)
                        elif (len(candidate.fields) == 1 and not targets.report_refs
                              and permits_single_field_failure_answer(working_question, candidate.fields[0])
                              and not any(mark in working_question.rstrip('。！？!? ')
                                          for mark in '，,；;。！？!?\n')):
                            # 少量公开字段别名未被目标账本收录时，只接受单句、唯一字段的直接查值。
                            query = candidate
                            fallback = self._verified_failure_facts(candidate.fields)
                    if not fallback:
                        query = LocalQuery()
                        fallback = ('当前未开启AI分析，这次回答暂未完成。' if client is None
                                    else '这次回答暂未完成，请稍后重试。')
                    if len(query.fields) == 1:
                        # 仅已核实且完整回答的单字段查值建立下一轮指代，失败或澄清不承接。
                        refs = [ref for ref, item in self.analysis.projection.fields.items()
                                if item['local'] == query.fields[0]]
                        if refs:
                            label = self.analysis.projection.fields[refs[0]]['public']['name']
                            context = AnalysisContext(label, (refs[0],))
                    if targets.service_topics:
                        fallback = append_service_answer(fallback, targets.service_topics,
                                                         allow_personal=self.analysis.guard.allow_personal)
                    answer = (notice + '\n' if notice else '') + fallback
            notice = ''
        if answer is None:
            request = approved_request(working_question, self.last_request)
            previous = None
            if (not local_command and self.analysis_context is not None
                    and len(self.analysis_context.field_refs) == 1):
                # AI正常回答不建立本地字段选择；后续模型失败时，仍按已核验引用恢复
                # 单一指代对象；整份报告或多指标不能自行选一个，也不能展开全部内容。
                fields = [self.analysis.projection.fields[ref]['local']
                          for ref in self.analysis_context.field_refs if ref in self.analysis.projection.fields]
                previous = LocalQuery(fields, [item for field in fields for item in self.resolver.metric_scope(field)])
            query = self._local_query(working_question, request, previous)
            if not local_command:
                # 所有自然指标问答统一走页面结果出口；模型失败不能暴露原值和代码规则。
                targets = QuestionTargets(working_question, self.tools, self.analysis.projection, self.analysis_context)
                if targets.service_only:
                    # 有确定封闭知识时无需再显示“选一个指标”，也不虚构模型处理成功。
                    answer = service_replies(targets.service_topics, local_complete=True,
                                             allow_personal=self.analysis.guard.allow_personal)
                    query, notice = LocalQuery(), ''
                else:
                    answer = query.clarification or self.analysis.projection.customer_answer(query.fields)
                    if targets.service_topics:
                        answer = append_service_answer(answer, targets.service_topics,
                                                       allow_personal=self.analysis.guard.allow_personal)
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
        if catalog_prefix:
            answer = catalog_prefix + '\n\n' + answer
        entry = {"time": datetime.now(timezone.utc).isoformat(), "question": question, "answer": answer}
        if self.history:
            self.history.append(self.tools.history_scope, entry)
        self.local_history.append(entry)
        self.last_request, self.last_query, self.last_fields = request, query, query.fields
        self.analysis_context = context
        self.module_context = next_module_context
        return answer
