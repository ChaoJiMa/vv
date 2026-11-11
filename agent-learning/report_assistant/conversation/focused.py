"""一轮具体报告查询的状态与执行；预算、来源和结论校验依然由原策略约束。"""

import re
from report_assistant.security.privacy import PrivacyError
from report_assistant.conversation.targets import QuestionTargets
from report_assistant.conversation.analysis_protocol import (
    AnalysisContext, AnalysisFailure, encode, strict_json, REPORT_PROMPT, MIXED_INSTRUCTION,
    TARGET_INSTRUCTION, TARGET_FACTS_INSTRUCTION, FINAL_PROMPT, BUDGET_INSTRUCTION, TOOLS, MODULE_COVERAGE,
)


class FocusedReportRun:
    """只存活于当前问答；不共享客户端身份、报告事实或前一轮答案。"""

    def __init__(self, strategy, question, client, model, previous, mixed, targets):
        """注入原策略与已校验输入；预算计数和实际事实仍在本轮内独立累积。"""
        self.strategy = strategy
        self.question, self.client, self.model = question, client, model
        self.previous, self.mixed, self.targets = previous, mixed, targets

    def run(self):
        """在原预算内逐项目标核对；只对确定目标补读，最终结果仍经统一安全检查。"""
        self.messages = [{"role": "system", "content": REPORT_PROMPT}]
        if self.mixed:
            self.messages.append({'role': 'system', 'content': MIXED_INSTRUCTION})
        self.exposed, self.facts, self.call_ids = set(), {}, set()
        if self.previous is not None:
            if type(self.previous) is not AnalysisContext:
                raise PrivacyError("追问上下文格式无效。")
            old = self.strategy.guard.question(self.previous.question)
            refs = [ref for ref in self.previous.field_refs if ref in self.strategy.projection.fields]
            # 只补充引用元数据；数值需本轮重新经工具读取，不能复用旧回答。
            self.exposed.update(refs)
            self.messages.append({"role": "user", "content": encode({"previous_question": old, "previous_fields": [self.strategy.projection.fields[r]["public"] for r in refs]})})
        self.messages.append({"role": "user", "content": self.question})
        self.total_calls, self.force_final = 0, False
        self.targets = self.targets or QuestionTargets(self.question, self.strategy.tools, self.strategy.projection, self.previous)
        if self.targets.report_refs:
            # 程序列出同一受控目录中的确定候选，不附原始字段路径或读取资格外的值。
            self.exposed.update(self.targets.report_refs)
            self.messages.append({"role": "system", "content": encode({
                "instruction": TARGET_INSTRUCTION,
                "required_fields": [self.strategy.projection.fields[ref]["public"] for ref in self.targets.report_refs],
            })})
        return self._query()


    def complete_targets(self):
        """只补齐未读的确定来源，计入12次/48字段限制，不新增模型请求或重试。"""
        missing = self.targets.missing_refs(self.facts)
        calls_needed = (len(missing) + 11) // 12
        if self.total_calls + calls_needed > 12 or len(set(self.facts) | set(missing)) > 48:
            raise AnalysisFailure("budget")
        added = []
        for start in range(0, len(missing), 12):
            try:
                values = self.strategy.projection.read(missing[start:start + 12])
            except PrivacyError:
                raise AnalysisFailure("facts") from None
            self.facts.update({fact["field_ref"]: fact for fact in values})
            added.extend(values)
            self.total_calls += 1
        if added:
            self.messages.append({"role": "system", "content": encode({
                "instruction": TARGET_FACTS_INSTRUCTION, "required_results": added,
            })})


    def rebuild_targets(self):
        """先逐来源核对程序生成的原子事实，再按原协议最多6段排版并统一校验。"""
        repaired = self.targets.factual_sections(self.facts)
        if not repaired or not self.targets.validate_answer(repaired, self.facts):
            raise PrivacyError('回答未完整覆盖已确认的问题。')
        if len(repaired) > 6:
            size = (len(repaired) + 5) // 6
            repaired = [{
                'text': '；'.join(section['text'].rstrip('。；') for section in repaired[start:start + size]) + '。',
                'sources': list(dict.fromkeys(ref for section in repaired[start:start + size]
                                              for ref in section['sources'])),
            } for start in range(0, len(repaired), size)]
        return self.strategy._render(encode({'sections': repaired}), self.facts)


    def finish(self, content):
        """先校验原始结论，再纠正确定目标的漏答/假缺失；不豁免危险或无效输出。"""
        self.complete_targets()
        try:
            answer = self.strategy._render(content, self.facts)
        except PrivacyError:
            if not self.strategy._can_rebuild_phone_results(self.targets, self.facts):
                raise
            # 仅为严格封闭的结果查找保底：全部结构、已读来源与危险项必须先通过。
            # 泛称处理只用于核对风险，模型全文和处理后文本都不作为答案。
            self.strategy._validated_sections(content, self.facts, self.strategy._phone_draft_boundary)
            return self.rebuild_targets()
        sections = strict_json(content)["sections"]
        if self.targets.report_refs and not self.targets.validate_answer(sections, self.facts):
            # 完整明确问法可用相同已读事实重组，避免在错误段落后追加相反结论。
            # 开放解释或未知表达无法靠值锚点证明完整性，不把“未证明”当成错误，
            # 也不以局部事实替换整份回答；它们仍经过上面的原有全部安全检查。
            if self.targets.ambiguous:
                return answer
            answer = self.rebuild_targets()
        return answer


    def _query(self):
        """沿用六轮查询及原预算，整批验证后执行，不增加请求或放宽引用。"""
        for round_index in range(6):
            # 请求总数保持不变；最后一轮或工具预算用完时只生成结论，避免读完事实后无机会回答。
            final_only = self.force_final or round_index == 5 or self.total_calls >= 12 or len(self.facts) >= 48
            if final_only:
                self.complete_targets()
                # 最后一轮明确列出已读取来源，避免把目录中未读取的字段误当成结论依据。
                self.messages.append({"role": "system", "content": encode({**FINAL_PROMPT, "allowed_sources": list(self.facts)})})
            else:
                self.messages.append({"role": "system", "content": encode({
                    "instruction": BUDGET_INSTRUCTION, "remaining_calls": 12 - self.total_calls,
                    "remaining_fields": 48 - len(self.facts), "remaining_query_rounds": 5 - round_index,
                    "max_calls_per_batch": min(4, 12 - self.total_calls),
                })})
            # 工具阶段以提交结论工具约束结构；只有不带工具的结论请求启用JSON模式。
            message = self.strategy._request(self.client, self.model, self.messages, None if final_only else TOOLS, json_mode=final_only)
            calls = message.tool_calls
            if not calls:
                try:
                    answer = self.finish(message.content)
                except PrivacyError:
                    raise AnalysisFailure("answer") from None
                return answer, AnalysisContext(self.question, tuple(self.facts))
            if final_only:
                raise AnalysisFailure("budget")
            if not isinstance(calls, list) or not 1 <= len(calls) <= 4:
                raise AnalysisFailure("budget")
            # 全批先校验再读取。不要转发assistant.content、reasoning_content或model_dump。
            pending = []
            for call in calls:
                try:
                    if not isinstance(call.id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", call.id) or call.id in self.call_ids:
                        raise PrivacyError("工具调用标识无效。")
                    args = strict_json(call.function.arguments)
                    name = call.function.name
                    self.strategy._validate_call(name, args, self.exposed)
                except PrivacyError:
                    raise AnalysisFailure("tool") from None
                if name == "submit_report_analysis":
                    # 结论只引用此前已读取事实；混合批次不得借本轮尚未读取的字段作依据。
                    if len(calls) != 1:
                        raise AnalysisFailure("tool")
                    try:
                        answer = self.finish(encode(args))
                    except PrivacyError:
                        raise AnalysisFailure("answer") from None
                    return answer, AnalysisContext(self.question, tuple(self.facts))
                self.call_ids.add(call.id)
                pending.append((call.id, name, args))
            requested = {r for _, name, args in pending if name == "read_report_facts" for r in args["field_refs"]}
            if requested and requested <= set(self.facts) and all(name == "read_report_facts" for _, name, _ in pending):
                # 当前报告快照不变：整批只重复已读来源时不再查询，保留已有事实生成结论。
                # 仅限制本轮无新增信息的读取；新字段、目录查询及下一轮首次读取仍按原流程执行。
                self.complete_targets()
                self.force_final = True
                continue
            if self.total_calls + len(calls) > 12 or len(set(self.facts) | requested) > 48:
                # 整批不执行、不转发模型调用；已有事实时用保留轮次收尾，不能为扩展查询丢弃已读结果。
                if not self.facts:
                    raise AnalysisFailure("budget")
                self.force_final = True
                continue
            self._execute_batch(pending)
        raise AnalysisFailure("budget")

    def _execute_batch(self, pending):
        """执行已全批校验并获预算的只读工具；仅回传本地重建的引用和结果。"""
        results, rebuilt = [], []
        for call_id, name, args in pending:
            if name == "list_report_modules":
                # 模块列表是独立工具回执，不能沿用旧“个人资料留本地”的覆盖说明。
                coverage = self.strategy.projection.coverage if self.strategy.guard.allow_personal else MODULE_COVERAGE
                result = {"modules": list(self.strategy.projection.modules.values()), "coverage": coverage}
            elif name == "list_report_fields":
                result = self.strategy.projection.catalog(**args)
                self.exposed.update(f["field_ref"] for f in result["fields"])
            else:
                try:
                    result = self.strategy.projection.read(args["field_refs"])
                except PrivacyError:
                    raise AnalysisFailure("facts") from None
                self.facts.update({f["field_ref"]: f for f in result})
            # 请求中只使用本地生成的调用标识，避免回传模型标识与报告私有文本的偶然重合。
            public_call_id = "call_" + str(self.total_calls + len(rebuilt) + 1)
            rebuilt.append({"id": public_call_id, "type": "function", "function": {"name": name, "arguments": encode(args)}})
            results.append({"role": "tool", "tool_call_id": public_call_id, "content": encode(result)})
        self.messages.append({"role": "assistant", "content": "", "tool_calls": rebuilt})
        self.messages.extend(results)
        self.total_calls += len(pending)
