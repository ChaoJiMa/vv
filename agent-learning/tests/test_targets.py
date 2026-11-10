"""用虚构元数据验证诉求账本，重点反例为漏项、错口径、伪缺失和过度路由。"""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from report_assistant.reports.projection import FactProjection
from report_assistant.security.question_guard import QuestionGuard
from report_assistant.conversation.targets import QuestionTargets
from report_assistant.reports.tools import LocalReportTools
from scripts.customer_eval_cases import synthetic_tools
from support import privacy as support


class QuestionTargetTests(support.NoExternalIO):
    """不读取.env、业务报告或网络；测试只在内存构造实际投影与已读事实。"""

    def context(self, display=False):
        tools = synthetic_tools(display_rules=display, with_report_date=True)
        return tools, FactProjection(tools, QuestionGuard(tools))

    def targets(self, question, display=False, previous=None):
        tools, projection = self.context(display)
        return QuestionTargets(question, tools, projection, previous), projection

    def paths(self, targets, projection):
        return [projection.fields[ref]['local']['path'].split('.')[-1] for ref in targets.report_refs]

    def test_three_explicit_report_requests_are_all_preserved(self):
        targets, projection = self.targets('请帮我看一下近半年非银行申请次数；另外也查一下报告分数和等级，还有近一个月银行申请次数，别猜没有的数据。')
        self.assertEqual(self.paths(targets, projection), ['nonbank_M6_count', 'BRS_RS_00001', 'bank_M1_count'])
        self.assertFalse(targets.service_only)

    def test_application_branch_preserves_other_types_in_same_sentence(self):
        for query, expected in [('近1个月非银行申请次数和学历分别是什么？', ['nonbank_M1_count', 'education']),
                                 ('近1个月非银行申请次数和未结清余额分别是多少？', ['nonbank_M1_count', 'loan_balance']),
                                 ('近1个月非银行申请次数、学历和未结清余额分别是什么？', ['nonbank_M1_count', 'loan_balance', 'education'])]:
            with self.subTest(query=query):
                targets, projection = self.targets(query)
                self.assertEqual(self.paths(targets, projection), expected)
                self.assertFalse(targets.ambiguous)
                facts = {f['field_ref']: f for f in projection.read(targets.report_refs)}
                incomplete = [{'text': '近1个月非银行申请次数为8次。', 'sources': [targets.report_refs[0]]}]
                self.assertFalse(targets.validate_answer(incomplete, facts))
                self.assertTrue(targets.validate_answer(targets.factual_sections(facts), facts))

    def test_service_why_question_does_not_make_known_report_targets_ambiguous(self):
        for service in ['分数不低为什么还是贷不下来', '高分为什么申请仍被拒']:
            with self.subTest(service=service):
                targets, projection = self.targets('近1个月非银行申请次数，' + service)
                self.assertEqual(self.paths(targets, projection), ['nonbank_M1_count'])
                self.assertEqual(targets.service_topics, ['score_vs_loan'])
                self.assertFalse(targets.ambiguous)
                self.assertFalse(targets.service_only)

    def test_report_explanation_is_unproven_not_a_proven_content_error(self):
        targets, projection = self.targets('比较近7天和近一个月非银行申请次数，解释含义')
        self.assertTrue(targets.ambiguous)
        facts = {f['field_ref']: f for f in projection.read(targets.report_refs)}
        sections = [{'text': '近7天0次，近1个月8次；两个周期可能重叠，不能直接相加。', 'sources': targets.report_refs}]
        self.assertFalse(targets.validate_answer(sections, facts))

    def test_case_amount_never_substitutes_for_unsettled_range(self):
        targets, projection = self.targets('案件编号；另外未结清金额的页面区间。', True)
        self.assertEqual(self.paths(targets, projection), ['ah', 'BRS_LS_XYP_T01ACZZZZ'])
        self.assertNotIn('amount', self.paths(targets, projection))

    def test_explicit_display_results_have_independent_targets(self):
        targets, projection = self.targets('收入预测范围，还有手机在网多久，以及婚姻登记结果。', True)
        self.assertEqual(self.paths(targets, projection), ['BRS_SUMMARY_CDDATAINCOMEINFO', 'min', 'state'])

    def test_count_institution_band_and_night_are_not_interchangeable(self):
        for text, expected in [('近1个月非银申请次数和机构数', ['nonbank_M1_count', 'nonbank_M1_orgs']),
                               ('近一个月非银行夜间申请次数', ['nonbank_night']),
                               ('非银行近一周的申请档位', ['sample_D7_gear'])]:
            with self.subTest(text=text):
                targets, projection = self.targets(text)
                self.assertEqual(self.paths(targets, projection), expected)
        targets, projection = self.targets('非银行其他近一周显示第几档', True)
        self.assertEqual(self.paths(targets, projection), ['NONE_BANK_APPLY_D7_APPLY_QT_COUNT'])

    def test_multiple_entities_and_metrics_do_not_create_cartesian_requests(self):
        targets, _ = self.targets('近一个月银行和非银行申请次数和机构数分别是多少')
        self.assertTrue(targets.ambiguous)
        self.assertEqual(targets.report_refs, [])

    def test_shared_explicit_metric_or_scope_is_not_ambiguous(self):
        for text, expected in [('近一个月银行和非银行的申请次数分别是多少？', ['nonbank_M1_count', 'bank_M1_count']),
                               ('近一个月非银行申请次数和机构数分别是多少？', ['nonbank_M1_count', 'nonbank_M1_orgs']),
                               ('我比较着急，想知道近一个月非银行申请次数', ['nonbank_M1_count'])]:
            with self.subTest(text=text):
                targets, projection = self.targets(text)
                self.assertEqual(self.paths(targets, projection), expected)
                self.assertFalse(targets.ambiguous)

    def test_all_three_service_requests_remain_in_order(self):
        targets, _ = self.targets('小贝，退款申请要找谁核实；另外数据提供方和更新周期能确认吗；报告能不能保证下款，请分别回应。')
        self.assertEqual(targets.service_topics, ['refund', 'data_source', 'loan'])
        self.assertTrue(targets.service_only)
        self.assertFalse(targets.has_report_targets)

    def test_report_list_and_policies_are_pure_service(self):
        targets, _ = self.targets('名下全部报告一共有几份，贷款申请多久一次才合适')
        self.assertEqual(targets.service_topics, ['report_list', 'application_frequency'])
        self.assertTrue(targets.service_only)
        self.assertEqual(targets.report_refs, [])

    def test_unknown_subquestion_prevents_service_only_override(self):
        targets, _ = self.targets('退款申请要找谁核实，另外解释陌生报告指标')
        self.assertEqual(targets.service_topics, ['refund'])
        self.assertFalse(targets.service_only)
        targets, projection = self.targets('退款申请要找谁核实，另外报告分数是多少')
        self.assertFalse(targets.service_only)
        self.assertEqual(self.paths(targets, projection), ['BRS_RS_00001'])
        targets, _ = self.targets('近一个月非银申请次数，以及我购买的保险保额呢')
        self.assertTrue(targets.ambiguous)
        targets, _ = self.targets('近一个月非银申请次数和我购买的保险保额呢')
        self.assertTrue(targets.ambiguous)

    def test_four_service_topics_are_not_silently_truncated(self):
        targets, _ = self.targets('退款申请要找谁核实；数据提供方和更新周期能确认吗；报告能不能保证下款；名下全部报告一共有几份')
        self.assertFalse(targets.ambiguous)
        self.assertTrue(targets.service_only)
        self.assertEqual(targets.service_topics, ['refund', 'data_source', 'loan', 'report_list'])
        targets, _ = self.targets('退款申请要找谁核实；数据提供方和更新周期能确认吗；报告能不能保证下款；名下全部报告一共有几份；解释陌生统计项')
        self.assertFalse(targets.service_only)
        self.assertTrue(targets.ambiguous)
        self.assertEqual(targets.service_topics, ['refund', 'data_source', 'loan', 'report_list'])

    def test_open_judgments_cannot_be_replaced_by_value_only_fallback(self):
        for suffix in ['算频繁吗', '是否频繁', '算不算正常', '正常吗', '正不正常', '好不好', '有什么影响', '代表什么', '应该怎么理解']:
            with self.subTest(suffix=suffix):
                targets, projection = self.targets('近1个月非银行申请次数' + suffix)
                self.assertEqual(self.paths(targets, projection), ['nonbank_M1_count'])
                self.assertTrue(targets.ambiguous)

    def test_plain_values_and_display_grades_are_not_open_judgments(self):
        for query in ['近1个月非银行申请次数是多少', '报告分数和等级是什么', '报告评分及所属等级', '近7天非银行申请档位是什么', '学历显示什么结果']:
            with self.subTest(query=query):
                targets, _ = self.targets(query)
                self.assertTrue(targets.has_report_targets)
                self.assertFalse(targets.ambiguous)

    def test_explicit_meaning_and_plain_explanation_keep_open_intent(self):
        for display, query, expected in [(True, '手机在网时长是什么意思？', ['min']),
                                         (False, '近1月非银行申请次数有什么含义？', ['nonbank_M1_count']),
                                         (False, '近1月非银行申请次数是什么意思？', ['nonbank_M1_count']),
                                         (False, '学历那一栏能通俗解释一下吗？', ['education']),
                                         (False, '学历请通俗说一下', ['education'])]:
            with self.subTest(query=query):
                targets, projection = self.targets(query, display)
                self.assertEqual(self.paths(targets, projection), expected)
                self.assertTrue(targets.ambiguous)

    def test_closed_result_query_proves_all_three_value_phrases(self):
        query = '刚打开报告，请看手机在网时长；另外报告显示的收入预测；也请说明最近一次记录时间范围，请用好理解的话说。'
        targets, projection = self.targets(query, True)
        self.assertEqual(self.paths(targets, projection), ['min', 'BRS_SUMMARY_CDDATAINCOMEINFO', 'record_time'])
        self.assertTrue(targets.is_closed_result_query())

    def test_closed_result_query_supports_explicit_multiple_metric_types(self):
        for display, query in [(True, '手机在网时长和收入预测范围分别是什么？'),
                               (False, '近1个月非银行申请次数和学历分别是什么？'),
                               (False, '近一个月非银申请次数和机构数分别是多少？'),
                               (True, '手机在网时间是多少，手机运营商是哪家？')]:
            with self.subTest(query=query):
                targets, _ = self.targets(query, display)
                self.assertTrue(targets.is_closed_result_query())

    def test_not_ambiguous_is_not_itself_a_closed_query_proof(self):
        for query in ['手机在网时长会帮助申请吗？', '手机在网时长是有效信息吗？',
                      '帮忙解释一下手机在网时长，请用好理解的话说。']:
            with self.subTest(query=query):
                targets, _ = self.targets(query, True)
                self.assertTrue(targets.has_report_targets)
                self.assertFalse(targets.ambiguous)
                self.assertFalse(targets.is_closed_result_query())

    def test_closed_query_rejects_open_unknown_and_user_supplied_results(self):
        for query in ['手机在网时长能证明工作稳定吗？', '手机在网时长是什么意思？',
                      '手机在网时长，以及我购买的保险保额呢？', '手机在网时长等于24个月吗？',
                      '手机在网时长不正常吗？', '手机在网时长和未知指标是什么？']:
            with self.subTest(query=query):
                targets, _ = self.targets(query, True)
                self.assertFalse(targets.is_closed_result_query())

    def test_closed_query_period_must_belong_to_the_same_clause_target(self):
        targets, _ = self.targets('手机在网时长近1个月，近1个月非银行其他申请次数', True)
        self.assertTrue(targets.has_report_targets)
        self.assertFalse(targets.is_closed_result_query())
        targets, _ = self.targets('近7天非银行申请次数，近一个月非银行申请机构数')
        self.assertTrue(targets.is_closed_result_query())

    def test_closed_query_proof_does_not_read_data_and_preserves_service_goals(self):
        tools, projection = self.context(True)
        targets = QuestionTargets('手机在网时长是多少；退款申请要找谁核实', tools, projection)
        with patch.object(tools, 'get_current_order_data', side_effect=AssertionError('不能读取值')):
            with patch.object(projection, 'read', side_effect=AssertionError('不能读取值')):
                self.assertTrue(targets.is_closed_result_query())
        self.assertEqual(targets.service_topics, ['refund'])
        self.assertFalse(targets.service_only)

    def test_service_topic_collection_is_bounded_by_closed_vocabulary(self):
        query = '怎么联系人工客服；报告数据有异议该怎么申诉；退款申请要找谁核实；数据提供方和更新周期能确认吗；报告能不能保证下款；评分高但贷款没通过是什么原因；申请间隔有没有统一标准；名下全部报告一共有几份；退款申请要找谁核实'
        targets, _ = self.targets(query)
        self.assertTrue(targets.service_only)
        self.assertEqual(len(targets.service_topics), 8)
        self.assertEqual(len(set(targets.service_topics)), 8)

    def test_negated_and_changed_requests_do_not_return_rejected_topics(self):
        targets, projection = self.targets('不要退款，也不用转人工；不要查逾期，改查学历。')
        self.assertEqual(targets.service_topics, [])
        self.assertEqual(self.paths(targets, projection), ['education'])

    def test_generic_money_or_arbitrary_digits_never_choose_a_field(self):
        for text in ['金额1500元是怎么回事', '12345', '看看这个新指标', '申请情况', '银行申请']:
            with self.subTest(text=text):
                targets, _ = self.targets(text)
                self.assertEqual(targets.report_refs, [])
                self.assertFalse(targets.service_only)

    def test_calendar_and_future_periods_do_not_become_rolling_windows(self):
        for text in ['上个月非银行申请次数', '未来半年非银行申请次数', '今年银行申请次数']:
            with self.subTest(text=text):
                targets, _ = self.targets(text)
                self.assertEqual(targets.report_refs, [])
                self.assertTrue(targets.ambiguous)

    def test_followups_use_unique_previous_metadata_and_new_period(self):
        tools, projection = self.context()
        first = QuestionTargets('近7天非银申请次数', tools, projection)
        previous = SimpleNamespace(field_refs=tuple(first.report_refs))
        for text in ['那近一个月呢', '改成最近30天呢', '再看近1个月的同一项呢']:
            with self.subTest(text=text):
                target = QuestionTargets(text, tools, projection, previous)
                self.assertEqual(self.paths(target, projection), ['nonbank_M1_count'])
        previous = SimpleNamespace(field_refs=('f3',))
        for text, expected in [('那涉及几家机构', 'nonbank_M1_orgs'), ('同一周期机构数呢', 'nonbank_M1_orgs'),
                               ('那银行这边呢', 'bank_M1_count'), ('银行同周期次数也说一下', 'bank_M1_count')]:
            with self.subTest(text=text):
                target = QuestionTargets(text, tools, projection, previous)
                self.assertEqual(self.paths(target, projection), [expected])

    def test_multi_field_context_does_not_guess_followup_target(self):
        targets, _ = self.targets('那近一个月呢', previous=SimpleNamespace(field_refs=('f2', 'f4')))
        self.assertEqual(targets.report_refs, [])

    def test_duplicate_metadata_needs_disambiguation(self):
        tools, _ = self.context()
        order, catalog = deepcopy(tools._order), deepcopy(tools._catalog)
        duplicate = dict(catalog['fields'][-2], module_id=23, module_name='其他学历')
        catalog['fields'].append(duplicate)
        order['report_data']['template']['modules'].append({'moduleId': 23, 'moduleName': '其他学历'})
        tools = LocalReportTools(order, catalog)
        projection = FactProjection(tools, QuestionGuard(tools))
        targets = QuestionTargets('我的学历是什么', tools, projection)
        self.assertEqual(targets.report_refs, [])
        self.assertTrue(targets.ambiguous)

    def test_constructor_and_ledger_checks_never_read_facts(self):
        tools, projection = self.context()
        with patch.object(tools, 'get_current_order_data', side_effect=AssertionError('不能读取值')):
            with patch.object(projection, 'read', side_effect=AssertionError('不能读取值')):
                targets = QuestionTargets('近一个月非银申请次数及机构数', tools, projection)
                self.assertEqual(targets.missing_refs({}), targets.report_refs)
                self.assertEqual(targets.factual_sections({}), [])
                self.assertFalse(targets.validate_answer([], {}))

    def test_sources_cannot_hide_an_omitted_or_wrong_result(self):
        targets, projection = self.targets('近一个月非银行申请次数和机构数')
        facts = {f['field_ref']: f for f in projection.read(targets.report_refs)}
        count, orgs = targets.report_refs
        self.assertFalse(targets.validate_answer([{'text': '申请次数为8次。', 'sources': [count]}], facts))
        self.assertFalse(targets.validate_answer([{'text': '申请次数为8次。', 'sources': [count, orgs]}], facts))
        self.assertFalse(targets.validate_answer([{'text': '申请次数为8次，机构数暂无可确认结果。', 'sources': [count, orgs]}], facts))
        self.assertTrue(targets.validate_answer([{'text': '申请次数为八次。', 'sources': [count]},
                                                 {'text': '涉及三家机构。', 'sources': [orgs]}], facts))

    def test_swapped_scope_numbers_cannot_pass_union_of_sources(self):
        targets, projection = self.targets('近一个月非银行申请次数，近一个月银行申请次数')
        facts = {f['field_ref']: f for f in projection.read(targets.report_refs)}
        self.assertFalse(targets.validate_answer([{'text': '银行8次，非银行2次。', 'sources': targets.report_refs}], facts))
        first, second = targets.report_refs
        self.assertFalse(targets.validate_answer([{'text': '银行8次。', 'sources': [second]},
                                                  {'text': '非银行2次。', 'sources': [first]}], facts))

    def test_provided_number_does_not_authorize_denied_result(self):
        targets, projection = self.targets('近一个月非银行申请次数')
        facts = {f['field_ref']: f for f in projection.read(targets.report_refs)}
        for text in ['8次没查到。', '8次无法确认。', '申请次数未提供，但可能8次。']:
            with self.subTest(text=text):
                self.assertFalse(targets.validate_answer([{'text': text, 'sources': targets.report_refs}], facts))
        targets, projection = self.targets('手机在网时间范围', True)
        facts = {f['field_ref']: f for f in projection.read(targets.report_refs)}
        self.assertTrue(targets.validate_answer([{'text': '手机在网时长24个月以上，无法确认精确值。', 'sources': targets.report_refs}], facts))

    def test_verified_fallback_includes_missing_target_without_fabricating_zero(self):
        targets, projection = self.targets('近半年非银行申请次数，报告分数和等级')
        facts = {f['field_ref']: f for f in projection.read(targets.report_refs)}
        parts = targets.factual_sections(facts)
        self.assertEqual(len(parts), 2)
        self.assertIn('未提供', parts[0]['text'])
        self.assertNotIn('0次', parts[0]['text'])
        self.assertTrue(targets.validate_answer(parts, facts))
        self.assertEqual(targets.factual_sections({targets.report_refs[0]: facts[targets.report_refs[0]]})[0]['sources'], [targets.report_refs[0]])

    def test_actual_income_cannot_be_replaced_with_unavailable_claim(self):
        targets, projection = self.targets('收入预测范围和婚姻登记结果', True)
        facts = {f['field_ref']: f for f in projection.read(targets.report_refs)}
        text = [{'text': '收入预测暂时无法确认，婚姻登记为已婚。', 'sources': targets.report_refs}]
        self.assertFalse(targets.validate_answer(text, facts))
        self.assertTrue(targets.validate_answer(targets.factual_sections(facts), facts))

    def test_local_fallback_preserves_bands_ranges_dates_and_case_numbers(self):
        for display, query in [(False, '报告查询日期和未结清余额范围'),
                               (True, '案件编号，未结清金额区间，近7天非银行其他申请档位')]:
            with self.subTest(display=display):
                targets, projection = self.targets(query, display)
                facts = {f['field_ref']: f for f in projection.read(targets.report_refs)}
                self.assertTrue(targets.validate_answer(targets.factual_sections(facts), facts))
