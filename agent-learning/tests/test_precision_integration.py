"""精准回答集成回归：故意注入漏路由、漏来源、假缺失和危险草稿，验证最终客户输出。"""

import json

from support import analysis as analysis
from support import privacy as support
from report_assistant.conversation.analysis import AnalysisFailure, AnalysisStrategy
from report_assistant.security.privacy import PrivacyError
from report_assistant.conversation.service import service_replies
from report_assistant.conversation.session import Conversation
from scripts.customer_eval_cases import synthetic_tools


class PrecisionIntegrationTests(support.NoExternalIO):
    """全部使用虚构报告和脚本模型；不加载配置或访问业务/模型网络。"""

    def setUp(self):
        self.tools = synthetic_tools()
        self.strategy = AnalysisStrategy(self.tools)

    def ref(self, suffix, strategy=None):
        """测试按独立虚构字段定位，不依赖投影引用恰好按某序号排列。"""
        strategy = strategy or self.strategy
        return next(ref for ref, item in strategy.projection.fields.items()
                    if item['local']['path'].split('.')[-1] == suffix)

    @staticmethod
    def routed(kind='report', topics=None):
        route = {'route': kind, 'use_previous': False}
        if topics is not None:
            route['topics'] = topics
        elif kind == 'report':
            route['scope'] = 'focused'
        return analysis.response(json.dumps(route))

    def test_three_service_requests_are_complete_even_if_router_omits_one(self):
        client = analysis.ScriptClient([self.routed('service', ['refund', 'appeal'])])
        answer, context = self.strategy.answer(
            '退款申请要找谁核实；报告数据有异议该怎么申诉；人工热线和邮箱是什么？', client, 'synthetic-model')
        self.assertEqual(service_replies(['refund', 'appeal', 'human']), answer)
        self.assertIsNone(context)
        self.assertEqual(1, len(client.requests))

    def test_pure_service_misroute_does_not_read_the_report(self):
        client = analysis.ScriptClient([analysis.response(json.dumps({
            'route': 'report', 'scope': 'overview', 'use_previous': False}))])
        answer, context = self.strategy.answer(
            '贷款申请多久一次才合适；我总共买过几份报告？', client, 'synthetic-model')
        self.assertEqual(service_replies(['application_frequency', 'report_list']), answer)
        self.assertIsNone(context)
        self.assertEqual(1, len(client.requests))

    def test_missing_metric_is_read_and_answered_with_the_correct_unit(self):
        count = self.ref('nonbank_M1_count')
        client = analysis.ScriptClient([self.routed(), analysis.final('近一个月非银行申请8次。', [count])])
        answer, context = self.strategy.answer(
            '近一个月非银行申请次数和机构数分别是多少？', client, 'synthetic-model')
        self.assertIn('8次', answer)
        self.assertIn('3家', answer)
        self.assertIn(self.ref('nonbank_M1_orgs'), context.field_refs)
        self.assertEqual(2, len(client.requests))

    def test_swapping_bank_and_nonbank_values_is_not_valid_coverage(self):
        refs = [self.ref('bank_M1_count'), self.ref('nonbank_M1_count')]
        client = analysis.ScriptClient([self.routed(), analysis.final('银行申请8次，非银行申请2次。', refs)])
        answer, _ = self.strategy.answer('近一个月银行和非银行的申请次数分别是多少？', client, 'synthetic-model')
        self.assertIn('近1月银行申请次数为2次。', answer)
        self.assertIn('近1月非银行申请次数为8次。', answer)
        self.assertNotIn('银行申请8次', answer)

    def test_provided_income_is_not_published_as_unavailable(self):
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        income = self.ref('BRS_SUMMARY_CDDATAINCOMEINFO', strategy)
        client = analysis.ScriptClient([self.routed(), analysis.final('收入预测暂时无法确认。', [income])])
        answer, _ = strategy.answer('收入预测范围是多少？', client, 'synthetic-model')
        self.assertIn('10万', answer)
        self.assertIn('15万', answer)
        self.assertNotIn('无法确认', answer)

    def test_case_amount_does_not_replace_unsettled_balance(self):
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        cases = self.ref('ah', strategy)
        client = analysis.ScriptClient([self.routed(), analysis.final(
            '案件编号为CASE-A、CASE-B；未结清金额区间暂未提供。', [cases])])
        answer, context = strategy.answer('案件编号以及未结清金额区间分别是什么？', client, 'synthetic-model')
        self.assertIn('CASE-A', answer)
        self.assertIn('4.5', answer)
        self.assertIn('11.5', answer)
        self.assertNotIn('暂未提供', answer)
        self.assertIn(self.ref('BRS_LS_XYP_T01ACZZZZ', strategy), context.field_refs)

    def test_repeated_read_still_completes_the_other_requested_metric(self):
        count = self.ref('nonbank_M1_count')
        client = analysis.ScriptClient([
            self.routed(), analysis.call('read_report_facts', {'field_refs': [count]}, 'first'),
            analysis.call('read_report_facts', {'field_refs': [count]}, 'repeat'),
            analysis.final('近一个月非银行申请8次。', [count]),
        ])
        answer, _ = self.strategy.answer('近一个月非银行申请次数和机构数分别是多少？', client, 'synthetic-model')
        self.assertIn('8次', answer)
        self.assertIn('3家', answer)
        self.assertLessEqual(len(client.requests), 7)

    def test_target_repair_does_not_authorize_a_sensitive_model_answer(self):
        ref = self.ref('nonbank_M1_count')
        client = analysis.ScriptClient([self.routed(), analysis.final('手机号13800000000，申请8次。', [ref])])
        with self.assertRaises(AnalysisFailure) as failure:
            self.strategy.answer('近一个月非银行申请次数和机构数分别是多少？', client, 'synthetic-model')
        self.assertEqual('answer', failure.exception.reason)

    def test_question_privacy_is_checked_before_any_target_or_model_request(self):
        client = analysis.ScriptClient([])
        conversation = Conversation(self.tools, strategy='analysis')
        answer = conversation.answer('帮13800000000查近一个月申请次数', client, 'synthetic-model')
        self.assertIn('留在本地', answer)
        self.assertFalse(client.requests)

    def test_known_case_identifier_can_correct_an_out_of_scope_route(self):
        """案件编号属于允许解读的业务信息；程序目标不能让错误general路由提前结束。"""
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        ref = self.ref('ah', strategy)
        client = analysis.ScriptClient([self.routed('general'), analysis.final('案件编号为CASE-A和CASE-B。', [ref])])
        answer, context = strategy.answer('这份报告中的案件编号是什么？', client, 'synthetic-model')
        self.assertIn('CASE-A', answer)
        self.assertIn('CASE-B', answer)
        self.assertIn(ref, context.field_refs)

    def test_open_comparison_keeps_a_valid_multisource_explanation(self):
        """值锚点无法证明自由解释时，不把同段多来源的合法回答误判成需要整轮回退。"""
        refs = [self.ref('nonbank_D7_count'), self.ref('nonbank_M1_count')]
        text = '近7天非银行申请0次，近一个月为8次；周期不同，不能直接判断申请是否增加。'
        client = analysis.ScriptClient([self.routed(), analysis.final(text, refs)])
        answer, _ = self.strategy.answer(
            '比较近7天和近一个月非银行申请次数，并解释不同周期。', client, 'synthetic-model')
        self.assertEqual(text, answer)

    def test_open_frequency_judgment_keeps_the_supported_boundary_explanation(self):
        """不能把对推断标准的否认当成否认已提供事实，丢掉用户真正关心的解释。"""
        ref = self.ref('nonbank_M1_count')
        text = '近1个月非银行申请次数为8次；报告没有给出频繁程度的判断标准，无法确认是否频繁。'
        client = analysis.ScriptClient([self.routed(), analysis.final(text, [ref])])
        answer, _ = self.strategy.answer('近1个月非银行申请次数算频繁吗？', client, 'synthetic-model')
        self.assertEqual(text, answer)

    def test_metric_meaning_question_keeps_a_safe_definition_without_forcing_a_value(self):
        """问指标含义时，不能仅因模型未复述数值就用结果短答取代定义。"""
        ref = self.ref('nonbank_M1_count')
        text = '它表示该周期内的申请次数，不是申请机构数；次数与涉及机构数量是不同口径。'
        client = analysis.ScriptClient([self.routed(), analysis.final(text, [ref])])
        answer, _ = self.strategy.answer('近1月非银行申请次数是什么意思？', client, 'synthetic-model')
        self.assertEqual(text, answer)

    def phone_strategy(self):
        """独立页面虚构报告只通过既有投影定位时长来源，不添加新的读取通道。"""
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        return strategy, self.ref('min', strategy)

    def test_closed_phone_lookup_rebuilds_facts_instead_of_releasing_unverified_draft(self):
        for draft in ('这个手机号开通使用已满两年，按这个号码的使用年限理解。',
                      '手机在网至少三年。'):
            with self.subTest(draft=draft):
                strategy, ref = self.phone_strategy()
                client = analysis.ScriptClient([self.routed(), analysis.final(draft, [ref])])
                answer, context = strategy.answer('我的手机在网时长是多少？', client, 'synthetic-model')
                self.assertIn('24个月以上', answer)
                self.assertNotIn('三年', answer)
                self.assertNotIn('开通使用', answer)
                self.assertIn(ref, context.field_refs)
                self.assertEqual(2, len(client.requests))

    def test_phone_fact_rebuild_never_waives_real_sensitive_values_or_invalid_sources(self):
        for draft, invalid in [('手机号13800000000，手机在网24个月以上。', False),
                               ('这个手机号开通使用已满两年，身份证为测试值。', False),
                               ('这个手机号开通使用已满两年，sk-abcdefghijklmnop。', False),
                               ('手机号是测试号码。', False),
                               ('手机号是+1(202)555-0123。', False),
                               ('这个手机号开通使用已满两年。', True)]:
            with self.subTest(draft=draft, invalid=invalid):
                strategy, ref = self.phone_strategy()
                client = analysis.ScriptClient([self.routed(), analysis.final(draft, ['f999'] if invalid else [ref])])
                with self.assertRaises(AnalysisFailure) as failure:
                    strategy.answer('我的手机在网时长是多少？', client, 'synthetic-model')
                self.assertEqual('answer', failure.exception.reason)

    def test_phone_reference_permission_is_bound_to_each_sections_actual_sources(self):
        strategy, phone = self.phone_strategy()
        count = self.ref('NONE_BANK_APPLY_M1_APPLY_P2P_COUNT', strategy)
        facts = {f['field_ref']: f for f in strategy.projection.read([phone, count])}
        valid = '这个手机号在运营商处已在网使用24个月以上，无法确认精确时长。'
        answer = strategy._render(json.dumps({'sections': [{'text': valid, 'sources': [phone]}]},
                                            ensure_ascii=False), facts)
        self.assertEqual(valid, answer)
        for draft in ('手机号已在网至少5年。', '手机号在网时长至少5年。', '这个手机号在运营商处使用。'):
            with self.subTest(draft=draft), self.assertRaises(PrivacyError):
                strategy._render(json.dumps({'sections': [{'text': draft, 'sources': [count]}]},
                                            ensure_ascii=False), facts)
        with self.assertRaises(PrivacyError):
            strategy._render(json.dumps({'sections': [
                {'text': valid, 'sources': [phone]},
                {'text': '这个手机号在运营商处使用。', 'sources': [count]},
            ]}, ensure_ascii=False), facts)

    def test_model_cannot_inject_phone_source_permission_into_the_answer_schema(self):
        strategy, phone = self.phone_strategy()
        content = json.dumps({'sections': [{'text': '手机号在运营商处使用。', 'sources': [phone]}],
                              'phone_metric_context': True}, ensure_ascii=False)
        client = analysis.ScriptClient([self.routed(), analysis.response(content)])
        with self.assertRaises(AnalysisFailure):
            strategy.answer('手机在网时长是多少？', client, 'synthetic-model')

    def test_phone_fact_rebuild_checks_all_sections_before_discarding_the_draft(self):
        strategy, ref = self.phone_strategy()
        content = json.dumps({'sections': [
            {'text': '这个手机号开通使用已满两年。', 'sources': [ref]},
            {'text': '手机在网24个月以上，手机号13800000000。', 'sources': [ref]},
        ]}, ensure_ascii=False)
        client = analysis.ScriptClient([self.routed(), analysis.response(content)])
        with self.assertRaises(AnalysisFailure):
            strategy.answer('我的手机在网时长是多少？', client, 'synthetic-model')

    def test_phone_fact_rebuild_does_not_launder_invalid_json_or_section_structure(self):
        strategy, ref = self.phone_strategy()
        section = {'text': '这个手机号开通使用已满两年。', 'sources': [ref]}
        for content in (json.dumps({'sections': [section], 'extra': True}, ensure_ascii=False),
                        json.dumps({'sections': [dict(section, extra=True)]}, ensure_ascii=False),
                        '{"sections": [], "sections": ' + json.dumps([section], ensure_ascii=False) + '}'):
            with self.subTest(content=content):
                client = analysis.ScriptClient([self.routed(), analysis.response(content)])
                with self.assertRaises(AnalysisFailure):
                    strategy.answer('我的手机在网时长是多少？', client, 'synthetic-model')

    def test_phone_inference_question_keeps_the_supported_inference_boundary(self):
        strategy, ref = self.phone_strategy()
        text = '手机在网时长为24个月以上；报告没有给出工作稳定性的判断标准，无法确认工作是否稳定。'
        client = analysis.ScriptClient([self.routed(), analysis.final(text, [ref])])
        answer, _ = strategy.answer('手机在网时长能证明工作稳定吗？', client, 'synthetic-model')
        self.assertEqual(text, answer)

    def test_phone_fact_rebuild_is_not_eligible_for_unknown_or_open_queries(self):
        for question in ('手机在网时长能证明工作稳定吗？', '手机在网时长是什么意思？',
                         '手机在网时长是多少，另外工作是否稳定？', '手机在网时长以及收入预测能证明工作稳定吗？'):
            with self.subTest(question=question):
                strategy, ref = self.phone_strategy()
                client = analysis.ScriptClient([self.routed(), analysis.final(
                    '手机在网至少三年。', [ref])])
                with self.assertRaises(AnalysisFailure):
                    strategy.answer(question, client, 'synthetic-model')

    def test_closed_multiple_results_rebuild_every_target_from_verified_facts(self):
        strategy, ref = self.phone_strategy()
        client = analysis.ScriptClient([self.routed(), analysis.final(
            '手机在网至少三年，收入预测暂未提供。', [ref])])
        answer, context = strategy.answer('手机在网时长以及收入预测是多少？', client, 'synthetic-model')
        for value in ('24个月以上', '10万', '15万'):
            self.assertIn(value, answer)
        self.assertNotIn('三年', answer)
        self.assertNotIn('暂未提供', answer)
        self.assertIn(self.ref('BRS_SUMMARY_CDDATAINCOMEINFO', strategy), context.field_refs)
        self.assertEqual(2, len(client.requests))

    def test_four_confirmed_service_requests_are_not_truncated_by_router_limit(self):
        """模型仍只给3主题，本地确定的第4项需保留且联系方式统一去重。"""
        client = analysis.ScriptClient([self.routed('service', ['refund', 'data_source', 'loan'])])
        answer, context = self.strategy.answer(
            '如何咨询退款；数据提供方和更新周期能确认吗；我现在能不能贷到款；名下全部报告一共有几份？',
            client, 'synthetic-model')
        self.assertEqual(service_replies(['refund', 'data_source', 'loan', 'report_list'], local_complete=True), answer)
        self.assertIsNone(context)
        self.assertEqual(1, len(client.requests))

    def test_local_complete_combination_does_not_expand_the_model_route_protocol(self):
        client = analysis.ScriptClient([self.routed('service', ['refund', 'data_source', 'loan', 'report_list'])])
        with self.assertRaises(AnalysisFailure) as failure:
            self.strategy.answer('如何咨询退款？', client, 'synthetic-model')
        self.assertEqual('route', failure.exception.reason)
        with self.assertRaises(ValueError):
            service_replies(['refund', 'data_source', 'loan', 'report_list'])
        with self.assertRaises(ValueError):
            service_replies(['refund', 'unknown-policy'], local_complete=True)

    def test_mixed_report_and_four_local_service_requests_are_all_answered(self):
        """报告与多项本地客服共存时，报告结果和全部知识边界都得到回应。"""
        ref = self.ref('nonbank_M1_count')
        client = analysis.ScriptClient([self.routed(), analysis.final('近1个月非银行申请8次。', [ref])])
        answer, context = self.strategy.answer(
            '近1个月非银行申请次数是多少；如何咨询退款；数据提供方和更新周期能确认吗；'
            '我现在能不能贷到款；名下全部报告一共有几份？', client, 'synthetic-model')
        self.assertIn('8次', answer)
        self.assertTrue(answer.endswith(service_replies(
            ['refund', 'data_source', 'loan', 'report_list'], local_complete=True)))
        self.assertIn(ref, context.field_refs)

    def test_seven_known_report_targets_fit_the_six_section_protocol(self):
        """逐项事实先核验后排版，不能因本地重组产生7段而把已核对结果整轮拒绝。"""
        strategy = AnalysisStrategy(synthetic_tools())
        score = self.ref('BRS_RS_00001', strategy)
        client = analysis.ScriptClient([self.routed(), analysis.final('报告评分为70分。', [score])])
        answer, context = strategy.answer(
            '报告评分；近7天非银行申请次数；近1个月非银行申请次数；近1个月非银行申请机构数；'
            '近1个月银行申请次数；学历；未结清余额分别是什么？', client, 'synthetic-model')
        for expected in ('70分', '0次', '8次', '3家', '2次', '本科', '1000', '2000'):
            self.assertIn(expected, answer)
        self.assertLessEqual(len(answer.split('\n\n')), 6)
        self.assertEqual(7, len(context.field_refs))
