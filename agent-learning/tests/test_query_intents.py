"""目录、指标范围与失败兜底回归；仅使用虚构报告和固定模型脚本。"""

from copy import deepcopy
import json
from types import SimpleNamespace

from report_assistant.conversation.session import Conversation
from report_assistant.conversation.analysis import AnalysisContext
from report_assistant.conversation.local_intents import split_catalog_request
from report_assistant.integrations.history import HistoryError
from report_assistant.reports.tools import LocalReportTools
from report_assistant.conversation.service import SERVICE_HOURS, HOTLINE
from support import analysis as script
from support import privacy
from support.overview import overview_tools, OverviewClient


class QueryIntentTests(privacy.NoExternalIO):
    """检查模型错误分流和失败时的真实会话输出、调用数及历史提交边界。"""

    def conversation(self, tools=None, history=None):
        return Conversation(tools or LocalReportTools(*privacy.fixtures(61.25)), history,
                            strategy='analysis', allow_personal=True)

    def assert_customer_text(self, answer):
        for word in ('/find', '/pick', 'report.', 'field_ref', '条字段资料'):
            self.assertNotIn(word, answer)

    def test_module_directory_aliases_answer_all_modules_with_zero_model_requests(self):
        tools = overview_tools(count=10)
        for question in ('目前有哪些模块', '这份报告包含哪些栏目？', '报告里有什么内容',
                         '当前报告有几个模块', '能查什么', '请列出所有模块', '模块目录',
                         '报告的模块有哪些', '报告一共有几个模块', '列一下报告中的模块'):
            with self.subTest(question=question):
                conversation, client = self.conversation(tools), script.ScriptClient([])
                answer = conversation.answer(question, client, 'synthetic-model')
                self.assertIn('10个模块', answer)
                for module in tools.current_modules():
                    self.assertIn(module['name'], answer)
                self.assertEqual(client.requests, [])
                self.assertIsNone(conversation.analysis_context)
                self.assert_customer_text(answer)

    def test_directory_uses_enabled_template_order_and_preserves_empty_modules(self):
        order, catalog = privacy.fixtures(61.25)
        order['report_data']['template']['modules'] = [
            {'moduleId': 88, 'moduleName': '无已登记字段模块'},
            {'moduleId': 5, 'moduleName': '模板别名'},
            {'moduleId': 99, 'moduleName': 'token=SYNTHETIC_CREDENTIAL'},
        ]
        conversation = self.conversation(LocalReportTools(order, catalog))
        answer = conversation.answer('目前有哪些模块', script.ScriptClient([]), 'synthetic-model')
        self.assertIn('3个模块', answer)
        self.assertLess(answer.index('无已登记字段模块'), answer.index('测试指数模块'))
        self.assertNotIn('SYNTHETIC_CREDENTIAL', answer)
        self.assertNotIn('非银行申请', answer)

    def test_empty_directory_is_answered_without_model(self):
        answer = self.conversation(overview_tools(count=0)).answer('目前有哪些模块', script.ScriptClient([]), 'synthetic-model')
        self.assertIn('没有可列出的模块', answer)

    def test_catalog_and_metric_keep_both_requests_and_original_history(self):
        conversation, client = self.conversation(), script.report_client(refs=('f2',), text='近7天非银行申请次数为0次。')
        question = '目前有哪些模块，然后查近7天非银行申请次数'
        answer = conversation.answer(question, client, 'synthetic-model')
        self.assertIn('个模块', answer)
        self.assertIn('0次', answer)
        self.assertEqual(len(client.requests), 4)
        self.assertEqual(conversation.local_history[-1]['question'], question)
        self.assertNotIn('有哪些模块', conversation.analysis_context.question)
        self.assert_customer_text(answer)

    def test_catalog_and_service_are_both_answered_locally(self):
        client = script.ScriptClient([])
        answer = self.conversation().answer('目前有哪些模块，怎么退款', client, 'synthetic-model')
        self.assertIn('个模块', answer)
        self.assertIn('退款', answer)
        self.assertIn(HOTLINE, answer)
        self.assertEqual(client.requests, [])

    def test_catalog_and_full_analysis_keep_overview(self):
        conversation, client = self.conversation(), OverviewClient()
        answer = conversation.answer('有哪些模块并分析整份报告', client, 'synthetic-model')
        self.assertIn('个模块', answer)
        self.assertIn('整体总结', answer)
        self.assertGreater(len(client.requests), 0)

    def test_unclosed_catalog_question_is_not_truncated(self):
        self.assertFalse(split_catalog_request('目前有哪些模块和风险').listing)
        self.assertFalse(split_catalog_request('我的账号有哪些报告').listing)
        self.assertFalse(split_catalog_request('这个账号的报告有哪些模块').listing)
        self.assertFalse(split_catalog_request('身份证号是什么').listing)

    def test_catalog_conjunctions_keep_selected_module_scope(self):
        tools = overview_tools(count=10)
        for connector in ('并', '以及', '和'):
            with self.subTest(connector=connector):
                conversation, client = self.conversation(tools), OverviewClient()
                answer = conversation.answer('有哪些模块' + connector + '分析前三个', client, 'synthetic-model')
                self.assertIn('10个模块', answer)
                self.assertIn('所选模块总结', answer)
                self.assertNotIn('**测试模块D**', answer)
                self.assertEqual(len(client.requests), 2)
                payload = json.loads(client.requests[0]['messages'][-1]['content'])
                self.assertEqual([module['name'] for module in payload['modules']],
                                 ['测试模块A', '测试模块B', '测试模块C'])

    def test_catalog_conjunctions_keep_fixed_service_question(self):
        for question in ('有哪些模块以及怎么退款', '有哪些模块和人工客服服务时间'):
            with self.subTest(question=question):
                client = script.ScriptClient([])
                answer = self.conversation().answer(question, client, 'synthetic-model')
                self.assertIn('个模块', answer)
                self.assertIn(HOTLINE, answer)
                self.assertEqual(client.requests, [])

    def test_catalog_position_ellipsis_does_not_consume_other_objects(self):
        request = split_catalog_request('有哪些模块并分析前三个字段')
        self.assertTrue(request.listing)
        self.assertEqual(request.question, '分析前三个字段')

    def test_original_credential_check_cannot_be_bypassed_by_catalog_split(self):
        client = script.ScriptClient([])
        answer = self.conversation().answer('目前有哪些模块，token=SYNTHETIC_CREDENTIAL', client, 'synthetic-model')
        self.assertIn('登录凭据', answer)
        self.assertNotIn('个模块：', answer)
        self.assertEqual(client.requests, [])

    def test_focused_target_overrides_incorrect_overview_route(self):
        conversation = self.conversation()
        client = script.report_client(refs=('f2',), text='近7天非银行申请次数为0次。')
        client.script[0] = script.response(json.dumps({'route': 'report', 'use_previous': False, 'scope': 'overview'}))
        answer = conversation.answer('近7天非银行申请次数是多少', client, 'synthetic-model')
        self.assertIn('0次', answer)
        self.assertNotIn('整体总结', answer)
        self.assertNotIn('改用本地', answer)
        self.assertEqual(conversation.analysis_context.field_refs, ('f2',))
        self.assertEqual(len(client.requests), 4)

    def test_explicit_overview_with_metric_focus_is_not_narrowed(self):
        for question in ('整体分析这份报告，重点看近7天非银行申请次数',
                         '整体分析这份报告重点看近7天非银行申请次数'):
            with self.subTest(question=question):
                conversation, client = self.conversation(), OverviewClient()
                answer = conversation.answer(question, client, 'synthetic-model')
                self.assertIn('整体总结', answer)
                self.assertGreater(len(conversation.analysis_context.field_refs), 1)

    def test_open_report_request_with_a_metric_is_not_silently_narrowed(self):
        conversation, client = self.conversation(), OverviewClient()
        answer = conversation.answer('这份报告总体怎么样，查一下近7天非银行申请次数', client, 'synthetic-model')
        self.assertIn('整体总结', answer)
        self.assertGreater(len(conversation.analysis_context.field_refs), 1)

    def test_direct_strategy_directory_uses_the_same_zero_request_contract(self):
        strategy, client = self.conversation().analysis, script.ScriptClient([])
        answer, context = strategy.answer('目前有哪些模块', client, 'synthetic-model')
        self.assertIn('个模块', answer)
        self.assertIsNone(context)
        self.assertEqual(client.requests, [])

    def test_calendar_query_keeps_safe_clarification_after_model_failure(self):
        answer = self.conversation().answer('上个月非银行申请次数是多少', script.ScriptClient([RuntimeError('synthetic')]), 'synthetic-model')
        self.assertIn('自然月', answer)
        self.assertNotIn('0次', answer)
        self.assert_customer_text(answer)

    def test_multiwindow_failure_requests_clarification_without_mixing_values(self):
        answer = self.conversation().answer('近7天和近1个月非银行申请次数分别是多少', script.ScriptClient([RuntimeError('synthetic')]), 'synthetic-model')
        self.assertIn('多个统计周期', answer)
        self.assertNotIn('0次', answer)
        self.assert_customer_text(answer)

    def test_multiwindow_success_is_still_allowed(self):
        conversation = self.conversation()
        client = script.report_client(refs=('f2', 'f3'), text='近7天非银行申请次数为0次，近1个月结果暂未提供。')
        answer = conversation.answer('近7天和近1个月非银行申请次数分别是多少', client, 'synthetic-model')
        self.assertNotIn('改用本地', answer)
        self.assertIn('0次', answer)
        self.assertIn('近1个月', answer)
        self.assertEqual(set(conversation.analysis_context.field_refs), {'f2', 'f3'})

    def test_mixed_report_and_refund_keep_fixed_service_after_failure(self):
        client = script.ScriptClient([RuntimeError('synthetic')])
        answer = self.conversation().answer('近7天非银行申请次数是多少，怎么退款', client, 'synthetic-model')
        self.assertIn('0', answer)
        self.assertIn('退款', answer)
        self.assertEqual(answer.count(HOTLINE), 1)
        self.assertEqual(len(client.requests), 1)
        self.assert_customer_text(answer)

    def test_semantic_service_fallback_does_not_ask_for_a_report_metric(self):
        answer = self.conversation().answer('如何咨询退款', script.ScriptClient([RuntimeError('synthetic')]), 'synthetic-model')
        self.assertIn('退款', answer)
        self.assertNotIn('哪一项', answer)
        self.assertNotIn('AI分析', answer)

    def test_common_service_hours_wording_is_answered_without_model(self):
        for question in ('客服几点上班', '人工客服服务时间', '客服什么时候在线', '客服电话是多少'):
            with self.subTest(question=question):
                client = script.ScriptClient([])
                answer = self.conversation().answer(question, client, 'synthetic-model')
                self.assertIn(SERVICE_HOURS, answer)
                self.assertIn(HOTLINE, answer)
                self.assertEqual(client.requests, [])

    def test_period_clarification_does_not_drop_refund(self):
        answer = self.conversation().answer('上个月非银行申请次数是多少，如何退款', script.ScriptClient([RuntimeError('synthetic')]), 'synthetic-model')
        self.assertIn('自然月', answer)
        self.assertIn('退款', answer)

    def test_local_catalog_history_failure_keeps_previous_state(self):
        history = SimpleNamespace(read=lambda _: [], append=lambda *_: (_ for _ in ()).throw(HistoryError('synthetic')))
        conversation = self.conversation(history=history)
        conversation.analysis_context = AnalysisContext('旧问题', ('f1',))
        before = deepcopy((conversation.analysis_context, conversation.local_history, conversation.last_query))
        with self.assertRaises(HistoryError):
            conversation.answer('目前有哪些模块', script.ScriptClient([]), 'synthetic-model')
        self.assertEqual((conversation.analysis_context, conversation.local_history, conversation.last_query), before)
