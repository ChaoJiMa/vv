"""整份报告的顺序、完整读取、简洁输出、失败原子性及真实SDK内存回归。"""

from copy import deepcopy
import json
from types import SimpleNamespace as NS
from unittest.mock import patch

import test_analysis as analysis
import test_model_provider as providers
import test_privacy as support
from local_history import HistoryError
from report_analysis import AnalysisContext, AnalysisFailure, MIXED_INSTRUCTION
from report_service import HOTLINE, service_reply
from report_overview import OverviewValidationError
from report_privacy import PrivacyError
from report_questions import is_report_overview
from report_session import Conversation
from report_tools import LocalReportTools


def overview_tools(count=3, fields=1, reverse=False):
    """构造模块目录与模板顺序可独立变化的虚构报告，不读取真实数据文件。"""
    order, catalog = support.fixtures(61.25)
    catalog["fields"] = []
    modules, report = [], order["report_data"]["report"]
    for i in range(count):
        mid, name = i + 20, "测试模块" + chr(65 + i % 26)
        modules.append({"moduleId": mid, "moduleName": name})
        for j in range(fields):
            key = f"item_{i}_{j}"
            report[key] = i + j
            catalog["fields"].append({"module_id": mid, "module_name": name,
                                      "name": "申请次数", "path": "report." + key, "window": "近7天", "frontend_processing": "直接输出原值"})
    order["report_data"]["template"]["modules"] = modules[::-1] if reverse else modules
    return LocalReportTools(order, catalog)


class OverviewClient:
    """根据实际批准的输入生成协议响应，可在边界注入失败或不可信输出。"""

    def __init__(self, mutate=None):
        self.requests, self.mutate = [], mutate
        self.chat = NS(completions=NS(create=self.create))

    def create(self, **options):
        self.requests.append(deepcopy(options))
        try:
            payload = json.loads(options["messages"][-1]["content"])
        except ValueError:
            payload = {}
        if not payload.get("modules"):
            stage = "route"
            value = {"route": "report", "use_previous": False, "scope": "overview"}
        elif "facts" in payload["modules"][0]:
            stage = "modules"
            value = {"modules": [{"module_ref": m["module_ref"],
                                  "text": "本模块登记了申请信息，可结合周期变化了解申请情况。",
                                  "sources": [f["field_ref"] for f in m["facts"]]}
                                 for m in reversed(payload["modules"])]}
        else:
            stage = "summary"
            value = {"text": "综合各模块，主要可关注申请记录及周期变化，未提供的信息仍需进一步核对。",
                     "sources": payload["modules"][0]["sources"]}
        if self.mutate:
            value = self.mutate(stage, value, payload, len(self.requests))
        return analysis.response(json.dumps(value, ensure_ascii=False))


class OverviewTests(support.NoExternalIO):
    def test_overview_with_service_keeps_service_instruction_for_every_stage(self):
        """整份报告与退款共问时，每批及整体总结都应交由本地客服处理业务说明。"""
        def mutate(stage, value, *_):
            if stage == "route":
                value["service_topics"] = ["refund"]
            return value

        _, client, answer = self.run_overview(client=OverviewClient(mutate),
            question="先按模块分析整份报告并整体总结，最后说一下买错报告怎么退款。")
        self.assertEqual(len(client.requests), 3)
        self.assertEqual(answer.count(service_reply("refund")), 1)
        for request in client.requests[1:]:
            self.assertIn(MIXED_INSTRUCTION, [message["content"] for message in request["messages"]
                                            if message["role"] == "system"])
        self.assertNotIn(HOTLINE, json.dumps(client.requests, ensure_ascii=False))

    def run_overview(self, tools=None, client=None, question="分析下我的报告"):
        conversation = Conversation(tools or overview_tools(), strategy="analysis")
        client = client or OverviewClient()
        answer = conversation.answer(question, client, "synthetic-model")
        return conversation, client, answer

    def single_value_tools(self, value):
        """重建单字段虚构报告，避免多个来源的零值掩盖总结阶段的状态丢失。"""
        source = overview_tools(count=1)
        source._order["report_data"]["report"]["item_0_0"] = value
        return LocalReportTools(source._order, source._catalog)

    def test_missing_status_survives_into_summary_number_validation(self):
        def mutate(stage, value, *_):
            if stage == "modules":
                value["modules"][0]["text"] = "申请数据暂未提供，无法确认具体次数。"
            elif stage == "summary":
                value["text"] = "申请数据暂未提供，不能按0次理解。"
            return value
        conversation, client, answer = self.run_overview(self.single_value_tools(None), OverviewClient(mutate))
        self.assertIn("**整体总结**", answer)
        self.assertIn("不能按0次理解", answer)
        self.assertEqual(len(client.requests), 2)
        self.assertIsNotNone(conversation.analysis_context)

    def test_missing_summary_cannot_add_affirmative_zero_or_unverified_amount(self):
        for text in ("申请次数为0次。", "申请数据暂未提供，不能按0次理解，余额为999元。"):
            with self.subTest(text=text):
                def mutate(stage, value, *_):
                    if stage == "modules":
                        value["modules"][0]["text"] = "申请数据暂未提供。"
                    elif stage == "summary":
                        value["text"] = text
                    return value
                _, _, answer = self.run_overview(self.single_value_tools(None), OverviewClient(mutate))
                self.assertIn("详情：整体总结：包含来源未支持的数字", answer)

    def test_negated_overdue_confirmation_is_not_a_positive_guarantee(self):
        for text in ("不能确定没有逾期记录。", "无法确认您没有逾期记录。", "不能据此确认无逾期。"):
            with self.subTest(text=text):
                def mutate(stage, value, *_):
                    if stage == "modules":
                        value["modules"][0]["text"] = text
                    elif stage == "summary":
                        value["text"] = text
                    return value
                _, _, answer = self.run_overview(client=OverviewClient(mutate))
                self.assertIn("**整体总结**", answer)

    def test_positive_claim_after_negated_confirmation_is_still_rejected(self):
        def mutate(stage, value, *_):
            if stage == "modules":
                value["modules"][0]["text"] = "不能确定没有逾期记录；您的报告没有逾期。"
            return value
        _, _, answer = self.run_overview(client=OverviewClient(mutate))
        self.assertIn("包含未经支持的分档或逾期判断", answer)

    def test_direct_negation_is_safe_but_cannot_hide_later_guarantee(self):
        for text, accepted in (("这些信息不能直接说明没有逾期。", True),
                               ("不能据此直接说明没有逾期。", True),
                               ("无法直接确认无逾期。", True),
                               ("不能直接说明没有逾期；但您的报告没有逾期。", False),
                               ("不能直接说明没有逾期。您的报告无逾期。", False)):
            with self.subTest(text=text):
                def mutate(stage, value, *_):
                    if stage == "modules":
                        value["modules"][0]["text"] = text
                    elif stage == "summary":
                        value["text"] = text
                    return value
                _, _, answer = self.run_overview(client=OverviewClient(mutate))
                self.assertEqual("**整体总结**" in answer, accepted)

    def test_negation_covers_coordinated_conclusions_but_not_separate_guarantees(self):
        accepted = ("不能据此判断没有逾期或无风险。", "不代表无逾期、无风险。",
                    "不能直接说明没有逾期以及没有任何风险。")
        rejected = ("不能判断没有逾期或无风险；您的报告无风险。",
                    "不能判断没有逾期或无风险，但您的报告没有逾期。",
                    "不能判断没有逾期，无风险。", "不能判断没有逾期或您的报告无风险。")
        for text in accepted + rejected:
            with self.subTest(text=text):
                def mutate(stage, value, *_):
                    if stage == "modules":
                        value["modules"][0]["text"] = text
                    elif stage == "summary":
                        value["text"] = text
                    return value
                _, _, answer = self.run_overview(client=OverviewClient(mutate))
                self.assertEqual("**整体总结**" in answer, text in accepted)

    def test_sole_evidence_negation_preserves_evidence_and_later_assertions(self):
        accepted = ("不能仅凭已展示的零值或分数结果就判断整体无风险。",
                    "无法仅凭这些信息确认没有逾期或无风险。")
        rejected = ("不能仅凭这些信息判断整体无风险；您的报告无风险。",
                    "不能仅凭这些信息，但可以判断整体无风险。",
                    "不能仅凭这些信息但可以判断整体无风险。",
                    "不能仅凭无风险的信息判断整体无风险。",
                    "不能仅凭这些信息就不判断整体无风险。")
        for text in accepted + rejected:
            with self.subTest(text=text):
                def mutate(stage, value, *_):
                    if stage == "modules":
                        value["modules"][0]["text"] = text
                    elif stage == "summary":
                        value["text"] = text
                    return value
                _, _, answer = self.run_overview(client=OverviewClient(mutate))
                self.assertEqual("**整体总结**" in answer, text in accepted)

    def test_thousands_separator_preserves_verified_number(self):
        def mutate(stage, value, *_):
            if stage == "modules":
                value["modules"][0]["text"] = "申请次数显示为1,000次。"
            elif stage == "summary":
                value["text"] = "申请次数显示为1000次。"
            return value
        _, _, answer = self.run_overview(self.single_value_tools(1000), OverviewClient(mutate))
        self.assertIn("**整体总结**", answer)
        self.assertIn("1,000次", answer)

    def test_thousands_separator_does_not_approve_changed_or_malformed_numbers(self):
        from report_projection import check_answer_numbers
        for text in ("1,001次", "10,00次", "1,000,00次", "1,000.5次"):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, [{"status": "provided", "value": 1000}])
        with self.assertRaises(PrivacyError):
            check_answer_numbers("1,000次", [{"status": "provided", "value": [1, 0]}])

    def test_date_format_changes_pass_in_modules_and_summary(self):
        def mutate(stage, value, *_):
            if stage == "modules":
                value["modules"][0]["text"] = "报告生成于2024年5月7日。"
            elif stage == "summary":
                value["text"] = "本次报告日期为2024/05/07。"
            return value
        _, client, answer = self.run_overview(self.single_value_tools("2024-05-07"), OverviewClient(mutate))
        self.assertIn("**整体总结**", answer)
        self.assertEqual(len(client.requests), 2)

    def test_date_separators_and_padding_preserve_the_complete_date(self):
        from report_projection import check_answer_numbers
        for source in ("2024-05-07", "2024/5/7", "2024.05.07", "2024年05月07日", "2024-05-07T08:09:10"):
            for text in ("日期2024年5月7日", "日期2024-5-7", "日期2024/05/07", "日期2024.5.7"):
                with self.subTest(source=source, text=text):
                    check_answer_numbers(text, [{"status": "provided", "value": source}])

    def test_changed_date_cannot_reuse_other_source_numbers(self):
        from report_projection import check_answer_numbers
        facts = [{"status": "provided", "value": ["2024-05-07", 6, 31]}]
        for text in ("2024年7月5日", "2024年6月7日", "2024年5月31日", "2025年5月7日", "2024年5月7日，金额999元"):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)

    def test_date_normalization_does_not_change_signed_values(self):
        from report_projection import check_answer_numbers
        facts = [{"status": "provided", "value": ["2024-05-07", -19]}]
        check_answer_numbers("日期2024年5月7日，变动-19元", facts)
        for text in ("变动19元", "日期2024年5月7日，变动19元", "日期2024年5月7日，变动-5元"):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)
        with self.assertRaises(PrivacyError):
            check_answer_numbers("变动-19元", [{"status": "provided", "value": 19}])

    def test_page_percentage_is_allowed_in_modules_and_summary(self):
        def mutate(stage, value, *_):
            if stage == "modules":
                value["modules"][0]["text"] = "还款成功率显示为0%，不能据此判断其他周期。"
            elif stage == "summary":
                value["text"] = "本项还款成功率显示为0%。"
            return value
        _, _, answer = self.run_overview(self.single_value_tools("0%"), OverviewClient(mutate))
        self.assertIn("**整体总结**", answer)
        self.assertIn("成功率显示为0%", answer)

    def test_percentage_requires_exact_display_source_not_plain_number_or_scaling(self):
        from report_projection import check_answer_numbers
        check_answer_numbers("成功率为32%。", [{"status": "provided", "value": "32%"}])
        for text, value in (("成功率0%", 0), ("成功率32%", 0.32), ("成功率31%", "32%")):
            with self.subTest(text=text, value=value), self.assertRaises(PrivacyError):
                check_answer_numbers(text, [{"status": "provided", "value": value}])

    def test_supported_percentage_cannot_authorize_approval_prediction(self):
        def mutate(stage, value, *_):
            if stage == "modules":
                value["modules"][0]["text"] = "审批通过概率为80%。"
            return value
        _, _, answer = self.run_overview(self.single_value_tools("80%"), OverviewClient(mutate))
        self.assertIn("未通过本地校验", answer)

    def test_validation_details_identify_batch_and_summary_without_publishing_draft(self):
        def mutate(stage, value, _, request_index):
            if stage == "modules" and request_index == 2:
                value["modules"][0]["text"] = "未经支持的999999次申请。"
            return value
        _, client, answer = self.run_overview(overview_tools(count=10), OverviewClient(mutate))
        self.assertEqual(len(client.requests), 2)
        self.assertIn("详情：第2批模块小结（本批第1项）：包含来源未支持的数字", answer)
        self.assertNotIn("999999", answer)
        self.assertNotIn("**测试模块", answer)

    def test_unknown_validation_error_and_stage_cannot_echo_exception_or_identifier(self):
        error = OverviewValidationError(PrivacyError("SYNTHETIC_SECRET_RESPONSE"), "SYNTHETIC_STAGE", "secret", "secret")
        failure = AnalysisFailure("answer", error)
        self.assertEqual(error.code, "validation")
        self.assertNotIn("SYNTHETIC", str(failure))
        self.assertIn("报告准备阶段", str(failure))
        with self.assertRaises(ValueError):
            AnalysisFailure("answer", PrivacyError("SYNTHETIC_SECRET_RESPONSE"))

    def test_user_phrases_and_focused_questions_remain_distinct(self):
        for question in ("分析下我的报告", "请帮我分析一下我的报告", "你好，分析我的报告", "按模块总结我的报告", "整体分析这份报告，然后做个整体总结"):
            with self.subTest(question=question):
                self.assertTrue(is_report_overview(question))
                _, client, answer = self.run_overview(question=question)
                self.assertIn("整体总结", answer)
                self.assertEqual(len(client.requests), 2)
        for question in ("分析报告中的指数", "看看报告里的银行申请", "你好", "分析下我的报告，手机号13800000000"):
            self.assertFalse(is_report_overview(question))

    def test_template_order_is_preserved_despite_catalog_and_response_order(self):
        _, client, answer = self.run_overview(overview_tools(reverse=True))
        titles = ["**测试模块C**", "**测试模块B**", "**测试模块A**", "**整体总结**"]
        self.assertEqual(sorted(answer.index(t) for t in titles), [answer.index(t) for t in titles])
        self.assertTrue(all("tools" not in request for request in client.requests))
        for marker in ("依据（", "[f1]", "field_ref", "登记统计字段的原始值"):
            self.assertNotIn(marker, answer)

    def test_all_fields_and_late_modules_are_read_beyond_focused_budget(self):
        conversation, client, answer = self.run_overview(overview_tools(count=10, fields=15))
        batches = [json.loads(req["messages"][-1]["content"])["modules"] for req in client.requests[:-1]]
        self.assertEqual([len(b) for b in batches], [8, 2])
        self.assertEqual(sum(len(m["facts"]) for batch in batches for m in batch), 150)
        self.assertEqual(len(conversation.analysis_context.field_refs), 150)
        self.assertIn("**测试模块J**", answer)
        self.assertEqual(len(client.requests), 3)

    def test_large_modules_split_batches_without_sampling_or_truncation(self):
        _, client, answer = self.run_overview(overview_tools(count=2, fields=146))
        self.assertIn("整体总结", answer)
        self.assertEqual(len(client.requests), 3)
        for req in client.requests[:-1]:
            payload = json.loads(req["messages"][-1]["content"])
            self.assertEqual(len(payload["modules"]), 1)
            self.assertEqual(len(payload["modules"][0]["facts"]), 146)

    def test_maximum_module_boundary_is_fully_covered(self):
        conversation, client, answer = self.run_overview(overview_tools(count=96))
        self.assertEqual(len(client.requests), 13)
        self.assertEqual(answer.count("**测试模块"), 96)
        self.assertEqual(len(conversation.analysis_context.field_refs), 96)

    def test_missing_null_empty_and_zero_are_preserved(self):
        order, catalog = support.fixtures(61.25)
        order["report_data"]["report"]["synthetic_M1_COUNT"] = None
        catalog["fields"].append({"module_id": 9, "module_name": "非银行申请", "name": "夜间申请次数", "path": "report.empty", "frontend_processing": "直接输出原值"})
        order["report_data"]["report"]["empty"] = ""
        _, client, _ = self.run_overview(LocalReportTools(order, catalog))
        facts = json.loads(client.requests[0]["messages"][-1]["content"])["modules"][1]["facts"]
        self.assertEqual([f["status"] for f in facts], ["provided", "null", "missing", "empty"])
        self.assertEqual(facts[0]["value"], 0)
        self.assertTrue(all("value" not in f for f in facts[1:]))

    def test_unavailable_and_identity_only_modules_keep_template_positions(self):
        order, catalog = support.fixtures(61.25)
        order["report_data"]["template"]["modules"].insert(1, {"moduleId": 88, "moduleName": "身份模块"})
        order["report_data"]["template"]["modules"].append({"moduleId": 89, "moduleName": "未登记模块"})
        catalog["fields"].append({"module_id": 88, "module_name": "身份模块", "name": "姓名", "path": "report.person.name"})
        order["report_data"]["report"]["person"] = {"name": "虚构张三"}
        _, client, answer = self.run_overview(LocalReportTools(order, catalog))
        self.assertLess(answer.index("**身份模块**"), answer.index("**非银行申请**"))
        self.assertIn("**未登记模块**", answer)
        self.assertEqual(answer.count("该模块暂无可用于自动总结的信息"), 2)
        self.assertNotIn("虚构张三", json.dumps(client.requests, ensure_ascii=False))

    def test_duplicate_template_modules_are_not_summarized_twice(self):
        order, catalog = support.fixtures(61.25)
        order["report_data"]["template"]["modules"].append(order["report_data"]["template"]["modules"][0])
        _, _, answer = self.run_overview(LocalReportTools(order, catalog))
        self.assertEqual(answer.count("**测试指数模块**"), 1)

    def test_all_unavailable_modules_need_no_model_call(self):
        order, catalog = support.fixtures(61.25)
        catalog["fields"] = []
        _, client, answer = self.run_overview(LocalReportTools(order, catalog))
        self.assertEqual(client.requests, [])
        self.assertIn("整体总结", answer)
        self.assertIn("暂没有可用于自动总结的信息", answer)

    def test_summary_receives_checked_summaries_without_raw_facts_or_history(self):
        conversation = Conversation(overview_tools(), strategy="analysis")
        conversation.analysis_context = AnalysisContext("旧报告问题", ("f1",))
        conversation.local_history.append({"question": "旧问题", "answer": "旧答案"})
        client = OverviewClient()
        answer = conversation.answer("分析下我的报告", client, "synthetic-model")
        self.assertIn("整体总结", answer)
        payload = json.loads(client.requests[-1]["messages"][-1]["content"])
        self.assertTrue(all(set(m) == {"module_ref", "name", "text", "sources"} for m in payload["modules"]))
        for marker in ("旧报告问题", "旧答案", "previous_question", '"value"', '"facts"'):
            self.assertNotIn(marker, json.dumps(client.requests, ensure_ascii=False) if marker.startswith("旧") or marker == "previous_question" else json.dumps(payload))

    def test_semantic_overview_route_and_invalid_scope(self):
        _, client, answer = self.run_overview(question="整体看看，有哪些值得关注的地方")
        self.assertIn("整体总结", answer)
        self.assertEqual(len(client.requests), 3)
        def invalid(stage, value, *_):
            if stage == "route":
                value["scope"] = "all_raw"
            return value
        _, client, answer = self.run_overview(client=OverviewClient(invalid), question="整体看看，有哪些值得关注的地方")
        self.assertIn("问题路由格式未通过校验", answer)
        self.assertEqual(len(client.requests), 1)

    def test_incomplete_extra_duplicate_and_cross_module_responses_are_rejected(self):
        def bad_rows(mode):
            def mutate(stage, value, *_):
                if stage == "modules":
                    rows = value["modules"]
                    if mode == "missing":
                        rows.pop()
                    elif mode == "extra":
                        rows.append(deepcopy(rows[0]))
                    elif mode == "duplicate":
                        rows[1] = deepcopy(rows[0])
                    elif mode == "cross":
                        rows[0]["sources"] = rows[1]["sources"]
                    else:
                        rows[0]["sources"] = ["f9999"]
                return value
            return mutate
        for mode in ("missing", "extra", "duplicate", "cross", "unknown"):
            with self.subTest(mode=mode):
                conversation, client, answer = self.run_overview(client=OverviewClient(bad_rows(mode)))
                self.assertIn("分析回答未通过本地校验", answer)
                self.assertEqual(len(client.requests), 1)
                self.assertIsNone(conversation.analysis_context)
                self.assertNotIn("**测试模块", answer)

    def test_field_dump_fabricated_digits_and_unfounded_claims_are_rejected(self):
        for text in ("当前值为999999。", "[f1] 字段为0。", "f1字段有记录。", "[Ｆ１]有记录。", "字段说明\n另一个字段说明", "登记统计字段的原始值。", "当前为最低档。", "没有逾期。", "审批会通过。", "信用良好。", "授信概率80%。", "内容" * 230):
            with self.subTest(text=text):
                def mutate(stage, value, *_):
                    if stage == "modules":
                        value["modules"][0]["text"] = text
                    return value
                _, _, answer = self.run_overview(client=OverviewClient(mutate))
                self.assertIn("分析回答未通过本地校验", answer)

    def test_summary_cannot_add_digits_only_present_in_raw_fields(self):
        def mutate(stage, value, *_):
            if stage == "summary":
                value["text"] = "总值为0。"
            return value
        _, client, answer = self.run_overview(client=OverviewClient(mutate))
        self.assertEqual(len(client.requests), 2)
        self.assertIn("分析回答未通过本地校验", answer)

    def test_summary_cannot_cite_a_field_not_used_in_module_text(self):
        def mutate(stage, value, payload, index):
            if stage == "modules":
                for row in value["modules"]:
                    row["sources"] = row["sources"][:1]
            elif stage == "summary":
                value["sources"] = ["f2"]
            return value
        _, client, answer = self.run_overview(tools=overview_tools(count=1, fields=2), client=OverviewClient(mutate))
        self.assertEqual(len(client.requests), 2)
        self.assertIn("分析回答未通过本地校验", answer)

    def test_module_and_summary_requests_reject_tool_calls(self):
        for attacked_request in (1, 2):
            with self.subTest(attacked_request=attacked_request):
                client = OverviewClient()
                original = client.create
                def create(**options):
                    result = original(**options)
                    if len(client.requests) == attacked_request:
                        result.choices[0].message.tool_calls = analysis.call("dump_report", {}).choices[0].message.tool_calls
                    return result
                client.chat.completions.create = create
                _, _, answer = self.run_overview(client=client)
                self.assertIn("分析回答未通过本地校验", answer)
                self.assertEqual(len(client.requests), attacked_request)

    def test_supported_digits_can_appear_naturally_in_both_summaries(self):
        def mutate(stage, value, *_):
            if stage == "modules":
                value["modules"][0]["text"] = "近7天登记申请次数为0，其他情况需结合记录核对。"
            elif stage == "summary":
                value["text"] = "近7天登记申请次数为0，后续可结合更长周期了解情况。"
            return value
        _, _, answer = self.run_overview(tools=overview_tools(count=1), client=OverviewClient(mutate))
        self.assertIn("近7天登记申请次数为0", answer)
        self.assertNotIn("改用本地", answer)

    def test_oversized_reports_fail_before_model_calls(self):
        for tools in (overview_tools(count=97), overview_tools(count=1, fields=257), overview_tools(count=17, fields=250)):
            with self.subTest(fields=len(tools.current_fields())):
                conversation, client, answer = self.run_overview(tools)
                self.assertEqual(client.requests, [])
                self.assertIn("改用本地", answer)
                self.assertIsNone(conversation.analysis_context)
        with patch("report_overview.MAX_PAYLOAD_CHARS", 10):
            _, client, answer = self.run_overview()
            self.assertEqual(client.requests, [])
            self.assertIn("改用本地", answer)
        with patch("report_overview.MAX_BATCHES", 1):
            _, client, answer = self.run_overview(tools=overview_tools(count=9))
            self.assertEqual(client.requests, [])
            self.assertIn("改用本地", answer)

    def test_failed_batch_does_not_publish_partial_report_or_commit_context(self):
        def mutate(stage, value, payload, index):
            if index == 2:
                raise RuntimeError(support.PRIVATE_VALUE)
            return value
        conversation = Conversation(overview_tools(count=10), strategy="analysis")
        before = AnalysisContext("之前的问题", ("f1",))
        conversation.analysis_context = before
        answer = conversation.answer("分析下我的报告", OverviewClient(mutate), "synthetic-model")
        self.assertIn("改用本地", answer)
        self.assertNotIn("**测试模块", answer)
        self.assertNotIn(support.PRIVATE_VALUE, answer)
        self.assertIsNone(conversation.analysis_context)
        self.assertEqual(conversation.local_history[-1]["answer"], answer)

    def test_failed_encrypted_save_does_not_commit_successful_overview(self):
        history = NS(read=lambda _: [], append=lambda *_: (_ for _ in ()).throw(HistoryError("synthetic failure")))
        conversation = Conversation(overview_tools(), history, strategy="analysis")
        before = deepcopy((conversation.analysis_context, conversation.local_history, conversation.last_query))
        with self.assertRaises(HistoryError):
            conversation.answer("分析下我的报告", OverviewClient(), "synthetic-model")
        self.assertEqual((conversation.analysis_context, conversation.local_history, conversation.last_query), before)

    def test_protocol_collisions_and_numeric_record_ids_do_not_block_overview(self):
        for tools in (analysis.numeric_identity_tools(), analysis.protocol_collision_tools()):
            _, _, answer = self.run_overview(tools=tools)
            self.assertIn("整体总结", answer)
            self.assertNotIn("改用本地", answer)


class OverviewSDKTests(support.NoExternalIO):
    def test_deepseek_and_sol_support_the_module_and_summary_json_protocol(self):
        for provider in (providers.DeepSeekTests, providers.OpenAIProviderTests):
            with self.subTest(provider=provider.__name__):
                fake, requests = OverviewClient(), []
                def handler(request):
                    requests.append(request)
                    payload = json.loads(request.content)
                    options = dict(payload)
                    if "input" in payload:
                        options["messages"] = payload["input"]
                    return provider.response(self, fake.create(**options))
                client = provider.client(self, handler)
                conversation = Conversation(overview_tools(), strategy="analysis")
                answer = conversation.answer("分析下我的报告", client, "synthetic-model")
                self.assertIn("整体总结", answer)
                self.assertNotIn("改用本地", answer)
                self.assertEqual(len(requests), 2)
                for request in requests:
                    self.assertEqual(request.extensions["timeout"]["read"], 90.0)
                    payload = json.loads(request.content)
                    self.assertEqual(payload.get("max_tokens", payload.get("max_output_tokens")), 8192)
                    self.assertNotIn("tools", payload)
                    self.assertNotIn("reasoning_content", json.dumps(payload))
                    self.assertNotIn("SYNTHETIC_PRIVATE_REASONING", json.dumps(payload))
