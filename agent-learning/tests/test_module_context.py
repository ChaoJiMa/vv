"""模块指代只承接上一轮已展示范围；失败时保留范围且不发布未核验小结。"""

from copy import deepcopy
from types import SimpleNamespace

from report_assistant.conversation.session import Conversation
from report_assistant.integrations.history import HistoryError
from support.analysis import ScriptClient
from support.overview import OverviewClient, overview_tools
from support.privacy import NoExternalIO


class ModuleContextTests(NoExternalIO):
    """全部使用虚构目录与脚本模型，避免读取本机配置、真实报告或外网。"""

    @staticmethod
    def conversation(count=4, history=None):
        return Conversation(overview_tools(count=count), history, strategy='analysis', allow_personal=True)

    def test_catalog_then_these_modules_uses_exact_current_directory(self):
        conversation = self.conversation()
        directory_client = ScriptClient([])
        conversation.answer('目前有哪些模块', directory_client, 'synthetic-model')
        self.assertEqual(conversation.module_context, (20, 21, 22, 23))
        self.assertEqual(directory_client.requests, [])

        client = OverviewClient()
        answer = conversation.answer('给我分析下这些模块', client, 'synthetic-model')
        self.assertIn('整体总结', answer)
        self.assertNotIn('所选模块总结', answer)
        self.assertNotIn('请说明具体指标和周期', answer)
        self.assertEqual(len(client.requests), 2)
        self.assertEqual(conversation.module_context, (20, 21, 22, 23))
        self.assertEqual(len(conversation.analysis_context.field_refs), 4)

    def test_selected_scope_is_reused_without_expanding_to_all_modules(self):
        conversation = self.conversation(count=10)
        conversation.answer('分析前三个模块', OverviewClient(), 'synthetic-model')
        self.assertEqual(conversation.module_context, (20, 21, 22))
        client = OverviewClient()
        answer = conversation.answer('这些模块怎么样', client, 'synthetic-model')
        self.assertIn('所选模块总结', answer)
        self.assertNotIn('**测试模块D**', answer)
        self.assertEqual(len(client.requests), 2)

    def test_unbound_or_stale_reference_clarifies_without_model(self):
        conversation = self.conversation()
        client = ScriptClient([])
        answer = conversation.answer('给我分析下这些模块', client, 'synthetic-model')
        self.assertIn('可确定的模块范围', answer)
        self.assertNotIn('请说明具体指标和周期', answer)
        self.assertEqual(client.requests, [])

        conversation.answer('目前有哪些模块', ScriptClient([]), 'synthetic-model')
        conversation.answer('怎么退款', ScriptClient([]), 'synthetic-model')
        self.assertIsNone(conversation.module_context)
        client = ScriptClient([])
        self.assertIn('可确定的模块范围', conversation.answer('分析这些模块', client, 'synthetic-model'))
        self.assertEqual(client.requests, [])

    def test_numeric_failure_after_catalog_previews_only_bounded_verified_scope(self):
        def mutate(stage, value, payload, count):
            if stage == 'modules':
                value['modules'][3]['text'] = '申请次数为999次。'
            return value

        conversation = self.conversation(count=10)
        conversation.answer('目前有哪些模块', ScriptClient([]), 'synthetic-model')
        client = OverviewClient(mutate)
        answer = conversation.answer('给我分析下这些模块', client, 'synthetic-model')
        self.assertIn('分析暂未完成', answer)
        self.assertIn('其余2个所选模块本次未展示', answer)
        self.assertNotIn('999', answer)
        self.assertNotIn('请说明具体指标和周期', answer)
        self.assertNotIn('**测试模块I**', answer)
        self.assertEqual(len(client.requests), 2)
        self.assertIsNone(conversation.analysis_context)
        self.assertEqual(conversation.module_context, tuple(range(20, 30)))

    def test_explicit_full_failure_uses_full_scope_clarification_without_partial_draft(self):
        def mutate(stage, value, payload, count):
            if stage == 'modules':
                value['modules'][0]['text'] = '报告共有999条记录。'
            return value

        conversation, client = self.conversation(), OverviewClient(mutate)
        answer = conversation.answer('分析下我的报告', client, 'synthetic-model')
        self.assertIn('整体分析暂未完成', answer)
        self.assertIn('分析回答未通过本地校验', answer)
        self.assertNotIn('请说明具体指标和周期', answer)
        self.assertNotIn('**测试模块', answer)
        self.assertNotIn('999', answer)
        self.assertEqual(len(client.requests), 2)
        self.assertIsNone(conversation.analysis_context)

    def test_full_failure_keeps_separate_service_answer(self):
        def mutate(stage, value, payload, count):
            if stage == 'modules':
                value['modules'][0]['text'] = '报告共有999条记录。'
            return value

        conversation, client = self.conversation(), OverviewClient(mutate)
        answer = conversation.answer('整体分析这份报告，怎么退款', client, 'synthetic-model')
        self.assertIn('整体分析暂未完成', answer)
        self.assertIn('退款', answer)
        self.assertNotIn('请说明具体指标和周期', answer)
        self.assertNotIn('999', answer)
        self.assertIsNone(conversation.analysis_context)

    def test_history_failure_does_not_commit_module_context(self):
        history = SimpleNamespace(read=lambda _: [], append=lambda *_: (_ for _ in ()).throw(HistoryError('synthetic')))
        conversation = self.conversation(history=history)
        before = deepcopy((conversation.module_context, conversation.local_history, conversation.analysis_context))
        with self.assertRaises(HistoryError):
            conversation.answer('目前有哪些模块', ScriptClient([]), 'synthetic-model')
        self.assertEqual((conversation.module_context, conversation.local_history, conversation.analysis_context), before)
