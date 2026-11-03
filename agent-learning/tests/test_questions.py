"""使用虚构字段覆盖口语匹配、周期切换和本地上下文，不读取配置或实际报告。"""

from unittest.mock import patch

import test_privacy as support
from report_session import Conversation
from report_tools import LocalReportTools, field_matches_window, time_windows


def natural_tools():
    """模拟通用目录的模块、总次数、机构数和分项结构，数值全部为虚构标记。"""
    order, catalog = support.fixtures()
    catalog["theme_name"] = "虚构测试版"
    catalog["fields"][0].update(name="报告分析指数", module_name="风险指数")
    for item in catalog["fields"][1:4]:
        item["name"] = "申请次数(柱状图，按窗口)"
    rows = [
        (9, "非银行申请", "申请机构数", "synthetic_org_D7_COUNT", "近7天", "SYNTHETIC_ORG"),
        (9, "非银行申请", "夜间申请次数", "synthetic_night_D7_COUNT", "近7天", "SYNTHETIC_NIGHT"),
        (10, "银行申请", "申请次数(柱状图，按窗口)", "synthetic_bank_D7_COUNT", "近7天", "SYNTHETIC_BANK"),
        (65, "小伙云-银行申请", "全部机构申请次数档位", "synthetic_bank_d15_apply_count", "", "SYNTHETIC_BANK_GEAR"),
        (66, "小伙云-非银申请", "全部机构申请次数档位", "synthetic_nonbank_d15_apply_count", "", "SYNTHETIC_NONBANK_GEAR"),
        (67, "逾期情况", "银行逾期次数档位", "synthetic_bank_overdue_month12_count", "", "SYNTHETIC_OVERDUE"),
        (67, "逾期情况", "银行逾期平台数档位", "synthetic_bank_overdue_month12_org", "", None),
        (16, "失信案件", "失信案件记录", "synthetic_dishonest", "", []),
        (15, "限高案件", "限高案件记录", "synthetic_restricted", "", []),
        (19, "贷款分周期汇总", "近7天 贷款机构数", "synthetic_loan7", "", "SYNTHETIC_LOAN7"),
        (19, "贷款分周期汇总", "近14天 贷款机构数", "synthetic_loan14", "", "SYNTHETIC_LOAN14"),
    ]
    modules = order["report_data"]["template"]["modules"]
    for mid, module, name, key, window, value in rows:
        catalog["fields"].append({"module_id": mid, "module_name": module, "name": name,
                                  "path": "report." + key, "window": window,
                                  "frontend_processing": "虚构规则：只按本字段登记口径展示。"})
        order["report_data"]["report"][key] = value
        if mid not in {m["moduleId"] for m in modules}:
            modules.append({"moduleId": mid, "moduleName": module})
    return LocalReportTools(order, catalog)


class NaturalQuestionTests(support.NoExternalIO):
    """口语查询只进入本地匹配，原有严格模型出口继续独立校验整句。"""

    def test_score_alias_and_definition_followup_stay_local(self):
        client = support.FakeClient()
        conversation = Conversation(natural_tools())
        for question in ("帮我看看这份报告的分数是多少呀？", "风险指数帮我查一下", "这份报告有多少分"):
            self.assertIn(support.PRIVATE_VALUE, conversation.answer(question, client, "synthetic-model"))
        result = conversation.answer("解释一下", client, "synthetic-model")
        self.assertIn(support.PRIVATE_META, result)
        self.assertNotIn(support.PRIVATE_VALUE, result)
        self.assertEqual(client.requests, [])

    def test_natural_windows_and_nonbank_alias_choose_total_only(self):
        client = support.FakeClient()
        for question in ("最近一周非银申请了几次呀？", "非银行最近7天申请有多少次啊", "过去七天的非银行申请次数帮我看一下"):
            with self.subTest(question=question):
                conversation = Conversation(natural_tools())
                answer = conversation.answer(question, client, "synthetic-model")
                self.assertIn("当前原始值：0", answer)
                self.assertEqual(len(conversation.last_fields), 1)
                self.assertNotIn("SYNTHETIC_ORG", answer)
                self.assertNotIn("SYNTHETIC_NIGHT", answer)
                self.assertNotIn("SYNTHETIC_BANK", answer)
        self.assertEqual(client.requests, [])

    def test_institution_and_night_queries_keep_their_own_metric(self):
        for question, expected in (("非银行近7天申请了几家机构", "SYNTHETIC_ORG"),
                                   ("非银行近7天夜间申请了几次", "SYNTHETIC_NIGHT")):
            with self.subTest(question=question):
                self.assertIn(expected, Conversation(natural_tools()).answer(question))

    def test_bank_and_nonbank_gear_lowercase_paths_are_separate(self):
        for question, expected, excluded in (
            ("银行近15天申请了几次", "SYNTHETIC_BANK_GEAR", "SYNTHETIC_NONBANK_GEAR"),
            ("非银近15天申请了几次", "SYNTHETIC_NONBANK_GEAR", "SYNTHETIC_BANK_GEAR"),
            ("近15天非银行申请次数是多少", "SYNTHETIC_NONBANK_GEAR", "SYNTHETIC_BANK_GEAR"),
        ):
            with self.subTest(question=question):
                answer = Conversation(natural_tools()).answer(question)
                self.assertIn(expected, answer)
                self.assertNotIn(excluded, answer)

    def test_missing_window_does_not_reuse_old_value(self):
        conversation = Conversation(natural_tools())
        conversation.answer("最近7天非银申请了几次")
        self.assertIn("null（空值）", conversation.answer("那最近一个月呢"))
        self.assertIn("当前值未提供", conversation.answer("那近一年呢"))
        result = conversation.answer("那近24天呢")
        self.assertIn("未找到", result)
        self.assertNotIn("当前原始值", result)

    def test_ambiguous_overdue_question_requires_selection_before_reading(self):
        conversation = Conversation(natural_tools())
        with patch.object(conversation.tools, "get_current_order_data", side_effect=AssertionError("No read before pick")):
            result = conversation.answer("我有没有逾期记录呀？")
        self.assertIn("/pick", result)
        self.assertEqual(len(conversation.last_fields), 2)
        result = conversation.answer("选择第1项")
        self.assertIn("SYNTHETIC_OVERDUE", result)
        self.assertIn("虚构规则", conversation.answer("这个是什么意思"))
        result = conversation.answer("那近7天呢")
        self.assertIn("未找到", result)
        self.assertNotIn("SYNTHETIC_OVERDUE", result)

    def test_picked_context_never_switches_modules(self):
        conversation = Conversation(natural_tools())
        conversation.answer("/find 非银行 近7天")
        self.assertIn("当前原始值：0", conversation.answer("/pick 1"))
        self.assertIn("null（空值）", conversation.answer("那近1个月呢"))
        self.assertEqual(conversation.last_fields[0]["module_id"], 9)
        self.assertIn("虚构", conversation.resolver.guidance())

    def test_field_name_with_embedded_period_can_switch_window(self):
        conversation = Conversation(natural_tools())
        self.assertIn("SYNTHETIC_LOAN7", conversation.answer("近7天贷款机构数帮我看一下"))
        self.assertIn("SYNTHETIC_LOAN14", conversation.answer("那近14天呢"))

    def test_unknown_question_clears_local_and_public_context(self):
        conversation = Conversation(natural_tools())
        conversation.answer("分析指数是多少")
        result = conversation.answer("今天天气如何")
        self.assertIn("可查模块", result)
        self.assertEqual(conversation.last_fields, [])
        self.assertIsNone(conversation.last_request)
        self.assertNotIn(support.PRIVATE_VALUE, conversation.answer("这个是什么意思"))
        self.assertIn("请先", conversation.answer("/pick 1"))

    def test_overview_and_guidance_only_list_active_metadata(self):
        conversation = Conversation(natural_tools())
        for question in ("帮我分析这份报告", "我能贷款吗", "随便聊聊"):
            answer = conversation.answer(question)
            self.assertIn("虚构测试版", answer)
            self.assertIn("逾期情况", answer)
            self.assertNotIn("隐藏字段", answer)
            self.assertNotIn(support.PRIVATE_VALUE, answer)
            self.assertNotIn("本轮问题保留在本地", answer)

    def test_colloquial_overview_does_not_report_a_missing_metric(self):
        """整体分析口语在离线及兼容策略中均给出模块引导，不误判为指标查询。"""
        for strategy in ("template", "analysis"):
            for question in ("分析下我的报告", "请帮我分析一下我的报告", "帮我看看这份报告", "解读下我的信用报告", "整体分析我的报告"):
                with self.subTest(strategy=strategy, question=question):
                    conversation = Conversation(natural_tools(), strategy=strategy)
                    answer = conversation.answer(question)
                    self.assertIn("请告诉我您想了解报告中的哪一项内容" if strategy == "analysis" else "可以逐项查看", answer)
                    self.assertNotIn("未找到该指标", answer)
                    self.assertEqual(conversation.last_fields, [])

    def test_overview_phrase_with_a_metric_still_selects_that_metric(self):
        """增加整体口语识别后，带明确字段的问题仍按字段查询。"""
        conversation = Conversation(natural_tools())
        answer = conversation.answer("解读下我的报告中的分析指数")
        self.assertIn("报告分析指数", answer)
        self.assertEqual(len(conversation.last_fields), 1)

    def test_multiple_and_calendar_windows_do_not_select_arbitrary_period(self):
        for question, expected in (("对比近7天和近1个月非银申请次数", "多个统计周期"),
                                   ("上个月非银申请次数", "自然月"),
                                   ("今年银行申请了多少次", "自然月")):
            with self.subTest(question=question):
                conversation = Conversation(natural_tools())
                self.assertIn(expected, conversation.answer(question))
                self.assertEqual(conversation.last_fields, [])

    def test_case_aliases_do_not_turn_empty_arrays_into_risk_judgments(self):
        for question, expected in (("我是不是老赖", "失信案件记录"), ("有没有限制高消费记录", "限高案件记录")):
            answer = Conversation(natural_tools()).answer(question)
            self.assertIn(expected, answer)
            self.assertIn("当前原始值：[]", answer)
            self.assertNotIn("没有风险", answer)

    def test_local_questions_and_followups_cannot_authorize_model_requests(self):
        client = support.FakeClient()
        conversation = Conversation(natural_tools())
        for question in ("分数是多少，我手机号13800000000", "它是什么意思", "/find 逾期", "/pick 1", "那近7天呢"):
            conversation.answer(question, client, "synthetic-model")
        self.assertEqual(client.requests, [])
        conversation.answer("分析指数是多少", client, "synthetic-model")
        self.assertEqual(len(client.requests), 2)
        support.OutboundTests.assert_private_absent(self, client.requests)

    def test_failed_history_save_does_not_commit_selected_fields(self):
        history = type("SyntheticHistory", (), {"read": lambda self, scope: [], "append": lambda *args: None})()
        conversation = Conversation(natural_tools(), history)
        conversation.answer("/find 逾期")
        previous = conversation.last_query
        with patch.object(history, "append", side_effect=RuntimeError("Synthetic encryption failure")):
            with self.assertRaises(RuntimeError):
                conversation.answer("/pick 1")
        self.assertIs(conversation.last_query, previous)
        self.assertEqual(len(conversation.last_fields), 2)
        self.assertEqual(len(conversation.local_history), 1)

    def test_new_report_has_no_local_followup_context(self):
        first = Conversation(natural_tools())
        first.answer("/find 逾期")
        second = Conversation(natural_tools())
        self.assertIsNone(second.last_query)
        self.assertEqual(second.last_fields, [])
        self.assertIn("请先", second.answer("这个是什么意思"))

    def test_window_codes_match_complete_tokens_and_chinese_labels(self):
        self.assertTrue(field_matches_window({"path": "report.synthetic_d15_apply_count"}, "D15"))
        self.assertFalse(field_matches_window({"path": "report.synthetic_d150_apply_count"}, "D15"))
        self.assertTrue(field_matches_window({"name": "近14天贷款机构数"}, "D14"))
        self.assertTrue(field_matches_window({"path": "report.synthetic_month12_count"}, "M12"))
        self.assertEqual(time_windows("过去一个月和近30天"), ["M1"])
        self.assertEqual(time_windows("近半年"), ["M6"])

    def test_value_and_colloquial_definition_followups_use_selected_field(self):
        conversation = Conversation(natural_tools())
        conversation.answer("风险指数帮我看一下")
        for question in ("这个数值是啥意思", "这是什么意思", "它是怎么算的"):
            self.assertIn(support.PRIVATE_META, conversation.answer(question))
            self.assertEqual(len(conversation.last_fields), 1)
        self.assertIn(support.PRIVATE_VALUE, conversation.answer("它的值是多少"))

    def test_explicit_bank_qualifier_cannot_fall_back_to_nonbank(self):
        order, catalog = support.fixtures()
        # 只有非银行有此名称，银行限定必须导致无匹配。
        catalog["fields"][1]["name"] = "申请次数"
        conversation = Conversation(LocalReportTools(order, catalog))
        result = conversation.answer("银行近7天申请次数帮我看一下")
        self.assertEqual(conversation.last_fields, [])
        self.assertNotIn("当前原始值", result)

    def test_more_than_six_candidates_explain_how_to_narrow_without_reading(self):
        order, catalog = support.fixtures()
        for index in range(9):
            catalog["fields"].append({"module_id": 9, "module_name": "逾期情况", "name": f"逾期指标{index}",
                                      "path": f"report.synthetic_overdue_{index}", "window": ""})
        conversation = Conversation(LocalReportTools(order, catalog))
        with patch.object(conversation.tools, "get_current_order_data", side_effect=AssertionError("No unselected reads")):
            result = conversation.answer("有没有逾期呀")
        self.assertIn("共有 9 个候选", result)
        self.assertEqual(len(conversation.last_fields), 6)

    def test_candidate_labels_distinguish_path_windows_and_duplicate_sources(self):
        tools = natural_tools()
        fields = tools.topic_fields("bank_applications", "unspecified")
        self.assertIn("近15天", tools.render(fields))
        duplicate = dict(fields[0], module_id=65)
        result = tools.render([fields[0], duplicate])
        self.assertIn("模块10", result)
        self.assertIn("模块65", result)
