"""自然表达和总结事实清单回归：虚构来源，覆盖去重误删、跨指标及未展示数字。"""

import json

from report_assistant.conversation.analysis import AnalysisStrategy
from report_assistant.conversation.overview import ReportOverview
from report_assistant.conversation.service import append_service_answer, service_replies, SERVICE_REPLIES
from report_assistant.conversation.wording import natural_missing_text
from scripts.customer_eval_cases import synthetic_tools
from support import privacy as support
from support.overview import OverviewClient, overview_tools
from report_assistant.conversation.session import Conversation
from report_assistant.security.answer_validation import assertion_text
from report_assistant.security.privacy import PrivacyError
from support import analysis as analysis


class NaturalAnswerTests(support.NoExternalIO):
    """不加载配置或请求网络，验证客户最终文本及实际模型消息中的受控事实。"""

    def test_fixed_customer_knowledge_only_uses_plain_questions_and_answers(self):
        for topic, text in SERVICE_REPLIES.items():
            with self.subTest(topic=topic):
                self.assertNotRegex(text, r'/(?:find|pick|orders|history|help)\b|命令行|终端')
        self.assertIn('本人报告页面', SERVICE_REPLIES['identity'])
        self.assertIn('报告列表', SERVICE_REPLIES['report_list'])

    def test_model_command_guidance_falls_back_to_customer_answer(self):
        for instruction in ('请输入 /find 非银行。', '请执行 python main.py。',
                            '```powershell\npython main.py\n```'):
            with self.subTest(instruction=instruction):
                conversation = Conversation(synthetic_tools(), strategy='analysis')
                ref = next(r for r, f in conversation.analysis.projection.fields.items()
                           if f['local']['path'].endswith('nonbank_M1_count'))
                client = analysis.ScriptClient([
                    analysis.response(json.dumps({'route': 'report', 'scope': 'focused', 'use_previous': False})),
                    analysis.final('近1月非银行申请8次。' + instruction, [ref])])
                answer = conversation.answer('近一个月非银行申请次数是多少？', client, 'synthetic-model')
                self.assertNotIn(instruction, answer)
                self.assertNotRegex(answer, r'/find|python main.py|```')
                self.assertIn('8', answer)

    def test_past_negation_does_not_hide_a_later_positive_claim(self):
        text = assertion_text('不代表您过去从未申请过；但这份报告说明您从未申请。')
        self.assertEqual(1, text.count('从未申请'))
        for positive in ('您过去从未申请过。', '不是不代表您过去从未申请过。'):
            self.assertIn('从未申请', assertion_text(positive))

    def test_missing_record_unit_is_correct_in_final_output(self):
        strategy = AnalysisStrategy(synthetic_tools())
        ref = next(r for r, f in strategy.projection.fields.items()
                   if f['local']['path'].endswith('overdue_count'))
        facts = {f['field_ref']: f for f in strategy.projection.read([ref])}
        answer = strategy._render(json.dumps({'sections': [{'text': '近一年逾期记录数暂未提供，无法确认具体次数。',
                                                           'sources': [ref]}]}), facts)
        self.assertIn('具体条数', answer)
        self.assertNotIn('具体次数', answer)

    def test_malformed_missing_section_keeps_privacy_error_classification(self):
        strategy = AnalysisStrategy(synthetic_tools())
        ref = next(r for r, f in strategy.projection.fields.items()
                   if f['local']['path'].endswith('overdue_count'))
        facts = {f['field_ref']: f for f in strategy.projection.read([ref])}
        overview = ReportOverview(strategy.tools, strategy.projection, strategy._check_text,
                                  json.loads, strategy._check_sourced_text)
        with self.assertRaises(PrivacyError):
            overview._validate({'text': {'unexpected': 'data'}, 'sources': [ref]}, facts)

    def test_ambiguous_and_provided_values_are_not_rewritten(self):
        text = '无法确认具体次数，0次不是没有逾期。'
        for facts in ([{'name': '逾期记录数', 'status': 'provided', 'value': 0}],
                      [{'name': '逾期记录数', 'status': 'missing'}, {'name': '申请次数', 'status': 'missing'}],
                      [{'name': '逾期记录数', 'status': 'withheld'}]):
            self.assertEqual(text, natural_missing_text(text, facts))

    def test_institution_missing_uses_its_own_noun(self):
        self.assertEqual('无法确认具体机构数。', natural_missing_text(
            '无法确认具体次数。', [{'name': '非银行申请机构数', 'status': 'null'}]))

    def test_report_list_duplicate_is_removed_without_removing_next_step(self):
        report = '近7天非银行申请为0次。账号下的报告总数无法通过当前这份报告确认。'
        answer = append_service_answer(report, ['report_list'])
        self.assertTrue(answer.startswith(report))
        self.assertNotIn('当前对话只绑定', answer)
        self.assertIn('报告列表', answer)
        self.assertNotIn('/orders', answer)

    def test_different_or_uncertain_scope_keeps_trusted_explanation(self):
        for report in ('非银行申请总数无法通过当前这份报告确认。',
                       '账号下的报告总数可以从这份报告确认。', '账号下的报告总数还需了解。'):
            self.assertIn(SERVICE_REPLIES['report_list'], append_service_answer(report, ['report_list']))

    def test_other_services_and_contacts_are_preserved(self):
        report = '学历为本科。'
        self.assertEqual(report + '\n\n' + service_replies(['refund', 'appeal']),
                         append_service_answer(report, ['refund', 'appeal']))

    def test_key_facts_only_use_already_shown_single_source(self):
        modules = [{'module_ref': 'm1'}, {'module_ref': 'm2'}, {'module_ref': 'm3'}]
        sections = {'m1': {'text': '近7天申请8次。', 'sources': ['f1']},
                    'm2': {'text': '贷款信息已登记。', 'sources': ['f2']},
                    'm3': {'text': '其他申请18次。', 'sources': ['f3']}}
        facts = {'f1': {'value': 8, 'name': '申请次数', 'window': '近7天', 'status': 'provided'},
                 'f2': {'value': 24, 'name': '贷款期限', 'status': 'provided'},
                 'f3': {'value': 8, 'name': '申请次数', 'status': 'provided'}}
        rows = ReportOverview._key_facts(modules, sections, facts)
        self.assertEqual(['f1'], [r['field_ref'] for r in rows])
        self.assertEqual('次', rows[0]['unit'])
        self.assertNotIn('value', rows[0])

    def test_multiple_sources_do_not_authorize_scalar_assignment(self):
        self.assertEqual([], ReportOverview._key_facts([{'module_ref': 'm1'}],
            {'m1': {'text': '申请8次。', 'sources': ['f1', 'f2']}},
            {'f1': {'value': 8, 'status': 'provided'}, 'f2': {'value': 8, 'status': 'provided'}}))

    def test_focus_does_not_hide_full_module_facts_or_add_requests(self):
        tools, client = overview_tools(count=2, fields=4), OverviewClient()
        answer = Conversation(tools, strategy='analysis').answer('分析下我的报告', client, 'synthetic-model')
        self.assertIn('**整体总结**', answer)
        self.assertEqual(2, len(client.requests))
        payload = json.loads(client.requests[0]['messages'][-1]['content'])
        self.assertEqual(4, len(payload['modules'][0]['facts']))
        self.assertEqual(3, len(payload['modules'][0]['focus_fields']))
        summary = json.loads(client.requests[-1]['messages'][-1]['content'])
        self.assertIn('key_facts', summary)

    def test_focus_keeps_zero_and_user_requested_metric(self):
        module = {'facts': [{'field_ref': 'f1', 'name': '学历', 'status': 'provided', 'value': '本科'},
                            {'field_ref': 'f2', 'name': '逾期记录数', 'status': 'provided', 'value': 0}]}
        self.assertEqual('f1', ReportOverview._focus_fields(module, '先看学历')[0])
        self.assertEqual('f2', ReportOverview._focus_fields(module, '分析报告')[0])

    def test_wrong_quantity_unit_is_not_promoted_to_key_fact(self):
        self.assertEqual([], ReportOverview._key_facts([{'module_ref': 'm1'}],
            {'m1': {'text': '申请8家。', 'sources': ['f1']}},
            {'f1': {'value': 8, 'name': '申请次数', 'status': 'provided'}}))

    def test_real_summary_payload_carries_only_displayed_anchor(self):
        def mutate(stage, value, payload, *_):
            if stage == 'modules':
                value['modules'][0]['text'] = '近7天申请0次。'
            elif stage == 'summary':
                self.assertEqual(1, len(payload['key_facts']))
                self.assertEqual('近7天申请0次。', payload['key_facts'][0]['text'])
                self.assertEqual('近7天', payload['key_facts'][0]['window'])
                value['text'] = '近7天申请0次。'
            return value
        answer = Conversation(overview_tools(count=1), strategy='analysis').answer(
            '分析下我的报告', OverviewClient(mutate), 'synthetic-model')
        self.assertIn('**整体总结**', answer)
        self.assertIn('近7天申请0次。', answer)
