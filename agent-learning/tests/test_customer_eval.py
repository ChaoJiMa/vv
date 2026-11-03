"""验证评测门槛的有效性：隐藏回退不能计成功，题目来源和隐私日志必须可靠。"""

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import test_analysis as analysis

from report_analysis import AnalysisContext
from report_privacy import PrivacyError
from report_projection import assertion_text, check_answer_numbers
from report_session import Conversation
from report_service import HOTLINE, service_replies
from scripts.customer_eval_cases import Step, cases, synthetic_tools
from scripts.evaluate_customer import judge, safe_answer, write_json


class CustomerEvaluationTests(unittest.TestCase):
    """完全离线使用虚构数据，验证评测器不会因正确兜底或无效引用误报达标。"""

    def test_hidden_score_fallback_is_a_failure_even_with_correct_text(self):
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        conversation.analysis_context = AnalysisContext('分数', ('f1',))
        step = Step('分数', required=(('70',),), fields=('BRS_RS_00001',))
        errors = judge(step, '您的报告分数是70分，属于一般。', conversation, 1, 'connection')
        self.assertIn('model_fallback:connection', errors)

    def test_wrong_window_sources_fail_even_when_answer_contains_expected_number(self):
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        conversation.analysis_context = AnalysisContext('近一个月', ('f2',))
        step = Step('近一个月', required=(('8',),), fields=('nonbank_M1_count',))
        errors = judge(step, '近一个月有8次。', conversation, 3, '')
        self.assertIn('missing_sources:nonbank_M1_count', errors)

    def test_fixed_service_clears_context_and_rejects_invented_contact(self):
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        step = Step('人工', topic='human', kind='service')
        answer = conversation.answer('人工')
        self.assertFalse(judge(step, answer, conversation, 0, ''))
        self.assertIn('wrong_service_topic:human', judge(step, '已为您转接', conversation, 0, ''))
        conversation.analysis_context = AnalysisContext('旧问题', ('f1',))
        self.assertIn('service_kept_context', judge(step, answer, conversation, 0, ''))

    def test_real_request_is_required_for_report_success(self):
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        conversation.analysis_context = AnalysisContext('分数', ('f1',))
        self.assertIn('no_real_model_request', judge(Step('分数'), '70分，一般。', conversation, 0, ''))

    def test_route_receives_only_question_and_previous_availability(self):
        """分类只知道是否可承接报告，不提前发送旧问题、字段引用或旧结果。"""
        for has_previous in (False, True):
            with self.subTest(has_previous=has_previous):
                conversation = Conversation(synthetic_tools(), strategy='analysis')
                if has_previous:
                    conversation.analysis_context = AnalysisContext('旧问题61.25', ('f1',))
                client = analysis.ScriptClient([analysis.route('general')])
                conversation.answer('那银行呢？', client, 'synthetic-model')
                payload = json.loads(client.requests[0]['messages'][-1]['content'])
                self.assertEqual(payload, {'question': '那银行呢?', 'has_previous_report': has_previous})

    def test_uncertain_have_or_not_is_not_a_no_overdue_claim(self):
        """有没有是询问内容；不误拒无法确认，但后续独立无逾期保证仍计失败。"""
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        step = Step('能确认是否逾期吗？', forbidden=('没有逾期',))
        for answer in ('目前无法确认您有没有逾期，报告暂未提供记录数。',
                       '不能判断有没有逾期记录，报告未提供条数。'):
            self.assertNotIn('forbidden:没有逾期', judge(step, answer, conversation, 1, ''))
        for answer in ('您没有逾期。', '无法确认您有没有逾期；但您没有逾期。'):
            self.assertIn('forbidden:没有逾期', judge(step, answer, conversation, 1, ''))

    def test_credentials_are_removed_before_logging(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'SYNTHETIC_TEST_KEY_123'}):
            answer = safe_answer('错误地回显SYNTHETIC_TEST_KEY_123')
            self.assertNotIn('SYNTHETIC_TEST_KEY_123', answer)
            self.assertIn('凭据已移除', answer)

    def test_fixture_projection_provides_page_values_not_codes(self):
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        facts = conversation.analysis.projection.read(['f1', 'f8', 'f13'])
        self.assertEqual([f['value'] for f in facts], [70, '3档', '本科'])
        self.assertNotIn('69.5', json.dumps(facts))
        uncertain = Conversation(synthetic_tools(unconfirmed_education=True), strategy='analysis')
        fact = uncertain.analysis.projection.read(['f13'])[0]
        self.assertEqual(fact['status'], 'withheld')
        self.assertNotIn('value', fact)

    def test_case_ids_are_unique_and_required_fields_exist(self):
        suite = cases()
        self.assertEqual(len(suite), len({case.id for case in suite}))
        for case in suite:
            paths = {f['path'].split('.')[-1] for f in synthetic_tools(case.score, case.unconfirmed_education, case.with_report_date, case.display_rules).current_fields()}
            for step in case.steps:
                self.assertLessEqual(set(step.fields), paths)

    def test_repetitive_page_advice_fails_quality_gate(self):
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        step = Step('分析我的报告', kind='overview')
        self.assertIn('repeated_page_check', judge(step, '请在报告页面核对。建议在报告页面查看。', conversation, 1, ''))

    def test_overview_simple_modules_keep_conclusions_within_the_module(self):
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        step = Step('分析我的报告', kind='overview')
        prefix = '\n\n'.join('**' + m['name'] + '**\n结果已列出。'
                             for m in conversation.tools.current_modules() if m['name'] != '学历信息')
        for text in ('您的学历是本科。整体来看，需要结合其他模块判断信用状况。',
                     '学历暂未提供，不能据此判断贷款审批结果。'):
            answer = prefix + '\n\n**学历信息**\n' + text + '\n\n**整体总结**\n请分别理解各项结果。'
            self.assertIn('unrelated_module_conclusion:学历信息', judge(step, answer, conversation, 1, ''))
        answer = prefix + '\n\n**学历信息**\n您的学历是本科。\n\n**整体总结**\n当前信息不足以判断整体信用状况。'
        self.assertFalse(judge(step, answer, conversation, 1, ''))

    def test_display_fixture_uses_real_transformations_and_keeps_unknown_unavailable(self):
        conversation = Conversation(synthetic_tools(display_rules=True), strategy='analysis')
        projection = conversation.analysis.projection
        facts = {}
        for ref, item in projection.fields.items():
            facts[item['local']['name']] = projection.read([ref])[0]
        self.assertEqual(facts['非银行其他申请次数']['value'], 5)
        self.assertEqual(facts['婚姻登记结果']['value'], '已婚')
        self.assertEqual(facts['手机在网时长']['value'], '24个月以上')
        self.assertEqual(facts['借贷账户图示']['status'], 'withheld')
        self.assertEqual(facts['学历']['status'], 'missing')
        self.assertNotIn('查询结果码', facts)

    def test_date_cases_provide_a_real_fictional_date_for_model_rewriting(self):
        conversation = Conversation(synthetic_tools(with_report_date=True), strategy='analysis')
        projection = conversation.analysis.projection
        refs = [ref for ref, item in projection.fields.items() if item['local']['path'] == 'report.report_query_date']
        self.assertEqual(len(refs), 1)
        fact = projection.read(refs)[0]
        self.assertEqual((fact['status'], fact['value']), ('provided', '2024-05-07'))
        date_cases = [case for case in cases() if case.with_report_date]
        self.assertEqual({case.id for case in date_cases}, {'report-date', 'overview-date'})

    def test_progress_write_replaces_previous_complete_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            write_json(path, {'finished': 1})
            write_json(path, {'finished': 2})
            self.assertEqual(json.loads(path.read_text(encoding='utf-8')), {'finished': 2})
            self.assertFalse(path.with_suffix('.tmp').exists())

    def test_absence_explanation_allows_only_explicitly_negated_zero(self):
        facts = [{'status': 'missing', 'window': '近3月', 'name': '申请次数'}]
        for text in ('近3个月申请次数未提供，不能按0次理解。', '空白不代表0次。', '缺失不等于0。', '不能据此认定为0次。', '也不代表次数为0。'):
            check_answer_numbers(text, facts)
        for text in ('近3个月申请次数是0。', '不等于0，但申请次数为0。', '不能按0.5次理解。', '不能按1000次理解。', '申请次数为3，未结清金额0元。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)
        with self.assertRaises(PrivacyError):
            check_answer_numbers('不能按0次理解。', [{'status': 'provided', 'value': 8}])
        for text in ('也不代表是0次。', '不能据此判断次数是0。', '不能说是0次。', '不能将空白当作0次。', '不能把它当作0条。'):
            check_answer_numbers(text, facts)

    def test_night_query_does_not_fallback_to_all_applications(self):
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        answer = conversation.answer('近一个月夜间非银行申请次数能查到吗？')
        self.assertIn('没有可确认', answer)
        self.assertNotIn('8', answer)
        self.assertEqual([f['path'] for f in conversation.last_fields], ['report.nonbank_night'])

    def test_render_missing_fact_accepts_correct_explanation_without_fallback(self):
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        fact = conversation.analysis.projection.read(['f5'])[0]
        answer = conversation.analysis._render(json.dumps({'sections': [
            {'text': '近3个月非银行申请次数未提供，不能按0次理解。', 'sources': ['f5']}]}), {'f5': fact})
        self.assertIn('未提供', answer)
        self.assertNotIn('改用本地', answer)

    def test_negated_risk_guarantee_is_distinct_from_positive_claim(self):
        strategy = Conversation(synthetic_tools(), strategy='analysis').analysis
        for text in ('空白不等于无风险。', '暂未提供，不代表无逾期记录。'):
            strategy._check_text(text)
        for text in ('这份报告无风险。', '空白不等于无风险；但这份报告没有任何风险。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                strategy._check_text(text)
        self.assertNotIn('没有逾期', assertion_text('空缺不等于没有逾期。'))

    def test_multiple_service_topics_answer_both_and_deduplicate_contacts(self):
        client = analysis.ScriptClient([analysis.response(json.dumps(
            {'route': 'service', 'use_previous': False, 'topics': ['appeal', 'refund']}))])
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        answer = conversation.answer('一处数据有异议，也想退款', client, 'synthetic-model')
        self.assertIn('异议', answer)
        self.assertIn('退款', answer)
        self.assertEqual(answer.count(HOTLINE), 1)
        self.assertIsNone(conversation.analysis_context)
        self.assertEqual(len(client.requests), 1)

    def test_mixed_query_reads_report_then_appends_local_service_without_exposing_contacts(self):
        client = analysis.ScriptClient([
            analysis.response(json.dumps({'route': 'report', 'use_previous': False, 'scope': 'focused', 'service_topics': ['refund']})),
            analysis.call('list_report_fields', {'module_ref': 'all', 'offset': 0}),
            analysis.call('read_report_facts', {'field_refs': ['f3']}, 'read'),
            analysis.final('近1月非银行申请为8次。', ('f3',)),
        ])
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        answer = conversation.answer('近一个月非银申请次数，另外想退款', client, 'synthetic-model')
        self.assertIn('8次', answer)
        self.assertIn('退款', answer)
        self.assertIn(HOTLINE, answer)
        self.assertEqual(conversation.analysis_context.field_refs, ('f3',))
        self.assertNotIn(HOTLINE, json.dumps(client.requests, ensure_ascii=False))

    def test_source_with_contact_or_appeal_mentions_hotline_once(self):
        for topics in (['data_source', 'human'], ['human', 'data_source'],
                       ['data_source', 'appeal'], ['refund', 'data_source', 'appeal']):
            with self.subTest(topics=topics):
                answer = service_replies(topics)
                self.assertEqual(answer.count(HOTLINE), 1)
                self.assertIn('提供方', answer)
                self.assertIn('无法核实', answer)

    def test_repeated_contact_fails_quality_gate(self):
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        step = Step('来源和人工联系方式', kind='service_multiple')
        self.assertIn('repeated_contact', judge(step, HOTLINE + '\n' + HOTLINE, conversation, 1, ''))

    def test_invalid_multiple_topics_cannot_smuggle_free_text(self):
        for topics in ([], ['refund', 'refund'], ['anything'], ['refund'] * 4, 'refund', [False]):
            with self.subTest(topics=topics):
                client = analysis.ScriptClient([analysis.response(json.dumps(
                    {'route': 'service', 'use_previous': False, 'topics': topics}))])
                answer = Conversation(synthetic_tools(), strategy='analysis').answer('帮我处理一下', client, 'synthetic-model')
                self.assertIn('问题路由格式未通过校验', answer)
                with self.assertRaises(ValueError):
                    service_replies(topics)

    def test_followup_model_failure_uses_previous_verified_metric_not_all_applications(self):
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        client = analysis.report_client(('f5',), '近3个月非银行申请次数未提供。')
        conversation.answer('近3个月非银申请次数？', client, 'synthetic-model')
        answer = conversation.answer('那是不是就等于没有申请？', analysis.ScriptClient([RuntimeError('synthetic')]), 'synthetic-model')
        self.assertIn('没有可确认', answer)
        self.assertNotIn('显示为8', answer)
        self.assertNotIn('显示为0', answer)
        self.assertEqual([f['path'] for f in conversation.last_fields], ['report.nonbank_M3_count'])

    def test_irrelevant_score_source_cannot_turn_source_question_into_a_score_answer(self):
        strategy = Conversation(synthetic_tools(), strategy='analysis').analysis
        fact = strategy.projection.read(['f1'])[0]
        content = json.dumps({'sections': [{'text': '暂时无法确认信息来源。', 'sources': ['f1']}]})
        with self.assertRaises(PrivacyError):
            strategy._render(content, {'f1': fact})

    def test_ambiguous_followup_after_overview_does_not_dump_the_report_on_failure(self):
        conversation = Conversation(synthetic_tools(), strategy='analysis')
        conversation.analysis_context = AnalysisContext('整份报告', tuple(conversation.analysis.projection.fields))
        answer = conversation.answer('这个是什么意思', analysis.ScriptClient([RuntimeError('synthetic')]), 'synthetic-model')
        self.assertLess(len(answer), 200)
        self.assertEqual(conversation.last_fields, [])
        self.assertNotIn('显示为8', answer)
