"""模型失败时只对可确定的查值诉求提供本地结果，开放分析不落入指标误提示。"""

from unittest.mock import patch

from report_assistant.conversation.analysis_protocol import AnalysisFailure
from report_assistant.conversation.session import Conversation
from report_assistant.reports.tools import LocalReportTools
from report_assistant.security.privacy import PrivacyError
from support import privacy
from support.analysis import ScriptClient, response
from support.overview import OverviewClient, overview_tools


class FailureFallbackTests(privacy.NoExternalIO):
    """只用虚构报告和脚本模型，检查失败分类与实际回退范围一致。"""

    @staticmethod
    def conversation(tools=None):
        return Conversation(tools or LocalReportTools(*privacy.fixtures(61.25)),
                            strategy='analysis', allow_personal=True)

    def test_open_or_unknown_question_never_runs_metric_lookup_after_route_failure(self):
        questions = ('这份报告风险怎么样', '这份报告里哪些方面值得关注',
                     '解释一下报告里的情况', '我的报告里有没有需要注意的问题',
                     '聊聊学习方法', '去年和今年的旅游安排怎么变了', '去年和今年房价是多少')
        for question in questions:
            with self.subTest(question=question):
                conversation, client = self.conversation(), ScriptClient([RuntimeError('synthetic')])
                with patch.object(conversation, '_local_query', side_effect=AssertionError('wrong metric lookup')):
                    answer = conversation.answer(question, client, 'synthetic-model')
                self.assertIn('回答暂未完成', answer)
                self.assertNotIn('指标或统计周期', answer)
                self.assertNotIn('改用本地查询', answer)
                self.assertEqual(len(client.requests), 1)
                self.assertIsNone(conversation.analysis_context)

    def test_model_routed_overview_numeric_failure_does_not_query_a_metric(self):
        def mutate(stage, value, payload, count):
            if stage == 'modules':
                value['modules'][0]['text'] = '申请记录有999次。'
            return value

        conversation, client = self.conversation(overview_tools(count=4)), OverviewClient(mutate)
        with patch.object(conversation, '_local_query', side_effect=AssertionError('wrong metric lookup')):
            answer = conversation.answer('这份报告里哪些方面值得关注', client, 'synthetic-model')
        self.assertIn('回答暂未完成', answer)
        self.assertNotIn('指标或统计周期', answer)
        self.assertNotIn('999', answer)
        self.assertNotIn('改用本地查询', answer)
        self.assertEqual(len(client.requests), 3)

    def test_ambiguous_multiple_targets_do_not_publish_one_partial_result(self):
        for question in ('近7天银行和非银行申请次数各是多少',
                         '分析指数和收入预测是多少', '分析指数和不存在的字段是多少',
                         '分析指数以及案件情况是什么'):
            with self.subTest(question=question):
                conversation, client = self.conversation(), ScriptClient([RuntimeError('synthetic')])
                answer = conversation.answer(question, client, 'synthetic-model')
                self.assertIn('回答暂未完成', answer)
                self.assertNotIn('显示为61.25', answer)
                self.assertNotIn('显示为0', answer)
                self.assertNotIn('指标或统计周期', answer)
                self.assertEqual(len(client.requests), 1)

    def test_named_module_does_not_ask_for_a_module_again_after_lookup_ambiguity(self):
        conversation, client = self.conversation(overview_tools(count=10)), ScriptClient([RuntimeError('synthetic')])
        answer = conversation.answer('测试模块A的申请次数是多少', client, 'synthetic-model')
        self.assertIn('回答暂未完成', answer)
        self.assertNotIn('请补充模块', answer)
        self.assertNotIn('指标或统计周期', answer)
        self.assertEqual(len(client.requests), 1)

    def test_offline_analysis_uses_the_same_scope_boundary(self):
        for question in ('这份报告风险怎么样', '这份报告里哪些方面值得关注'):
            with self.subTest(question=question):
                conversation = self.conversation()
                with patch.object(conversation, '_local_query', side_effect=AssertionError('wrong metric lookup')):
                    answer = conversation.answer(question)
                self.assertIn('当前未开启AI分析', answer)
                self.assertNotIn('指标或统计周期', answer)
        answer = self.conversation().answer('近7天银行和非银行申请次数各是多少')
        self.assertIn('回答暂未完成', answer)
        self.assertNotIn('指标或统计周期', answer)
        self.assertIn('整体分析暂未完成', self.conversation().answer('分析下我的报告'))
        self.assertIn('显示为0', self.conversation().answer('近7天非银行申请次数是多少'))

    def test_verified_single_metric_remains_answerable_without_false_fallback_claim(self):
        for question, expected in (('近7天非银行申请次数是多少', '显示为0'),
                                   ('分析指数是多少', '显示为61.25'),
                                   ('这份报告的分析指数是多少', '显示为61.25')):
            with self.subTest(question=question):
                conversation, client = self.conversation(), ScriptClient([RuntimeError('synthetic')])
                answer = conversation.answer(question, client, 'synthetic-model')
                self.assertIn(expected, answer)
                self.assertNotIn('改用本地查询', answer)
                self.assertEqual(len(client.requests), 1)
                self.assertEqual(len(conversation.analysis_context.field_refs), 1)

    def test_local_projection_rejection_does_not_leak_a_partial_value(self):
        conversation = self.conversation()
        with patch.object(conversation.analysis.projection, 'customer_answer',
                          side_effect=PrivacyError('SYNTHETIC_PRIVATE_DETAIL')):
            answer = conversation.answer('近7天非银行申请次数是多少',
                                         ScriptClient([RuntimeError('synthetic')]), 'synthetic-model')
        self.assertIn('回答暂未完成', answer)
        self.assertNotIn('SYNTHETIC_PRIVATE_DETAIL', answer)
        self.assertEqual(conversation.last_fields, [])

    def test_period_ambiguity_keeps_specific_clarification(self):
        for question, expected in (('上个月非银行申请次数是多少', '自然月'),
                                   ('近7天和近1个月非银行申请次数分别是多少', '多个统计周期')):
            with self.subTest(question=question):
                answer = self.conversation().answer(question, ScriptClient([RuntimeError('synthetic')]),
                                                    'synthetic-model')
                self.assertIn(expected, answer)
                self.assertNotIn('改用本地查询', answer)

    def test_failure_reason_does_not_claim_a_lookup_and_invalid_route_has_neutral_fallback(self):
        self.assertNotIn('本地查询', str(AnalysisFailure('answer')))
        client = ScriptClient([response('{"route":"report","use_previous":false,"scope":"unknown"}')])
        answer = self.conversation().answer('这份报告风险怎么样', client, 'synthetic-model')
        self.assertIn('AI分析未完成', answer)
        self.assertIn('回答暂未完成', answer)
        self.assertNotIn('指标或统计周期', answer)
        self.assertEqual(len(client.requests), 1)
