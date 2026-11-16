"""位置模块范围回归：只读选中事实、局部总结不冒充全报告、失败不泄漏被拒草稿。"""

from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import patch

from report_assistant.conversation.session import Conversation
from report_assistant.conversation.module_selection import select_modules
from report_assistant.conversation.overview import ReportOverview, OverviewBudgetError
from report_assistant.conversation.analysis import AnalysisContext
from report_assistant.conversation.analysis_protocol import strict_json
from report_assistant.integrations.history import HistoryError
from report_assistant.reports.tools import LocalReportTools
from report_assistant.security.privacy import PrivacyError
from support import analysis as script
from support import privacy
from support.overview import overview_tools, OverviewClient


class ModuleSelectionTests(privacy.NoExternalIO):
    """全部使用虚构模板，脚本模型不访问.env、Java或真实模型服务。"""

    def conversation(self, tools=None, history=None):
        return Conversation(tools or overview_tools(count=10), history, strategy='analysis', allow_personal=True)

    def payloads(self, client):
        return [json.loads(request['messages'][-1]['content']) for request in client.requests]

    def test_front_three_are_bound_before_reading_or_model_routing(self):
        conversation, client = self.conversation(), OverviewClient()
        allowed = {item['local']['path'] for item in conversation.analysis.projection.fields.values()
                   if item['local']['module_id'] in {20, 21, 22}}
        with patch.object(conversation.tools, 'get_current_order_data', wraps=conversation.tools.get_current_order_data) as read:
            answer = conversation.answer('分析下前面三个模块', client, 'synthetic-model')
        paths = {path for call in read.call_args_list for path in call.args[0]}
        self.assertEqual(paths, allowed)
        self.assertEqual(len(client.requests), 2)
        self.assertIn('所选模块总结', answer)
        self.assertNotIn('整体总结', answer)
        self.assertNotIn('测试模块D', answer)
        for payload in self.payloads(client):
            self.assertEqual(len(payload['modules']), 3)
            self.assertTrue(payload['scope']['is_partial'])
            self.assertEqual(payload['scope']['module_count'], 3)
            self.assertEqual(payload['scope']['report_module_count'], 10)
        self.assertEqual(len(conversation.analysis_context.field_refs), 3)

    def test_position_uses_template_order_rather_than_catalog_projection_order(self):
        conversation, client = self.conversation(overview_tools(count=10, reverse=True)), OverviewClient()
        answer = conversation.answer('解读前3个模块', client, 'synthetic-model')
        payload = self.payloads(client)[0]
        self.assertEqual([module['name'] for module in payload['modules']], ['测试模块J', '测试模块I', '测试模块H'])
        self.assertLess(answer.index('测试模块J'), answer.index('测试模块I'))
        self.assertNotIn('测试模块A', answer)

    def test_single_range_last_and_chinese_positions(self):
        tools = overview_tools(count=12)
        for question, expected in (('分析第二个模块', (21,)), ('解释第2个到第4个模块', (21, 22, 23)),
                                   ('总结最后两个模块', (30, 31)), ('分析前十一个模块', tuple(range(20, 31))),
                                   ('解读第十二个模块', (31,))):
            with self.subTest(question=question):
                self.assertEqual(select_modules(question, tools).module_ids, expected)

    def test_report_subject_and_natural_style_keep_the_selected_positions(self):
        tools = overview_tools(count=10)
        for question in ('请帮我分析这份报告前3个模块的情况',
                         '用通俗的话解读当前报告前面的三个模块', '简单分析最后的两个模块'):
            with self.subTest(question=question):
                expected = (28, 29) if '最后' in question else (20, 21, 22)
                self.assertEqual(select_modules(question, tools).module_ids, expected)

    def test_inverted_and_followup_wording_stays_in_the_current_directory(self):
        tools = overview_tools(count=10)
        for question, expected in (('把前3个模块分析一下', (20, 21, 22)),
                                   ('前三个模块怎么样', (20, 21, 22)),
                                   ('前3个模块分别是什么情况', (20, 21, 22)),
                                   ('我想看前三个模块', (20, 21, 22)),
                                   ('第二个模块呢', (21,)),
                                   ('最后两个模块呢', (28, 29))):
            with self.subTest(question=question):
                self.assertEqual(select_modules(question, tools).module_ids, expected)
        conversation, client = self.conversation(tools), OverviewClient()
        answer = conversation.answer('前三个模块怎么样', client, 'synthetic-model')
        self.assertIn('所选模块总结', answer)
        self.assertNotIn('测试模块D', answer)
        self.assertEqual(len(client.requests), 2)

    def test_unresolved_position_never_expands_to_a_full_report(self):
        for question in ('分析前1234567890123个模块', '前三个模块和借贷情况都说说',
                         '第1个和第2个模块怎么样'):
            with self.subTest(question=question):
                client = script.ScriptClient([])
                answer = self.conversation().answer(question, client, 'synthetic-model')
                self.assertIn('具体位置', answer)
                self.assertEqual(client.requests, [])

    def test_unresolved_position_hint_is_clarified_instead_of_running_all_modules(self):
        client = script.ScriptClient([])
        answer = self.conversation().answer('可以帮忙详细看看前3个模块吗', client, 'synthetic-model')
        self.assertIn('具体位置', answer)
        self.assertEqual(client.requests, [])

    def test_invalid_positions_do_not_start_or_expand_analysis(self):
        for question in ('分析前0个模块', '分析前11个模块', '分析第0个模块', '分析第4到第2个模块',
                         '分析前一百个模块', '分析前-1个模块', '分析前1000000个模块'):
            with self.subTest(question=question):
                client = script.ScriptClient([])
                answer = self.conversation().answer(question, client, 'synthetic-model')
                self.assertIn('实际存在的位置', answer)
                self.assertEqual(client.requests, [])

    def test_unknown_additional_report_request_is_not_dropped(self):
        client = script.ScriptClient([])
        answer = self.conversation().answer('分析前3个模块，再查所有银行申请记录', client, 'synthetic-model')
        self.assertIn('其他指标问题', answer)
        self.assertEqual(client.requests, [])

    def test_selected_modules_and_refund_are_both_answered(self):
        conversation, client = self.conversation(), OverviewClient()
        answer = conversation.answer('分析前3个模块，怎么退款', client, 'synthetic-model')
        self.assertIn('所选模块总结', answer)
        self.assertIn('退款', answer)
        self.assertEqual(len(client.requests), 2)

    def test_catalog_and_selected_analysis_keep_the_same_order(self):
        conversation, client = self.conversation(overview_tools(count=10, reverse=True)), OverviewClient()
        answer = conversation.answer('目前有哪些模块，然后分析前3个模块', client, 'synthetic-model')
        self.assertIn('10个模块', answer)
        self.assertIn('所选模块总结', answer)
        self.assertEqual([module['name'] for module in self.payloads(client)[0]['modules']], ['测试模块J', '测试模块I', '测试模块H'])

    def test_direct_analysis_strategy_preserves_compound_catalog_scope(self):
        strategy, client = self.conversation().analysis, OverviewClient()
        answer, context = strategy.answer('目前有哪些模块，然后分析前3个模块', client, 'synthetic-model')
        self.assertIn('10个模块', answer)
        self.assertIn('所选模块总结', answer)
        self.assertNotIn('测试模块D**', answer)
        self.assertEqual(len(context.field_refs), 3)
        self.assertEqual(len(client.requests), 2)

    def test_numeric_retry_failure_returns_scoped_verified_preview(self):
        def mutate(stage, value, payload, count):
            if stage == 'modules':
                value['modules'][0]['text'] = '申请次数为999次。'
            return value
        conversation, client = self.conversation(), OverviewClient(mutate)
        answer = conversation.answer('分析下前面三个模块', client, 'synthetic-model')
        self.assertIn('分析暂未完成', answer)
        self.assertIn('展示结果', answer)
        self.assertNotIn('999', answer)
        self.assertNotIn('测试模块D', answer)
        self.assertNotIn('请说明具体指标和周期', answer)
        self.assertEqual(len(client.requests), 2)
        self.assertIsNone(conversation.analysis_context)

    def test_connection_failure_uses_same_selection_and_preserves_service(self):
        client = script.ScriptClient([RuntimeError('synthetic')])
        answer = self.conversation().answer('解读第二到第四个模块，如何退款', client, 'synthetic-model')
        self.assertIn('测试模块B', answer)
        self.assertIn('测试模块D', answer)
        self.assertNotIn('测试模块A', answer)
        self.assertIn('退款', answer)
        self.assertEqual(len(client.requests), 1)

    def test_partial_summary_cannot_claim_to_cover_the_entire_report(self):
        def mutate(stage, value, payload, count):
            if stage == 'summary':
                value['text'] = '整份报告仅包含申请信息。'
            return value
        conversation, client = self.conversation(), OverviewClient(mutate)
        answer = conversation.answer('解读前三个模块', client, 'synthetic-model')
        self.assertIn('分析暂未完成', answer)
        self.assertNotIn('整份报告仅包含', answer)
        self.assertEqual(len(client.requests), 2)

    def test_empty_module_retains_its_selected_position(self):
        tools = overview_tools(count=4)
        order, catalog = deepcopy(tools._order), deepcopy(tools._catalog)
        order['report_data']['template']['modules'].insert(0, {'moduleId': 99, 'moduleName': '空模块'})
        conversation, client = self.conversation(LocalReportTools(order, catalog)), OverviewClient()
        answer = conversation.answer('解读前三个模块', client, 'synthetic-model')
        self.assertIn('空模块', answer)
        self.assertNotIn('测试模块C', answer)
        self.assertEqual(self.payloads(client)[0]['scope']['module_count'], 3)
        self.assertEqual(len(self.payloads(client)[0]['modules']), 2)

    def test_unselected_oversized_module_does_not_consume_the_partial_budget(self):
        tools = overview_tools(count=2, fields=1)
        order, catalog = deepcopy(tools._order), deepcopy(tools._catalog)
        field = deepcopy(catalog['fields'][1])
        for index in range(256):
            extra = {**field, 'path': 'report.extra_' + str(index)}
            catalog['fields'].append(extra)
        conversation = self.conversation(LocalReportTools(order, catalog))
        strategy = conversation.analysis
        selected = ReportOverview(conversation.tools, strategy.projection, strategy._check_text, strict_json, module_ids=(20,))
        self.assertEqual(len(selected._prepare()), 1)
        with self.assertRaises(OverviewBudgetError):
            ReportOverview(conversation.tools, strategy.projection, strategy._check_text, strict_json)._prepare()

    def test_programmatic_selection_cannot_forge_or_repeat_module_ids(self):
        strategy = self.conversation().analysis
        for ids in ((), (999,), (20, 20), ('other_report',), ({'module': 20},)):
            with self.subTest(kind=str(type(ids[0])) if ids else 'empty'):
                with self.assertRaises(PrivacyError):
                    ReportOverview(strategy.tools, strategy.projection, strategy._check_text, strict_json, module_ids=ids)._prepare()

    def test_selected_history_failure_does_not_commit_context(self):
        history = SimpleNamespace(read=lambda _: [], append=lambda *_: (_ for _ in ()).throw(HistoryError('synthetic')))
        conversation = self.conversation(history=history)
        conversation.analysis_context = AnalysisContext('旧问题', ('f1',))
        before = deepcopy((conversation.analysis_context, conversation.local_history, conversation.last_query))
        with self.assertRaises(HistoryError):
            conversation.answer('分析前三个模块', OverviewClient(), 'synthetic-model')
        self.assertEqual((conversation.analysis_context, conversation.local_history, conversation.last_query), before)

    def test_ordinary_queries_and_negated_selection_are_not_hijacked(self):
        for question in ('有哪些模块', '不要分析前三个模块', '近3个月申请次数是多少', '整体分析报告'):
            self.assertFalse(select_modules(question, overview_tools(count=10)).matched)
