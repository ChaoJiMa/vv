"""跨轮模块指代与失败预览上限：只用虚构目录，不读取真实报告或模型配置。"""

from unittest.mock import patch

from report_assistant.conversation.module_selection import ModuleSelection, select_modules, selected_module_fallback
from report_assistant.conversation.session import Conversation
from support.overview import overview_tools
from support.privacy import NoExternalIO


class ModuleReferenceTests(NoExternalIO):
    """指代必须绑定已提交的本地模块ID，且重新按当前目录顺序解释。"""

    def test_complete_reference_wording_uses_only_prior_selected_modules(self):
        tools = overview_tools(count=10)
        for question in ('给我分析下这些模块', '解读上述模块', '请总结刚才列出的模块',
                         '这些模块怎么样', '上面列出的模块呢', '把这些模块分析一下'):
            with self.subTest(question=question):
                result = select_modules(question, tools, (22, 20, 21))
                self.assertTrue(result.matched)
                self.assertEqual(result.module_ids, (20, 21, 22))
                self.assertEqual(result.error, '')

    def test_missing_stale_or_forged_reference_clarifies_without_scope_expansion(self):
        tools = overview_tools(count=10)
        for previous in (None, (), (999,), (20, 20), ({'id': 20},), (True,), (20, 21, 999)):
            with self.subTest(previous_type=type(previous).__name__):
                result = select_modules('给我分析下这些模块', tools, previous)
                self.assertTrue(result.matched)
                self.assertFalse(result.module_ids)
                self.assertIn('可确定的模块范围', result.error)
        changed = select_modules('解读上述模块', overview_tools(count=2), (20, 21, 22))
        self.assertTrue(changed.error)

    def test_reference_plus_closed_service_keeps_remaining_question(self):
        result = select_modules('分析这些模块，怎么退款', overview_tools(count=10), (21, 22))
        self.assertEqual(result.module_ids, (21, 22))
        self.assertEqual(result.remainder, '怎么退款')

    def test_unclosed_reference_does_not_discard_other_report_requests(self):
        result = select_modules('分析这些模块和评分', overview_tools(count=10), (20, 21))
        self.assertTrue(result.matched)
        self.assertFalse(result.module_ids)
        self.assertTrue(result.error)

    def test_failure_preview_is_bounded_and_marks_unshown_scope(self):
        tools = overview_tools(count=10)
        projection = Conversation(tools, strategy='analysis', allow_personal=True).analysis.projection
        selection = ModuleSelection(tuple(module['module_id'] for module in tools.current_modules()), True)
        with patch.object(tools, 'get_current_order_data', wraps=tools.get_current_order_data) as read:
            answer = selected_module_fallback(tools, projection, selection)
        for letter in 'ABCDEFGH':
            self.assertIn('**测试模块' + letter + '**', answer)
        for letter in 'IJ':
            self.assertNotIn('**测试模块' + letter + '**', answer)
        self.assertIn('先预览前8个所选模块，每个最多3项', answer)
        self.assertIn('其余2个所选模块本次未展示', answer)
        self.assertIn('不代表它们没有数据', answer)
        paths = {path for call in read.call_args_list for path in call.args[0]}
        self.assertTrue(paths)
        self.assertTrue(all('item_8_' not in path and 'item_9_' not in path for path in paths))
