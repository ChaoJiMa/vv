"""模块总结范围回归：纯内存模型重放已知坏句，不读取配置或调用网络。"""

from copy import deepcopy
import json
from unittest.mock import Mock, patch

from report_assistant.conversation.analysis import AnalysisStrategy
from report_assistant.conversation.overview import ReportOverview, encode
from report_assistant.security.privacy import PrivacyError
from report_assistant.conversation.session import Conversation
from report_assistant.reports.tools import LocalReportTools
from scripts.customer_display_cases import display_tools
from support import privacy as support
from support.overview import OverviewClient, overview_tools


# 固定快照中5个失败例及1个自动通过漏检例的局部坏句；无需依赖本机.eval文件。
SNAPSHOT_SCOPE_TEXTS = {
    "bulk-09975": "学历信息暂未提供，无法确认您的具体学历。目前仅有这一模块，缺少其他模块信息，无法对整份报告作整体总结。",
    "bulk-09888": "学历信息暂未提供，无法确认您的具体学历。整体来看，本次提供的已开放模块仅有学历信息，暂无可进一步概括的已确认结果。",
    "bulk-09851": "学历信息暂未提供，无法确认您的具体学历；整体来看，目前提供的报告内容不足以作进一步总结。",
    "bulk-09926": "学历信息暂未提供，整体来看，当前仅有这一项信息，无法确认您的具体学历。",
    "bulk-09818": "学历信息暂未提供，无法确认您的实际学历。整体来看，目前仅有这一项信息，无法据此概括整份报告的情况；如需完整总结，请补充其他模块的展示结果，并隐去个人信息。",
    "bulk-09901": "学历信息暂未提供，无法确认您的具体学历；当前仅有这一模块，暂时没有可供整体归纳的已确认结果。",
}


def status_tools(count, changes):
    """在独立虚构模块中安排空值或未知规则，重建投影避免修改已缓存事实。"""
    source = overview_tools(count=count)
    order, catalog = deepcopy(source._order), deepcopy(source._catalog)
    for index, (value, rule) in changes.items():
        key = f"item_{index}_0"
        order["report_data"]["report"][key] = value
        field = next(f for f in catalog["fields"] if f["path"] == "report." + key)
        field["frontend_processing"] = rule
    return LocalReportTools(order, catalog)


def phone_bank_tools():
    """在真实虚构在网模块后增加银行模块，检查授权不随模块/批次处理顺序泄漏。"""
    source = display_tools()
    order, catalog = deepcopy(source._order), deepcopy(source._catalog)
    order["report_data"]["report"]["bank_M1_count"] = 2
    order["report_data"]["template"]["modules"].append({"moduleId": 10, "moduleName": "银行申请"})
    catalog["fields"].append({"module_id": 10, "module_name": "银行申请", "name": "银行申请次数",
                              "path": "report.bank_M1_count", "window": "近1月", "frontend_processing": "直接输出原值"})
    return LocalReportTools(order, catalog)


def phone_loan_tools(term="36个月"):
    """将独立贷款期限放在同模块，检验一段多来源不能把别字段时长借给在网指标。"""
    source = phone_bank_tools()
    order, catalog = deepcopy(source._order), deepcopy(source._catalog)
    order["report_data"]["report"]["loan_term"] = term
    catalog["fields"].append({"module_id": 169, "module_name": "手机在网", "name": "贷款期限",
                              "path": "report.loan_term", "frontend_processing": "直接输出原值"})
    return LocalReportTools(order, catalog)


class OverviewScopeRegressionTests(support.NoExternalIO):
    """同时检查正文、协议、真实单模块和分页边界，不仅匹配修复后的固定文案。"""

    def run_overview(self, tools, mutate=None):
        """走正式Conversation和隐私出口；fake只按批准的模块/总结协议回应。"""
        client = OverviewClient(mutate)
        conversation = Conversation(tools, strategy="analysis")
        answer = conversation.answer("按模块分析整份报告并整体总结", client, "synthetic-model")
        return conversation, client, answer

    @staticmethod
    def payloads(client):
        return [json.loads(r["messages"][-1]["content"]) for r in client.requests]

    def test_scope_metadata_survives_one_and_multiple_batch_boundaries(self):
        for count, sizes in ((1, [1]), (8, [8]), (9, [8, 1]), (16, [8, 8]), (17, [8, 8, 1])):
            with self.subTest(count=count):
                _, client, answer = self.run_overview(overview_tools(count=count))
                self.assertIn("**整体总结**", answer)
                payloads = self.payloads(client)
                self.assertEqual([len(p["modules"]) for p in payloads[:-1]], sizes)
                for payload, size in zip(payloads[:-1], sizes):
                    self.assertEqual(payload["scope"], {"stage": "modules", "module_count": count,
                                     "confirmed_module_count": count, "batch_module_count": size})
                self.assertEqual(payloads[-1]["scope"]["stage"], "summary")
                self.assertEqual(payloads[-1]["scope"]["module_count"], count)
                self.assertEqual(len(client.requests), len(sizes) + 1)

    def test_fixed_snapshot_six_scope_leaks_become_local_missing_notes(self):
        for case, rejected_text in SNAPSHOT_SCOPE_TEXTS.items():
            with self.subTest(case=case):
                def replay(stage, value, payload, _):
                    if stage == "modules":
                        names = {m["module_ref"]: m["name"] for m in payload["modules"]}
                        for row in value["modules"]:
                            if names[row["module_ref"]] == "学历信息":
                                row["text"] = rejected_text
                    return value
                _, client, answer = self.run_overview(display_tools(), replay)
                self.assertIn("**整体总结**", answer)
                self.assertNotIn(rejected_text, answer)
                checked = self.payloads(client)[-1]["modules"]
                education = next(m["text"] for m in checked if m["name"] == "学历信息")
                self.assertIn("暂未提供", education)
                self.assertNotIn("整体", education)
                self.assertEqual(len(checked), 9)
                self.assertEqual(self.payloads(client)[-2]["scope"]["module_count"], 9)

    def test_missing_last_module_never_hides_earlier_confirmed_results(self):
        for count in (1, 8, 9, 16, 17):
            with self.subTest(count=count):
                tools = status_tools(count, {count - 1: (None, "直接输出原值")})
                def mutate(stage, value, payload, _):
                    if stage == "modules":
                        for row in value["modules"]:
                            row["text"] = "整体来看，本模块可概括已提供的信息。"
                    return value
                _, client, answer = self.run_overview(tools, mutate)
                self.assertIn("**整体总结**", answer)
                checked = self.payloads(client)[-1]
                self.assertEqual(checked["scope"]["confirmed_module_count"], count - 1)
                self.assertIn("暂未提供", checked["modules"][-1]["text"])
                self.assertEqual(len(checked["modules"]), count)

    def test_multiple_missing_modules_across_batches_keep_their_own_notes(self):
        changes = {i: (None if i % 2 else "", "直接输出原值") for i in (1, 7, 8, 15, 16)}
        _, client, answer = self.run_overview(status_tools(17, changes))
        self.assertIn("**整体总结**", answer)
        checked = self.payloads(client)[-1]
        self.assertEqual(checked["scope"]["confirmed_module_count"], 12)
        self.assertEqual(sum("具体信息暂未提供" in m["text"] for m in checked["modules"]), 5)
        self.assertEqual(len(checked["modules"]), 17)

    def test_withheld_is_not_reported_as_missing(self):
        _, client, answer = self.run_overview(status_tools(9, {8: ("待确认展示值", "未知转换")}))
        self.assertIn("**整体总结**", answer)
        checked = self.payloads(client)[-1]["modules"][-1]["text"]
        self.assertIn("暂无法确认", checked)
        self.assertNotIn("暂未提供", checked)
        self.assertEqual(self.payloads(client)[-1]["scope"]["confirmed_module_count"], 8)

    def test_mixed_missing_and_withheld_note_preserves_both_states(self):
        source = overview_tools(count=1, fields=2)
        order, catalog = deepcopy(source._order), deepcopy(source._catalog)
        order["report_data"]["report"]["item_0_0"] = None
        catalog["fields"][1]["frontend_processing"] = "未知转换"
        _, client, answer = self.run_overview(LocalReportTools(order, catalog))
        self.assertIn("**整体总结**", answer)
        text = self.payloads(client)[-1]["modules"][0]["text"]
        self.assertIn("部分信息暂未提供", text)
        self.assertIn("其余展示结果暂无法确认", text)

    def test_provided_zero_and_partial_unknown_keep_confirmed_module_text(self):
        source = overview_tools(count=1, fields=2)
        order, catalog = deepcopy(source._order), deepcopy(source._catalog)
        catalog["fields"][1]["frontend_processing"] = "未知转换"
        def mutate(stage, value, *_):
            if stage == "modules":
                value["modules"][0]["text"] = "近7天申请次数为0次，其余展示结果暂无法确认。"
            return value
        _, client, answer = self.run_overview(LocalReportTools(order, catalog), mutate)
        self.assertIn("近7天申请次数为0次", answer)
        checked = self.payloads(client)[-1]
        self.assertEqual(checked["scope"]["confirmed_module_count"], 1)
        self.assertIn("0次", checked["modules"][0]["text"])

    def test_confirmed_module_cannot_claim_local_batch_is_the_entire_report(self):
        for text in ("目前仅有这一模块，缺少其他模块信息。", "当前仅有这一项信息。",
                     "目前提供的报告内容不足以作进一步总结。", "无法据此概括整份报告。",
                     "当前报告只包含申请模块。", "目前只有测试模块信息。",
                     "本模块仅有申请信息，但整份报告只有申请模块。",
                     "不能认为当前仅有这一模块，但整份报告只包含申请模块。"):
            with self.subTest(text=text):
                def mutate(stage, value, payload, _):
                    if stage == "modules" and payload["scope"]["batch_module_count"] == 1:
                        value["modules"][0]["text"] = text
                    return value
                conversation, _, answer = self.run_overview(overview_tools(count=9), mutate)
                self.assertIn("将局部模块范围误作整份报告范围", answer)
                self.assertNotIn("**测试模块", answer)
                self.assertIsNone(conversation.analysis_context)

    def test_whole_word_is_not_banned_when_module_scope_is_accurate(self):
        def mutate(stage, value, *_):
            if stage == "modules":
                for row in value["modules"]:
                    row["text"] = "整体来看，本模块仅有申请信息，不能据此推断其他情况。"
            elif stage == "summary":
                value["text"] = "综合各模块，整体可以了解本报告的申请记录。"
            return value
        _, _, answer = self.run_overview(overview_tools(count=9), mutate)
        self.assertIn("**整体总结**", answer)
        self.assertIn("整体来看，本模块", answer)

    def test_denial_of_a_false_scope_is_not_a_positive_single_module_claim(self):
        def mutate(stage, value, *_):
            if stage == "modules":
                for row in value["modules"]:
                    row["text"] = "不能认为当前只有这一模块；整体来看，本模块有申请信息。"
            return value
        _, _, answer = self.run_overview(overview_tools(count=9), mutate)
        self.assertIn("**整体总结**", answer)
        self.assertIn("不能认为当前只有这一模块", answer)

    def test_truthful_single_module_scope_is_allowed_in_both_stages(self):
        def mutate(stage, value, *_):
            text = "当前报告仅有这一个模块，整体来看，可概括本模块申请信息。"
            if stage == "modules":
                value["modules"][0]["text"] = text
            elif stage == "summary":
                value["text"] = text
            return value
        _, _, answer = self.run_overview(overview_tools(count=1), mutate)
        self.assertIn("**整体总结**", answer)
        self.assertIn("当前报告仅有这一个模块", answer)

    def test_final_summary_cannot_erase_other_modules(self):
        def mutate(stage, value, *_):
            if stage == "summary":
                value["text"] = "目前仅有这一模块，暂无其他模块结果。"
            return value
        _, _, answer = self.run_overview(overview_tools(count=9), mutate)
        self.assertIn("详情：整体总结：将局部模块范围误作整份报告范围", answer)

    def test_confirmed_module_cannot_assert_other_modules_are_unavailable(self):
        for text in ("其余模块信息均未提供，当前报告暂无可确认结果。",
                     "整体来看，其他模块均无可确认结果。",
                     "其他模块都已有明确结果。", "其他模块信息不足。"):
            with self.subTest(text=text):
                def mutate(stage, value, payload, _):
                    if stage == "modules":
                        refs = {m["module_ref"] for m in payload["modules"] if m["name"] == "非银行申请"}
                        for row in value["modules"]:
                            if row["module_ref"] in refs:
                                row["text"] = text
                    return value
                _, _, answer = self.run_overview(display_tools(), mutate)
                self.assertIn("将局部模块范围误作整份报告范围", answer)
                self.assertNotIn("**非银行申请**", answer)

    def test_final_summary_cannot_narrow_whole_report_to_one_information_type(self):
        for text in ("这份报告只有手机在网信息。", "本报告只包含非银行申请信息。"):
            with self.subTest(text=text):
                def mutate(stage, value, *_):
                    if stage == "summary":
                        value["text"] = text
                    return value
                _, _, answer = self.run_overview(display_tools(), mutate)
                self.assertIn("详情：整体总结：将局部模块范围误作整份报告范围", answer)

    def test_confirmed_results_cannot_be_denied_at_any_module_count_boundary(self):
        for count in (1, 8, 9, 16, 17):
            for text in ("整份报告目前没有可用于总结的已确认信息。",
                         "暂无可供整体归纳的已确认结果。", "所有模块的信息均未提供。"):
                with self.subTest(count=count, text=text):
                    def mutate(stage, value, *_):
                        if stage == "summary":
                            value["text"] = text
                        return value
                    _, _, answer = self.run_overview(overview_tools(count=count), mutate)
                    self.assertIn("详情：整体总结：将局部模块范围误作整份报告范围", answer)

    def test_scope_conditions_and_denials_do_not_assert_others_availability(self):
        texts = ("如果其他模块没有可确认信息，应先核实对应模块。",
                 "不能认为其他模块没有可用信息。",
                 "本模块的结果不代表其他模块也没有结果。",
                 "其他模块是否有可确认信息，不能仅凭本模块判断。",
                 "其他模块的情况无法确认。",
                 "其他模块没有可确认结果时，应先核实对应模块。")
        for text in texts:
            with self.subTest(text=text):
                def mutate(stage, value, *_):
                    if stage == "modules":
                        for row in value["modules"]:
                            row["text"] = text
                    elif stage == "summary":
                        value["text"] = "不能认为报告没有可确认信息。"
                    return value
                _, _, answer = self.run_overview(overview_tools(count=9), mutate)
                self.assertIn("**整体总结**", answer)
                self.assertIn(text, answer)

    def test_partial_information_shortage_is_not_global_absence(self):
        for text in ("部分模块没有数据，其他模块仍有可确认结果。",
                     "当前报告未提供部分模块的信息，不能当作全报告没有数据。",
                     "报告没有全部信息，部分结果仍需核实。",
                     "没有可确认结果的模块需要进一步核实。",
                     "如果报告没有可确认结果，应补充相应资料。"):
            with self.subTest(text=text):
                def mutate(stage, value, *_):
                    if stage == "summary":
                        value["text"] = text
                    return value
                _, _, answer = self.run_overview(status_tools(9, {8: (None, "直接输出原值")}), mutate)
                self.assertIn("**整体总结**", answer)
                self.assertIn(text, answer)

    def test_provided_zero_is_a_confirmed_result_for_global_scope(self):
        def mutate(stage, value, *_):
            if stage == "summary":
                value["text"] = "报告没有可确认信息。"
            return value
        _, _, answer = self.run_overview(overview_tools(count=1), mutate)
        self.assertIn("详情：整体总结：将局部模块范围误作整份报告范围", answer)

    def test_actual_global_information_shortage_is_allowed_only_in_summary(self):
        def mutate(stage, value, *_):
            if stage == "summary":
                value["text"] = "目前提供的报告内容不足以作进一步总结。"
            return value
        changes = {i: (None, "直接输出原值") for i in range(9)}
        _, client, answer = self.run_overview(status_tools(9, changes), mutate)
        self.assertIn("**整体总结**", answer)
        self.assertEqual(self.payloads(client)[-1]["scope"]["confirmed_module_count"], 0)

    def test_local_missing_replacement_still_rejects_cross_module_sources(self):
        def mutate(stage, value, payload, _):
            if stage == "modules":
                for row in value["modules"]:
                    row["sources"] = ["f9999"]
            return value
        _, _, answer = self.run_overview(status_tools(1, {0: (None, "直接输出原值")}), mutate)
        self.assertIn("来源引用缺失、重复或不属于当前模块", answer)
        self.assertNotIn("**测试模块", answer)

    def test_scope_metadata_is_counted_before_the_first_model_request(self):
        tools = overview_tools(count=1)
        strategy = AnalysisStrategy(tools)
        overview = ReportOverview(tools, strategy.projection, strategy._check_text, json.loads)
        modules = overview._prepare()
        question = "按模块分析整份报告并整体总结"
        complete_size = len(encode({"question": question, "modules": modules,
                                    "scope": overview._scope(modules, "modules", 1)}))
        with patch("report_assistant.conversation.overview.MAX_PAYLOAD_CHARS", complete_size - 1):
            _, client, answer = self.run_overview(tools)
        self.assertEqual(client.requests, [])
        self.assertIn("改用本地", answer)

    def test_sourced_callback_is_optional_and_original_four_arguments_work(self):
        strategy = AnalysisStrategy(phone_bank_tools())
        overview = ReportOverview(strategy.tools, strategy.projection, strategy._check_text, json.loads)
        bank = next(ref for ref, field in strategy.projection.fields.items() if field["public"]["name"] == "银行申请次数")
        fact = strategy.projection.read([bank])[0]
        self.assertIsNone(overview.check_sourced_text)
        section = overview._validate({"text": "本模块有申请信息。", "sources": [fact["field_ref"]]}, {fact["field_ref"]: fact})
        self.assertEqual(section["text"], "本模块有申请信息。")

    def test_all_sources_and_allowed_set_are_checked_before_sourced_callback(self):
        strategy = AnalysisStrategy(phone_bank_tools())
        callback = Mock(wraps=strategy._check_sourced_text)
        overview = ReportOverview(strategy.tools, strategy.projection, strategy._check_text, json.loads,
                                  check_sourced_text=callback)
        refs = list(strategy.projection.fields)
        facts = {f["field_ref"]: f for start in range(0, len(refs), 12)
                 for f in strategy.projection.read(refs[start:start + 12])}
        phone = next(ref for ref, f in facts.items() if f["name"] == "手机在网时长")
        bank = next(ref for ref, f in facts.items() if f["name"] == "银行申请次数")
        for sources, allowed in (([phone, "f9999"], None), ([phone, phone], None), ([phone], {bank})):
            with self.subTest(sources=sources, allowed=allowed), self.assertRaises(PrivacyError):
                overview._validate({"text": "该手机号的业务使用情况已有说明。", "sources": sources}, facts, allowed)
        callback.assert_not_called()

    def test_real_phone_section_accepts_neutral_reference_but_bank_does_not(self):
        for target, accepted in (("手机在网", True), ("银行申请", False)):
            with self.subTest(target=target):
                def mutate(stage, value, payload, _):
                    if stage == "modules":
                        refs = {m["module_ref"] for m in payload["modules"] if m["name"] == target}
                        for row in value["modules"]:
                            if row["module_ref"] in refs:
                                row["text"] = "该手机号的业务使用情况已有说明。"
                    return value
                _, _, answer = self.run_overview(phone_bank_tools(), mutate)
                self.assertEqual("**整体总结**" in answer, accepted)
                if accepted:
                    self.assertIn("该手机号的业务使用情况已有说明", answer)
                else:
                    self.assertIn("未通过本地校验", answer)

    def test_final_summary_phone_permission_depends_only_on_its_actual_sources(self):
        for source_name, accepted in (("手机在网", True), ("银行申请", False)):
            with self.subTest(source_name=source_name):
                def mutate(stage, value, payload, _):
                    if stage == "summary":
                        section = next(m for m in payload["modules"] if m["name"] == source_name)
                        value["sources"] = section["sources"]
                        value["text"] = "该手机号的业务使用情况已有说明。"
                    return value
                _, _, answer = self.run_overview(phone_bank_tools(), mutate)
                self.assertEqual("**整体总结**" in answer, accepted)
                if not accepted:
                    self.assertIn("未通过本地校验", answer)

    def test_summary_source_metadata_does_not_authorize_unshown_original_numbers(self):
        def mutate(stage, value, payload, _):
            if stage == "modules":
                refs = {m["module_ref"] for m in payload["modules"] if m["name"] == "手机在网"}
                for row in value["modules"]:
                    if row["module_ref"] in refs:
                        row["text"] = "该手机号的业务使用情况已有说明。"
            elif stage == "summary":
                section = next(m for m in payload["modules"] if m["name"] == "手机在网")
                value["sources"] = section["sources"]
                value["text"] = "该手机号在网时长为24个月以上。"
            return value
        _, _, answer = self.run_overview(phone_bank_tools(), mutate)
        self.assertIn("详情：整体总结：包含来源未支持的数字", answer)

    def test_phone_source_does_not_authorize_an_actual_phone_number(self):
        def mutate(stage, value, payload, _):
            if stage == "modules":
                refs = {m["module_ref"] for m in payload["modules"] if m["name"] == "手机在网"}
                for row in value["modules"]:
                    if row["module_ref"] in refs:
                        row["text"] = "手机号为13800000000。"
            return value
        _, _, answer = self.run_overview(phone_bank_tools(), mutate)
        self.assertIn("未通过本地校验", answer)
        self.assertNotIn("13800000000", answer)

    def test_summary_preserves_displayed_phone_lower_bound_and_explicit_minimum(self):
        for module_text, summary_text in (("24个月以上，具体时长无法确认。", "手机在网时长为24个月以上。"),
                                          ("下限为24个月，具体时长无法确认。", "手机在网时长至少24个月。")):
            with self.subTest(module_text=module_text):
                def mutate(stage, value, payload, _):
                    if stage == "modules":
                        refs = {m["module_ref"] for m in payload["modules"] if m["name"] == "手机在网"}
                        for row in value["modules"]:
                            if row["module_ref"] in refs:
                                row["text"] = module_text
                    elif stage == "summary":
                        section = next(m for m in payload["modules"] if m["name"] == "手机在网")
                        value["sources"] = section["sources"]
                        value["text"] = summary_text
                    return value
                _, _, answer = self.run_overview(phone_bank_tools(), mutate)
                self.assertIn("**整体总结**", answer)
                self.assertIn(summary_text, answer)

    def test_mixed_summary_durations_keep_their_own_metric_and_bound(self):
        summary = "手机在网时长至少24个月，贷款期限为36个月。"
        def mutate(stage, value, payload, _):
            if stage == "modules":
                refs = {m["module_ref"] for m in payload["modules"] if m["name"] == "手机在网"}
                for row in value["modules"]:
                    if row["module_ref"] in refs:
                        row["text"] = "手机在网时长为24个月以上，贷款期限为36个月。"
            elif stage == "summary":
                section = next(m for m in payload["modules"] if m["name"] == "手机在网")
                value["sources"] = section["sources"]
                value["text"] = summary
            return value
        _, _, answer = self.run_overview(phone_loan_tools(), mutate)
        self.assertIn("**整体总结**", answer)
        self.assertIn(summary, answer)

    def test_other_duration_in_same_module_and_summary_cannot_become_phone_duration(self):
        for summary in ("手机在网时长至少36个月。", "手机在网时长为36个月。"):
            with self.subTest(summary=summary):
                def mutate(stage, value, payload, _):
                    if stage == "modules":
                        refs = {m["module_ref"] for m in payload["modules"] if m["name"] == "手机在网"}
                        for row in value["modules"]:
                            if row["module_ref"] in refs:
                                row["text"] = "手机在网时长为24个月以上，贷款期限为36个月。"
                    elif stage == "summary":
                        section = next(m for m in payload["modules"] if m["name"] == "手机在网")
                        value["sources"] = section["sources"]
                        value["text"] = summary
                    return value
                _, _, answer = self.run_overview(phone_loan_tools(), mutate)
                self.assertIn("详情：整体总结：包含来源未支持的数字", answer)
                self.assertNotIn("**手机在网**", answer)

    def test_same_numeric_key_from_loan_only_text_does_not_display_phone_duration(self):
        for summary, accepted in (("贷款期限至少24个月。", True), ("手机在网时长至少24个月。", False)):
            with self.subTest(summary=summary):
                def mutate(stage, value, payload, _):
                    if stage == "modules":
                        refs = {m["module_ref"] for m in payload["modules"] if m["name"] == "手机在网"}
                        for row in value["modules"]:
                            if row["module_ref"] in refs:
                                # 原phone/loan均为24下界，但这里只展示了loan的24，不展示phone时长。
                                row["text"] = "运营商显示为虚构运营商，贷款期限至少24个月。"
                    elif stage == "summary":
                        section = next(m for m in payload["modules"] if m["name"] == "手机在网")
                        value["sources"] = section["sources"]
                        value["text"] = summary
                    return value
                _, _, answer = self.run_overview(phone_loan_tools("24个月以上"), mutate)
                self.assertEqual("**整体总结**" in answer, accepted)
                if not accepted:
                    self.assertIn("详情：整体总结：包含来源未支持的数字", answer)

    def test_summary_isp_reference_can_represent_the_checked_phone_source_group(self):
        """总结只收到不透明sources数组，不应要求模型猜其中哪个引用是min字段。"""
        tools = phone_bank_tools()
        strategy = AnalysisStrategy(tools)
        isp = next(ref for ref, field in strategy.projection.fields.items() if field["local"]["path"].endswith(".isp"))
        def mutate(stage, value, payload, _):
            if stage == "modules":
                refs = {m["module_ref"] for m in payload["modules"] if m["name"] == "手机在网"}
                for row in value["modules"]:
                    if row["module_ref"] in refs:
                        row["text"] = "手机在网时长为24个月以上，运营商显示为虚构运营商。"
            elif stage == "summary":
                value["sources"] = [isp]
                value["text"] = "手机在网时长至少24个月。"
            return value
        _, _, answer = self.run_overview(tools, mutate)
        self.assertIn("**整体总结**", answer)
        self.assertIn("手机在网时长至少24个月", answer)

    def test_summary_sibling_reference_uses_only_its_own_checked_source_group(self):
        """同小结引用可代表该小结；其他模块的银行引用不能继承phone语境或时长。"""
        tools = phone_loan_tools()
        strategy = AnalysisStrategy(tools)
        refs = {name: next(ref for ref, field in strategy.projection.fields.items()
                          if field["local"]["path"].endswith("." + name)) for name in ("loan_term", "bank_M1_count")}
        for source_name, accepted in (("loan_term", True), ("bank_M1_count", False)):
            with self.subTest(source_name=source_name):
                def mutate(stage, value, payload, _):
                    if stage == "modules":
                        phone_refs = {m["module_ref"] for m in payload["modules"] if m["name"] == "手机在网"}
                        for row in value["modules"]:
                            if row["module_ref"] in phone_refs:
                                row["text"] = "手机在网时长为24个月以上，运营商显示为虚构运营商。"
                    elif stage == "summary":
                        value["sources"] = [refs[source_name]]
                        value["text"] = "该手机号在网时长至少24个月。"
                    return value
                _, _, answer = self.run_overview(tools, mutate)
                self.assertEqual("**整体总结**" in answer, accepted)
                if not accepted:
                    self.assertIn("未通过本地校验", answer)
