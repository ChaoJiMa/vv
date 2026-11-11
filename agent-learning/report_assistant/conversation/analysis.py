"""AI 理解与分析策略：路由隔离、受控工具循环、引用校验及最小上下文。"""

import re

from zai.core._errors import APIConnectionError, APIStatusError, APITimeoutError
from openai import APIConnectionError as OpenAIConnectionError
from openai import APIStatusError as OpenAIStatusError
from openai import APITimeoutError as OpenAITimeoutError

from report_assistant.security.privacy import PrivacyError
from report_assistant.security.answer_validation import CONTACT, assertion_text, check_answer_numbers, has_identity_label
from report_assistant.reports.projection import FactProjection
from report_assistant.security.question_guard import QuestionGuard
from report_assistant.security.text import normalized
from report_assistant.conversation.service import SERVICE_REPLIES, service_replies, append_service_answer
from report_assistant.conversation.targets import QuestionTargets
from report_assistant.conversation.focused import FocusedReportRun
from report_assistant.conversation.analysis_protocol import (
    ROUTE_PROMPT, REPORT_PROMPT, OUT_OF_SCOPE_REPLY, THINKING_ONLY_MODELS,
    AnalysisFailure, function, TOOLS, MODULE_COVERAGE, FINAL_PROMPT,
    BUDGET_INSTRUCTION, MIXED_INSTRUCTION, TARGET_INSTRUCTION,
    TARGET_FACTS_INSTRUCTION, PROTOCOL_STRINGS, encode, strict_json, AnalysisContext,
)
from report_assistant.conversation.wording import natural_missing_text
from report_assistant.conversation.questions import is_report_overview
from report_assistant.conversation.data_policy import personal_protocol
from report_assistant.conversation.overview import MAX_MODULES, OVERVIEW_PROTOCOL, OverviewBudgetError, OverviewValidationError, ReportOverview




class AnalysisStrategy:
    """每轮独立执行，返回答案与待提交上下文；持久化由Conversation负责。"""

    def __init__(self, tools, *, allow_personal=False):
        self.tools = tools
        self.guard = QuestionGuard(tools, allow_personal=allow_personal)
        self.projection = FactProjection(tools, self.guard)

    def _request(self, client, model, messages, tools=None, json_mode=False, overview=False):
        """唯一的新策略网络出口，检查实际消息且只重建被允许的SDK参数。"""
        thinking_only = model in THINKING_ONLY_MODELS
        options = {"model": model, "messages": messages, "stream": False,
                   "thinking": {"type": "enabled" if thinking_only else "disabled"},
                   "max_tokens": 8192 if thinking_only or overview else 1800,
                   # 思考和正文共用响应时间；整体分析不能沿用短查询的30秒预算。
                   "timeout": 90.0 if thinking_only or overview else 30.0}
        if tools is not None:
            options.update(tools=tools, tool_choice="auto")
        if json_mode:
            options["response_format"] = {"type": "json_object"}
        protocol = PROTOCOL_STRINGS | (OVERVIEW_PROTOCOL if overview else set())
        if self.guard.allow_personal:
            # 旧调用的提示词不变；当前入口使用与授权范围一致的固定协议，防止模型继续隐私拒答。
            options = personal_protocol(options, protocol)
            protocol |= {personal_protocol(text, protocol) for text in protocol}
        try:
            self.guard.check_payload(options, trusted_strings=protocol | self.projection.protocol_strings() | {model})
        except PrivacyError:
            raise AnalysisFailure("payload") from None
        try:
            response = client.chat.completions.create(**options)
        except (APITimeoutError, OpenAITimeoutError):
            raise AnalysisFailure("timeout") from None
        except (APIConnectionError, OpenAIConnectionError):
            raise AnalysisFailure("connection") from None
        except (APIStatusError, OpenAIStatusError):
            raise AnalysisFailure("service") from None
        if not response.choices or getattr(response.choices[0], "finish_reason", None) in {"length", "content_filter"}:
            raise AnalysisFailure("incomplete")
        return response.choices[0].message

    def answer(self, question, client, model, previous=None):
        """具体问答最多7次；整份报告按模块分批总结，最多34次且不复用旧字段上下文。"""
        safe_question = self.guard.question(question)
        targets = QuestionTargets(safe_question, self.tools, self.projection, previous)
        # 完整整份报告短句直接进入覆盖全部模块的流程，避免语义路由偶然漏判或复用旧字段。
        if is_report_overview(safe_question):
            return self._overview(safe_question, client, model)
        # 分类只接收上下文是否存在；旧问题和引用仍须在指代路由批准后才按需补入。
        route_input = encode({"question": safe_question, "has_previous_report": previous is not None})
        routed = self._request(client, model, [{"role": "system", "content": ROUTE_PROMPT}, {"role": "user", "content": route_input}], json_mode=True)
        try:
            if routed.tool_calls:
                raise PrivacyError("路由不允许工具。")
            route = strict_json(routed.content)
            if type(route.get("route")) is not str or route["route"] not in {"report", "service", "general"} or type(route.get("use_previous")) is not bool:
                raise PrivacyError("路由格式无效。")
            if route["route"] == "service":
                if set(route) not in ({"route", "use_previous", "topic"}, {"route", "use_previous", "topics"}) or route["use_previous"]:
                    raise PrivacyError("客服路由格式无效。")
                topics = route.get('topics') if 'topics' in route else [route['topic']]
                self._service_topics(topics)
            elif route["route"] == "report":
                if set(route) - {'service_topics'} not in ({"route", "use_previous"}, {"route", "use_previous", "scope"}):
                    raise PrivacyError("路由格式无效。")
                if 'service_topics' in route:
                    self._service_topics(route['service_topics'])
                if "scope" in route and (type(route["scope"]) is not str or route["scope"] not in {"overview", "focused"}):
                    raise PrivacyError("路由范围无效。")
            elif set(route) != {"route", "use_previous"}:
                raise PrivacyError("路由格式无效。")
        except PrivacyError:
            raise AnalysisFailure("route") from None
        if self.guard.allow_personal and route['route'] == 'service' and 'identity' in topics:
            # 原identity主题只解释隐私边界；新授权下真实字段查询必须进入报告事实流程。
            route = {'route': 'report', 'use_previous': False, 'scope': 'focused',
                     'service_topics': [topic for topic in topics if topic != 'identity']}
        # 本地只校正有确定依据的遗漏；未识别片段仍由原语义流程处理。
        # 纯客服必须覆盖全部实质分句，不能仅凭“没有识别到报告字段”就截断混合问题。
        if targets.service_only:
            return self._service_answers(targets.service_topics), None
        elif targets.has_report_targets and route["route"] != "report":
            inherited = topics if route["route"] == "service" and targets.ambiguous else []
            route = {"route": "report", "scope": "focused", "use_previous": bool(
                previous is not None and re.search(r"^(?:那|这项|这个|它|同一|改成|再看)|刚才|同周期", safe_question))}
            route["service_topics"] = list(dict.fromkeys([*targets.service_topics, *inherited]))
        if route["route"] == "service":
            # 模型只选封闭主题；联系方式、政策边界均由本地知识提供，不再请求自由生成。
            topics = list(dict.fromkeys([*targets.service_topics, *topics]))
            return self._service_answers(topics), None
        if route["route"] == "general":
            # 路由完成即终止模型流程：不读取报告、不生成聊天内容，也不携带旧上下文。
            # 固定热线属于可信产品文案，不走用于模型自由文本的长号码拦截。
            return OUT_OF_SCOPE_REPLY, None
        service_topics = list(dict.fromkeys([*targets.service_topics, *route.get('service_topics', [])]))
        if self.guard.allow_personal:
            service_topics = [topic for topic in service_topics if topic != 'identity']
        if route.get("scope") == "overview":
            answer, context = self._overview(safe_question, client, model, mixed=bool(service_topics))
        else:
            answer, context = self._report(safe_question, client, model, previous if route["use_previous"] else None,
                                           mixed=bool(service_topics), targets=targets)
        if service_topics:
            answer = append_service_answer(answer, service_topics, allow_personal=self.guard.allow_personal)
        return answer, context

    def _service_answers(self, topics):
        """组合本地已确认的完整诉求；模型数组仍在进入此处前按最多3项校验。

        本地交叉核对可能补出第4项，不能清空或截断。只组合封闭知识全集，
        不开放模型自由正文、任意主题或办理权限，联系方式仍由同一组合器去重。
        """
        if (not isinstance(topics, list) or not 1 <= len(topics) <= len(SERVICE_REPLIES)
                or not all(type(topic) is str and topic in SERVICE_REPLIES for topic in topics)
                or len(set(topics)) != len(topics)):
            raise AnalysisFailure('route')
        return service_replies(topics, local_complete=True, allow_personal=self.guard.allow_personal)

    @staticmethod
    def _service_topics(topics):
        """仅接受封闭、非空、不重复主题数组；模型不能带入自由答复或联系方式。"""
        if (not isinstance(topics, list) or not 1 <= len(topics) <= 3
                or not all(type(topic) is str and topic in SERVICE_REPLIES for topic in topics)
                or len(set(topics)) != len(topics)):
            raise PrivacyError('客服路由主题列表无效。')

    def _overview(self, question, client, model, mixed=False):
        """覆盖当前模板全部模块，引用只用于核对，不向用户追加字段事实清单。"""
        if len(self.tools.current_modules()) > MAX_MODULES:
            raise AnalysisFailure("budget")
        overview = ReportOverview(self.tools, self.projection, self._check_text, strict_json,
                                  check_sourced_text=self._check_sourced_text)

        def request(messages):
            """复合问题每批与整体总结均限定只答报告，业务说明统一由本地追加。"""
            if mixed:
                messages = [messages[0], {'role': 'system', 'content': MIXED_INSTRUCTION}, *messages[1:]]
            return self._request(client, model, messages, json_mode=True, overview=True)

        try:
            answer, refs = overview.run(question, request)
        except OverviewBudgetError:
            raise AnalysisFailure("budget") from None
        except OverviewValidationError as error:
            raise AnalysisFailure("answer", error) from None
        except PrivacyError:
            raise AnalysisFailure("answer") from None
        return answer, AnalysisContext(question, refs)

    def _report(self, question, client, model, previous, mixed=False, targets=None):
        """将本轮状态交给独立执行器，保留本策略的请求出口与最终校验。"""
        return FocusedReportRun(self, question, client, model, previous, mixed, targets).run()

    def _validate_call(self, name, args, exposed):
        if name == "submit_report_analysis" and set(args) == {"sections"}:
            # 段落、来源与数字交由同一个_render验证，工具提交不能绕过正文校验。
            return
        if name == "list_report_modules" and not args:
            return
        if name == "list_report_fields" and set(args) == {"module_ref", "offset"}:
            self.projection.catalog(**args)
            return
        if name == "read_report_facts" and set(args) == {"field_refs"}:
            refs = args["field_refs"]
            if isinstance(refs, list) and 1 <= len(refs) <= 12 and all(type(r) is str and r in exposed for r in refs) and len(set(refs)) == len(refs):
                return
        raise PrivacyError("工具或参数超出范围。")

    @staticmethod
    def _has_phone_source(facts):
        """只看本段已读事实的指标元数据；不从问题、报告值或其他段落授权手机泛称。"""
        return any(isinstance(fact.get('name'), str)
                   and re.fullmatch(r'(?:手机)?在网(?:时长|时间)|(?:通信)?运营商', fact['name'])
                   for fact in facts)

    def _check_sourced_text(self, text, source_facts):
        """最终呈现按本段实际引用授予无值泛称许可；无手机来源时关闭旧短语豁免通道。"""
        phone_context = self._has_phone_source(source_facts)
        if not self.guard.allow_personal and isinstance(text, str) and not phone_context and re.search(r'手机(?:号码|号)', normalized(text)):
            raise PrivacyError('手机业务泛称没有本段来源。')
        self._check_text(text, phone_metric_context=phone_context)

    def _check_text(self, text, *, phone_metric_context=False):
        if not isinstance(text, str) or not text.strip() or len(text) > 5000:
            raise PrivacyError("回答格式无效。")
        text = normalized(text)
        # 客户仅通过问答交流；模型不能把内部调试入口或终端指令当作办理步骤。
        if re.search(r'/(?:orders|find|pick|history|help)\b|```(?:bash|sh|shell|powershell|cmd)\b|'
                     r'(?:运行|执行|输入)\s*[`“\"]?(?:python(?:\.exe)?|pip|powershell|cmd(?:\.exe)?|curl)\b', text, re.I):
            raise PrivacyError('回答包含面向内部操作的命令。')
        if self.guard.contains_analysis_private(text) or self.guard.blocked_contact(text) or self.guard.blocked_label(
                text, allow_phone_reference=True, phone_metric_context=phone_metric_context) or re.search(r"https?://|[\x00-\x08\x0b-\x1f\x7f]|审批.{0,8}(通过|概率)|授信概率|保证.{0,5}(贷款|下款)|必然导致", text):
            raise PrivacyError("回答未通过本地检查。")
        # 仅有统计值和引用不足以支持整体信用评价、正常申请间隔或无风险保证。
        # 单个分数等级不能扩写为整体信用评价，仍拦截没有事实支持的保证。
        if re.search(r"无风险|没有任何风险|非常(?:干净|健康)|(?:信用|征信)(?:状况|情况)?良好|申请频率.{0,6}正常|不会.{0,6}(?:不良影响|影响申请)|超越.{0,10}用户|无逾期记录", assertion_text(text)):
            raise PrivacyError("分析结论超出统计事实范围。")
        if re.search(r"(?<![a-zA-Z0-9_])[fm]\d+(?![a-zA-Z0-9_])|field_ref|module_ref|report[.\[]|BRS_[A-Z_0-9]+|本轮(?:读取|分析)|已读取|未读取|读取.{0,8}(?:字段|模块)|原始(?:指标|事实|值)|取整前|四舍五入|底层(?:值|数据|数值)|转换前|内部编码|取值逻辑|登记统计字段|页面自定义|未执行评分|依据[（(：:]", text, re.I):
            raise PrivacyError("客服回答不能展示内部字段或查询过程。")

    @staticmethod
    def _can_rebuild_phone_results(targets, facts):
        """手机结果保底还须全问为封闭查值且全部目标已读，未知解释或推断不获资格。"""
        if targets.ambiguous or not targets.report_refs or targets.missing_refs(facts):
            return False
        if not AnalysisStrategy._has_phone_source([facts[ref] for ref in targets.report_refs]):
            return False
        return targets.is_closed_result_query()

    def _phone_draft_boundary(self, text):
        """保底资格已核验手机目标；原文仍须拒绝实际值、赋值句及所有其他危险项。

        此处只决定是否可丢弃草稿，不授予原文展示许可；最终事实段另按其实际
        来源检查。保留原标签上下文，避免先删标签导致号码赋值绕过整体拒绝。
        """
        self._check_text(text, phone_metric_context=True)

    def _validated_sections(self, content, facts, text_checker=None):
        """整批核对结构、各段危险项及全部已读来源，不以首段失败掩盖后续非法内容。"""
        value = strict_json(content)
        sections = value.get("sections")
        if set(value) != {"sections"} or not isinstance(sections, list) or not 1 <= len(sections) <= 6:
            raise PrivacyError("分析结构无效。")
        for section in sections:
            if not isinstance(section, dict) or set(section) != {"text", "sources"}:
                raise PrivacyError("分析段落无效。")
            text, sources = section["text"], section["sources"]
            if not isinstance(sources, list) or not sources or not all(type(r) is str and r in facts for r in sources):
                raise PrivacyError("分析引用无效。")
            if text_checker is None:
                self._check_sourced_text(text, [facts[ref] for ref in sources])
            else:
                text_checker(text)
        return sections

    def _render(self, content, facts):
        """内部校验来源及数字，只展示客服正文；单个评分段落使用核实后的完整说明。"""
        sections = self._validated_sections(content, facts)
        parts = []
        for section in sections:
            text, sources = section['text'], section['sources']
            text = natural_missing_text(text, [facts[r] for r in set(sources)])
            self._check_sourced_text(text, [facts[r] for r in sources])
            check_answer_numbers(text, [facts[r] for r in sources])
            if len(set(sources)) == 1 and facts[sources[0]].get("presentation"):
                if not re.search(r'分数|评分|分析指数|风险指数|报告指数|分值|得分|\d+\s*分', text):
                    # 引用了评分不代表用户正在问评分；不能把“不知道来源”等无关
                    # 草稿替换成一条正确但答非所问的分数，借本地短答掩盖来源错误。
                    raise PrivacyError('评分来源与回答主题不匹配。')
                # 单评分由本地短答保证显示分数和实际等级，不补充内部计算过程。
                text = facts[sources[0]]["presentation"]["answer"]
                self._check_text(text)
            if text.strip() not in parts:
                parts.append(text.strip())
        return ("【演示数据】\n" if self.tools.is_demo else "") + "\n\n".join(parts)
