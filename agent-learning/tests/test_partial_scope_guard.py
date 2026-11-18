"""局部模块总结范围回归：拒绝未选模块和全报告目录断言，保留边界说明。"""

from report_assistant.conversation.overview import OverviewValidationError, ReportOverview
from report_assistant.conversation.session import Conversation
from report_assistant.security.privacy import PrivacyError
from support.overview import OverviewClient, overview_tools
from support.privacy import NoExternalIO


class PartialScopeGuardTests(NoExternalIO):
    """仅使用虚构模块与脚本模型，不访问真实报告、模型服务或本地配置。"""

    @staticmethod
    def scope(partial=True, stage='summary'):
        """构造三项已选、十项实际目录的范围元信息，单独检验范围语义。"""
        value = {'stage': stage, 'module_count': 3, 'confirmed_module_count': 3}
        if partial:
            value.update(is_partial=True, report_module_count=10)
        return value

    def test_partial_summary_rejects_unselected_module_availability(self):
        for statement in ('其他模块没有数据。', '其余模块已有结果。', '未选模块的记录缺失。',
                          '剩余模块可用。', '别的模块有记录。', '未分析其他模块也有数据。'):
            with self.subTest(statement=statement):
                with self.assertRaises(PrivacyError):
                    ReportOverview._check_scope(statement, self.scope())

    def test_partial_summary_rejects_whole_report_module_count(self):
        for statement in ('报告共有3个模块。', '这份报告包含三个模块。', '当前报告有10个栏目。',
                          '报告一共有十个模块。', '报告共计10个栏目。',
                          '综合来看，报告分为十个模块。'):
            with self.subTest(statement=statement):
                with self.assertRaises(PrivacyError):
                    ReportOverview._check_scope(statement, self.scope())

    def test_boundary_and_selected_scope_remain_usable(self):
        for statement in ('本次未分析其他模块。', '其他模块未分析。', '未分析其他模块的结果。',
                          '未分析整份报告。', '整份报告尚未分析。', '不对整份报告作判断。',
                          '整份报告没有进行总结。', '所选三个模块均有申请信息。',
                          '仅总结所选模块。'):
            with self.subTest(statement=statement):
                ReportOverview._check_scope(statement, self.scope())

    def test_boundary_cannot_excuse_a_following_whole_report_claim(self):
        with self.assertRaises(PrivacyError):
            ReportOverview._check_scope('未分析整份报告，但整份报告没有数据。', self.scope())

    def test_full_report_scope_keeps_existing_behavior(self):
        """仅局部模式新增约束；同一文字在原全报告总结中沿用旧校验结果。"""
        for statement in ('其他模块没有数据。', '报告共有3个模块。'):
            with self.subTest(statement=statement):
                ReportOverview._check_scope(statement, self.scope(partial=False))

    def test_unselected_claim_from_model_is_rejected_before_customer_display(self):
        """真正会话路径不应把模型对未读模块的猜测当作局部总结展示。"""
        def mutate(stage, value, payload, count):
            if stage == 'summary':
                value['text'] = '其他模块没有数据。'
            return value

        conversation = Conversation(overview_tools(count=10), strategy='analysis', allow_personal=True)
        client = OverviewClient(mutate)
        answer = conversation.answer('分析前三个模块', client, 'synthetic-model')
        self.assertIn('分析暂未完成', answer)
        self.assertNotIn('整体总结', answer)
        self.assertNotIn('其他模块没有数据', answer)
        self.assertNotIn('测试模块D', answer)
        self.assertEqual(len(client.requests), 2)
        self.assertIsNone(conversation.analysis_context)

    def test_full_report_failure_diagnostic_keeps_original_stage_label(self):
        """错误阶段标签只随局部范围改变，不影响已有整份报告诊断。"""
        error = PrivacyError('总结的模块范围与报告不一致。')
        self.assertIn('整体总结：', str(OverviewValidationError(error, 'summary')))
        self.assertIn('所选模块总结：', str(OverviewValidationError(error, 'summary', partial=True)))
