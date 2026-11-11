"""客服误拦截回归：允许有依据的自然表达，同时保留身份、数字与范围边界保护。"""

from types import SimpleNamespace
import unittest

from report_assistant.conversation.analysis import AnalysisStrategy
from report_assistant.security.privacy import PrivacyError
from report_assistant.security.answer_validation import CONTACT, assertion_text, check_answer_numbers, has_identity_label
from report_assistant.security.question_guard import QuestionGuard
from scripts.customer_eval_cases import synthetic_tools
from report_assistant.security.answer_validation import duration_source_roles


class AnswerGuardRegressionTests(unittest.TestCase):
    """使用冻结评测发现的表达形态及独立合成来源，不访问真实报告或外部模型。"""

    def test_phone_business_reference_is_an_explicit_answer_only_option(self):
        for text in ('为手机号码提供通信服务的公司。', '为您的手机号提供通话服务。',
                     '这个手机号已在网至少两年。', '该手机号在网已有两年或更久。',
                     '手机号入网已有两年。', '手机号码所属的通信服务商。'):
            with self.subTest(text=text):
                self.assertTrue(has_identity_label(text))
                self.assertFalse(has_identity_label(text, allow_phone_reference=True))

    def test_source_flag_only_authorizes_non_value_phone_references(self):
        """泛称许可必须显式开启且有调用方确认的本段phone事实，不能由真假字符串触发。"""
        for text in ('这个手机号在运营商处已在网使用24个月以上。',
                     '该手机号码从运营商处已入网使用24个月以上。',
                     '这个手机号自当前运营商处已在网使用的时长至少两年。'):
            with self.subTest(text=text):
                self.assertTrue(has_identity_label(text))
                self.assertTrue(has_identity_label(text, allow_phone_reference=True))
                self.assertTrue(has_identity_label(text, phone_metric_context=True))
                self.assertTrue(has_identity_label(text, allow_phone_reference=True, phone_metric_context='True'))
                self.assertFalse(has_identity_label(text, allow_phone_reference=True, phone_metric_context=True))

    def test_source_flag_never_hides_phone_values_spelled_numbers_or_other_identity(self):
        """可信业务来源只授权泛称，前后置号码、中文逐位及姓名/证件/凭据仍独立拒绝。"""
        spelled = '一三八' + '零' * 8
        for text in ('手机号是13700000000。', '这个手机号24。', '手机号：二四。', '手机号为二四。',
                     '二四是您的手机号。', '手机号的值显示为二四。',
                     spelled + '是您的手机号。', '这个手机号在运营商处，' + spelled + '。',
                     '这个手机号在运营商处，姓名为虚构甲。', '这个手机号在运营商处，地址为虚构路。',
                     '这个手机号在运营商处，身份证信息已提供。', '这个手机号在运营商处，token=synthetic_secret。'):
            for source_flag in (False, True):
                with self.subTest(text=text, source_flag=source_flag):
                    self.assertTrue(has_identity_label(text, allow_phone_reference=True,
                                                       phone_metric_context=source_flag))
        for number in (spelled, ' '.join(spelled), '壹叁捌' + '零' * 8, '幺三八' + '洞' * 8,
                       '1三8' + '零' * 8):
            with self.subTest(number=number):
                self.assertTrue(has_identity_label(number + '是您的手机号。', allow_phone_reference=True,
                                                   phone_metric_context=True))
            with self.subTest(question=number), self.assertRaises(PrivacyError):
                QuestionGuard(synthetic_tools(display_rules=True)).question('手机号在网时长' + number)

    def test_source_aware_phone_relations_keep_the_complete_duration_boundary(self):
        """手机主体之后只消费已知业务关系词；不越过未知机构、电脑或贷款来借用数字。"""
        facts = [{'name': '手机在网时长', 'value': '24个月以上'},
                 {'name': '最近一次记录时间', 'value': '3到5年'}]
        for text in ('这个手机号在运营商处已在网使用24个月以上。',
                     '该手机号码从运营商处已入网使用的时间至少两年。',
                     '这个手机号自当前运营商处已在网使用的时长至少两年。'):
            self.assertFalse(has_identity_label(text, allow_phone_reference=True, phone_metric_context=True))
            check_answer_numbers(text, facts)
        for text in ('这个手机号在运营商处已在网使用三年以上。',
                     '这个手机号在运营商处已在网使用24个月。',
                     '这个手机号在贷款公司处已在网使用至少两年。',
                     '这个手机号在电脑处已在网使用至少两年。',
                     '这个手机号在未知机构处已在网使用至少两年。',
                     '电脑在运营商处已在网使用至少两年。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)

    def test_phone_function_words_and_range_references_do_not_become_new_subjects(self):
        """处所/指示功能词可组合，未知公司、设备、贷款仍是不可忽略的实词。"""
        facts = [{'name': '手机在网时长', 'value': '24个月以上'},
                 {'name': '最近一次记录时间', 'value': '3到5年'}]
        for relation in ('在运营商那里', '在这家运营商那边', '在运营商这边', '在其运营商处',
                         '与运营商之间', '在当前运营商方面', '从该运营商这边', '自此运营商那边'):
            text = '这个手机号' + relation + '已在网使用24个月以上。'
            check_answer_numbers(text, facts)
            with self.subTest(changed=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text.replace('24个月', '36个月'), facts)
        for text in ('这个号码在当前运营商的在网时长为24个月以上。',
                     '这份报告中的在网时间是至少24个月。', '它的在网时长为24个月以上。',
                     '这项在网时长的结果是24个月以上。',
                     '手机在网显示至少两年，24个月以上就是这个范围。',
                     '手机在网24个月以上，这个范围表示至少两年。'):
            with self.subTest(text=text):
                check_answer_numbers(text, facts)
        for text in ('这个手机号在贷款公司那里已在网24个月以上。',
                     '电脑在运营商那里已在网至少两年。',
                     '手机在网至少两年，24个月是这个范围。',
                     '手机在网至少两年，36个月以上就是这个范围。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)

    def test_phone_result_position_and_lower_bound_role_preserve_original_text(self):
        """独立语料中的前后置与下限元角色可以证明同一事实，不能靠首尾固定排列决定正确性。"""
        import json
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        ref = next(ref for ref, item in strategy.projection.fields.items()
                   if item['public']['name'] == '手机在网时长')
        fact = strategy.projection.read([ref])[0]
        for text in ('这个手机号的在网时长下限为24个月。',
                     '报告所示24个月以上，说的是这个手机号的在网时间。',
                     '至少两年，是这份报告给出的手机在网时长范围。',
                     '您看到的24个月以上，对应的是手机在网时长。',
                     '这个手机号使用了多久，报告展示的是24个月以上。',
                     '这里的两年以上，指的是这份报告中的手机在网时长。'):
            with self.subTest(text=text):
                answer = strategy._render(json.dumps({'sections': [{'text': text, 'sources': [ref]}]},
                                                     ensure_ascii=False), {ref: fact})
                self.assertEqual(answer, text)

    def test_phone_frames_cannot_borrow_other_sources_numbers_roles_or_subjects(self):
        """源key必须来自phone元数据，非phone同数字/同单位、错误主体和错误界都不能获权。"""
        phone = {'name': '手机在网时长', 'value': '24个月以上'}
        mixed = [phone, {'name': '贷款期限', 'value': '36个月以上'}, {'name': '银行申请次数', 'value': 36}]
        for text in ('24个月以上是电脑的在网时长。', '24个月以上是这笔贷款的期限。',
                     '至少两年，指的是该车辆的在网使用时间。',
                     '24个月以上，对应的是这个手机号的贷款期限。',
                     '36个月以上，是手机在网时长。', '24个月以下，是手机在网时长。',
                     '这个手机号的在网时长上限为24个月。',
                     '这个手机号的在网时长为24个月。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, mixed)
        for other in ({'name': '银行申请次数', 'value': 24},
                      {'name': '电脑在网时长', 'value': '24个月以上'},
                      {'name': '自由文本', 'value': '手机在网24个月以上'}):
            with self.subTest(other=other), self.assertRaises(PrivacyError):
                check_answer_numbers('24个月以上，是手机在网时长。', [other])
        for source in ('24个月', '24个月以下'):
            with self.subTest(source=source), self.assertRaises(PrivacyError):
                check_answer_numbers('手机在网时长下限为24个月。', [{'name': '手机在网时长', 'value': source}])
        for facts, text in (([phone, {'name': '贷款期限', 'value': '至少2年'}],
                             '贷款期限至少两年，24个月以上就是这个范围。'),
                            ([phone, {'name': '收入预测', 'value': '10万至15万'}],
                             '手机在网至少两年，收入预测10万至15万，24个月以上就是这个范围。')):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)

    def test_phone_module_bare_result_uses_the_only_actual_duration_role(self):
        """真实模块额外的运营商、查询码和隐藏字段不等于新增时长主体。"""
        facts = [{'field_ref': 'phone', 'name': '手机在网时长', 'value': '24个月以上'},
                 {'field_ref': 'isp', 'name': '手机在网运营商', 'value': '虚构运营商'},
                 {'field_ref': 'query', 'name': '查询状态', 'value': '已完成'},
                 {'field_ref': 'hidden', 'name': '受限字段', 'status': 'withheld'}]
        for text in ('24个月以上，具体时长无法确认。', '下限为24个月，具体时长无法确认。',
                     '24个月以上，无法确认精确时长。'):
            with self.subTest(text=text):
                check_answer_numbers(text, facts)
        for text in ('24个月，具体时长无法确认。', '下限为36个月，具体时长无法确认。',
                     '24个月以下，具体时长无法确认。', '电脑24个月以上，具体时长无法确认。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)

    def test_summary_role_group_inherits_only_displayed_phone_range(self):
        """ISP不透明引用可代表同小结，但不能添加小结未展示的原手机数值。"""
        original = [{'field_ref': 'phone', 'name': '手机在网时长', 'value': '24个月以上'},
                    {'field_ref': 'isp', 'name': '手机在网运营商', 'value': '虚构运营商'}]
        roles = {'isp': list(duration_source_roles(original).values())}
        for shown in ('24个月以上，具体时长无法确认。', '下限为24个月，具体时长无法确认。',
                      '手机在网时长为24个月以上，运营商显示为虚构运营商。'):
            facts = [{'field_ref': 'isp', 'value': shown}]
            check_answer_numbers('手机在网时长至少24个月。', facts, duration_roles=roles)
            for wrong in ('手机在网时长为24个月。', '手机在网时长至少36个月。'):
                with self.subTest(shown=shown, wrong=wrong), self.assertRaises(PrivacyError):
                    check_answer_numbers(wrong, facts, duration_roles=roles)
        for roles_by_ref in (roles, {}):
            with self.subTest(roles_present=bool(roles_by_ref)), self.assertRaisesRegex(PrivacyError, '未验证数字'):
                check_answer_numbers('手机在网时长至少24个月。',
                                     [{'field_ref': 'isp', 'value': '运营商显示为虚构运营商。'}],
                                     duration_roles=roles_by_ref)

    def test_summary_same_duration_key_cannot_change_the_displayed_metric(self):
        """相同24下界也须先证明小结实际展示了phone；数学key交集不足以授予角色。"""
        original = [{'field_ref': 'phone', 'name': '手机在网时长', 'value': '24个月以上'},
                    {'field_ref': 'loan', 'name': '贷款期限', 'value': '至少24个月'},
                    {'field_ref': 'isp', 'name': '手机在网运营商', 'value': '虚构运营商'}]
        roles = {'isp': list(duration_source_roles(original).values())}
        facts = [{'field_ref': 'isp', 'value': '运营商显示为虚构运营商，贷款期限至少24个月。'}]
        check_answer_numbers('贷款期限至少两年。', facts, duration_roles=roles)
        for text in ('手机在网时长至少24个月。', '24个月以上，是手机在网时长。',
                     '手机在网时长下限为24个月。'):
            with self.subTest(text=text), self.assertRaisesRegex(PrivacyError, '未验证数字'):
                check_answer_numbers(text, facts, duration_roles=roles)

    def test_summary_role_constraints_do_not_lend_loan_or_plain_count_to_phone(self):
        """混合小结保留各指标和范围，未具名时长也不能靠普通数字子集绕开角色约束。"""
        original = [{'field_ref': 'phone', 'name': '手机在网时长', 'value': '24个月以上'},
                    {'field_ref': 'loan', 'name': '贷款期限', 'value': '36个月'}]
        roles = {'summary': list(duration_source_roles(original).values())}
        facts = [{'field_ref': 'summary', 'value': '手机在网时长为24个月以上，贷款期限为36个月。'}]
        check_answer_numbers('手机在网至少两年，贷款期限为三年。', facts, duration_roles=roles)
        for text in ('手机在网至少36个月。', '贷款期限至少36个月。', '电脑在网36个月。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts, duration_roles=roles)
        for text in ('贷款期限为24个月。', '24个月以上。'):
            with self.subTest(text=text), self.assertRaisesRegex(PrivacyError, '未验证数字'):
                check_answer_numbers(text, [{'field_ref': 'summary', 'value': '申请次数为24次。'}],
                                     duration_roles=roles)

    def test_large_counts_cannot_be_borrowed_as_unparsed_phone_durations(self):
        """五位年月量须完整进入phone来源验证，大计数/金额和完整日期本身仍合法。"""
        facts = [{'name': '手机在网时长', 'value': '24个月以上'},
                 {'name': '银行申请次数', 'value': 24000},
                 {'name': '银行金额', 'value': 24000},
                 {'name': '报告日期', 'value': '2024-05-07'}]
        check_answer_numbers('银行申请次数为24000次，银行金额为24000元，报告日期2024年5月7日。', facts)
        check_answer_numbers('手机在网时长为24个月以上，银行申请次数为24000次。', facts)
        for text in ('手机在网24000个月以上。', '手机在网至少24000个月。',
                     '这个手机号已在网24000年以上。',
                     '手机在网时长为24个月以上，也就是至少24000个月。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)

    def test_phone_finite_interval_preserves_order_and_explicit_endpoint_roles(self):
        """页面12至24个月支持其上下限，不支持反向区间或把任一端点说成精确已用时长。"""
        for source in ('12-24个月', '12到24个月'):
            facts = [{'field_ref': 'phone', 'name': '手机在网时长', 'value': source},
                     {'field_ref': 'isp', 'name': '手机在网运营商', 'value': '虚构运营商'}]
            for text in ('手机在网时长为12-24个月。', '手机在网时长为12到24个月。',
                         '手机在网时长下限为12个月。', '手机在网时长上限为24个月。',
                         '手机在网时长下限为12个月，上限为24个月。', '12-24个月。'):
                with self.subTest(source=source, text=text):
                    check_answer_numbers(text, facts)
            for text in ('手机在网时长为24-12个月。', '手机在网时长为24到12个月。',
                         '手机在网时长上限为12个月。', '手机在网时长下限为24个月。',
                         '手机在网时长为12个月。', '手机在网时长为24个月。'):
                with self.subTest(source=source, text=text), self.assertRaises(PrivacyError):
                    check_answer_numbers(text, facts)

    def test_summary_phone_interval_roles_only_use_shown_endpoints(self):
        """总结保留有序区间及已展示端点，原值中未展示的另一端不能被角色元数据补写。"""
        original = [{'field_ref': 'phone', 'name': '手机在网时长', 'value': '12-24个月'},
                    {'field_ref': 'isp', 'name': '手机在网运营商', 'value': '虚构运营商'}]
        roles = {'isp': list(duration_source_roles(original).values())}
        for shown in ('手机在网时长为12-24个月。', '12-24个月。',
                      '手机在网时长下限为12个月，上限为24个月。'):
            facts = [{'field_ref': 'isp', 'value': shown}]
            for text in ('手机在网时长为12-24个月。', '手机在网时长下限为12个月。',
                         '手机在网时长上限为24个月。'):
                with self.subTest(shown=shown, text=text):
                    check_answer_numbers(text, facts, duration_roles=roles)
            for wrong in ('手机在网时长为24到12个月。', '手机在网时长上限为12个月。',
                          '手机在网时长下限为24个月。', '手机在网时长为12个月。',
                          '手机在网时长为24个月。'):
                with self.subTest(shown=shown, wrong=wrong), self.assertRaises(PrivacyError):
                    check_answer_numbers(wrong, facts, duration_roles=roles)
        shown_lower = [{'field_ref': 'isp', 'value': '手机在网时长下限为12个月。'}]
        check_answer_numbers('手机在网时长下限为12个月。', shown_lower, duration_roles=roles)
        for unshown in ('手机在网时长上限为24个月。', '手机在网时长为12-24个月。'):
            with self.subTest(unshown=unshown), self.assertRaises(PrivacyError):
                check_answer_numbers(unshown, shown_lower, duration_roles=roles)

    def test_render_derives_phone_context_from_this_section_read_sources(self):
        """集成出口以本段已读引用派生许可，其他段或银行数字不能授权手机泛称。"""
        import json
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        phone = next(ref for ref, item in strategy.projection.fields.items()
                     if item['public']['name'] == '手机在网时长')
        other = next(ref for ref, item in strategy.projection.fields.items()
                     if item['public']['name'] == '非银行其他申请次数')
        facts = {fact['field_ref']: fact for fact in strategy.projection.read([phone, other])}
        text = ('您的手机在网时长显示为“24个月以上”，通俗地说，就是这个手机号在运营商处已在网'
                '使用24个月以上，无法确认精确时长。')
        output = strategy._render(json.dumps({'sections': [{'text': text, 'sources': [phone]}]}, ensure_ascii=False), facts)
        self.assertIn('24个月以上', output)
        with self.assertRaises(PrivacyError):
            strategy._render(json.dumps({'sections': [{'text': '这个手机号24。', 'sources': [phone]}]},
                                        ensure_ascii=False), facts)
        for refs in ([other], ['not_read']):
            with self.subTest(refs=refs), self.assertRaises(PrivacyError):
                strategy._render(json.dumps({'sections': [{'text': '这个手机号从运营商处获得服务。',
                                                          'sources': refs}]}, ensure_ascii=False), facts)

    def test_phone_carrier_nouns_do_not_authorize_number_values_or_other_private_data(self):
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        for noun in ('的运营商', '的通信服务商', '所用运营商', '所属的运营商'):
            strategy._check_text('这个手机号' + noun + '显示为虚构运营商。')
            for suffix in ('，手机号是13700000000。', '，姓名为虚构甲。', '，token=synthetic_secret。'):
                with self.subTest(noun=noun, suffix=suffix), self.assertRaises(PrivacyError):
                    strategy._check_text('这个手机号' + noun + '显示为虚构运营商' + suffix)

    def test_question_entry_keeps_identity_and_credential_requests_local(self):
        guard = QuestionGuard(synthetic_tools(display_rules=True))
        guard.question('手机号在网时长和运营商是什么？')
        for text in ('我的手机号是多少？', '为我的手机号提供通信服务的是谁？',
                     '手机号在网时长，号码是13700000000。', '手机号已在网，密码abc123。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                guard.question(text)

    def test_phone_reference_option_never_hides_real_numbers_or_other_private_labels(self):
        for text in ('这个手机号已在网，号码13700000000。', '为手机号码提供服务，身份证号123。',
                     '手机号是13700000000。', '手机号为一三七零零零零零零零零。',
                     '手机号在网上公开了。',
                     '手机号已在网，姓名为虚构甲。', '手机号已在网，地址是虚构路。',
                     '手机号已在网，token=synthetic_secret。'):
            with self.subTest(text=text):
                self.assertTrue(has_identity_label(text, allow_phone_reference=True))
        guard = QuestionGuard(SimpleNamespace(private_literals=lambda: {'样例私人号码值'}))
        self.assertTrue(guard.contains_analysis_private('手机服务对应样例私人号码值。'))
        self.assertIsNotNone(CONTACT.search('手机服务13700000000已在网。'))

    def test_phone_business_grammar_covers_neutral_subjects_aspects_and_service_recipients(self):
        """同一封闭业务语法组合人称、的、已/已经及运营商网络，不对完整客户句逐条开白名单。"""
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        fact = {'name': '手机在网时长', 'value': '24个月以上'}
        neutral = ['您的手机号的在网时长为24个月以上。',
                   '这个手机号已经在网两年以上。',
                   '这个手机号已在运营商网络中使用至少两年。',
                   '该手机号码已经在运营商网络内使用至少两年。',
                   '运营商已为这个手机号提供通信服务至少两年。',
                   '运营商已经为您的手机号码提供网络服务至少两年。',
                   '运营商已为这个手机号提供通话、短信和上网服务至少两年。',
                   '您的手机在网时长显示为“24个月以上”，通俗地说，就是这个手机号已在运营商网络中使用至少两年；无法确认具体用了多久。']
        for text in neutral:
            with self.subTest(text=text):
                strategy._check_text(text)
                check_answer_numbers(text, [fact])
        guard = QuestionGuard(synthetic_tools(display_rules=True))
        with self.assertRaises(PrivacyError):
            guard.question('为这个手机号提供通信服务的是谁？')
        for text in ('手机号是13700000000。', '手机号已经在网上公开。',
                     '运营商已为这个手机号提供通信服务，号码13700000000。',
                     '这个手机号已在运营商网络中，姓名是虚构甲。',
                     '这个手机号已在运营商网络中，地址是虚构路。',
                     '运营商已为这个手机号提供通信服务，token=synthetic_secret。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                strategy._check_text(text)

    def test_duration_predicate_combinations_preserve_the_same_verified_range(self):
        """覆盖时态、助词和名词化的组合，独立核对范围，不只复现单句的“了”。"""
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        facts = [{'name': '手机在网时长', 'value': '24个月以上'}]
        forms = (
            ('手机在网时长', ('为', '显示为', '目前已经有', '当前已有', '现在已经达到', '已达到', '已经达到了')),
            ('这个手机号已在运营商网络中', ('使用', '使用了', '已经使用了', '已用了', '持续了', '已经持续了')),
            ('该手机号在网的使用时间', ('为', '显示为', '目前已经有')),
            ('运营商已为这个手机号提供通信服务', ('', '已有', '已经持续了')),
        )
        for context, predicates in forms:
            for predicate in predicates:
                for bound in ('至少两年', '至少2年', '两年以上', '2年或更久'):
                    text = context + predicate + bound + '。'
                    with self.subTest(text=text):
                        strategy._check_text(text)
                        check_answer_numbers(text, facts)
                    changed = text.replace('两年', '三年').replace('2年', '3年')
                    with self.subTest(changed=changed), self.assertRaises(PrivacyError):
                        check_answer_numbers(changed, facts)
        text = ('您的手机在网时长显示为“24个月以上”，通俗说就是这个手机号已在运营商网络中'
                '使用了至少两年，不是指每天上网用了多久。')
        strategy._check_text(text)
        check_answer_numbers(text, facts)

    def test_phone_account_usage_alias_does_not_become_device_age_or_number_access(self):
        """账户名必须带号/号码并紧接使用谓语；不把手机设备寿命或号码取值当作在网结果。"""
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        facts = [{'name': '手机在网时长', 'value': '24个月以上'}]
        for subject in ('这个手机号', '您的手机号码'):
            for predicate in ('已使用', '已经使用了', '目前已用了', '的使用时长为', '使用时间显示为'):
                text = '手机在网时长显示为24个月以上，也就是' + subject + predicate + '至少两年。'
                with self.subTest(text=text):
                    strategy._check_text(text)
                    check_answer_numbers(text, facts)
                with self.subTest(changed=text), self.assertRaises(PrivacyError):
                    check_answer_numbers(text.replace('至少两年', '至少三年'), facts)
                with self.subTest(exact=text), self.assertRaises(PrivacyError):
                    check_answer_numbers(text.replace('至少两年', '两年'), facts)
        for text in ('手机已使用至少两年。', '电脑已使用至少两年。',
                     '手机在网24个月以上；贷款已使用至少两年。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)
        for text in ('手机号是13700000000。', '手机号用户信息已提供。', '这个手机号已使用至少两年，姓名为虚构甲。',
                     '手机号码使用时长至少两年，号码是13700000000。',
                     '这个手机号已使用至少两年，token=synthetic_secret。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                strategy._check_text(text)
        with self.assertRaises(PrivacyError):
            QuestionGuard(synthetic_tools(display_rules=True)).question('这个手机号已经使用多久？')

    def test_phone_usage_time_nouns_are_consumed_in_closed_business_order(self):
        """网络/账户业务与使用、的、时间名词可组合；不能穿过未知实词或借给设备年限。"""
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        facts = [{'name': '手机在网时长', 'value': '24个月以上'}]
        for subject in ('这个手机号入网', '您的手机在网', '在网'):
            for metric in ('使用的时间', '的使用时长', '使用时间', '的时间'):
                text = subject + metric + '已达到24个月或更久。'
                with self.subTest(text=text):
                    strategy._check_text(text)
                    check_answer_numbers(text, facts)
                with self.subTest(changed=text), self.assertRaises(PrivacyError):
                    check_answer_numbers(text.replace('24个月', '36个月'), facts)
        for subject in ('这个手机号', '您的手机号码'):
            text = subject + '使用的时间至少两年。'
            strategy._check_text(text)
            check_answer_numbers(text, facts)
        text = ('您的手机在网时长显示为“24个月以上”，通俗说，就是这个手机号入网使用的时间'
                '已达到24个月或更久，无法确认精确时长。')
        strategy._check_text(text)
        check_answer_numbers(text, facts)
        for text in ('电脑入网使用的时间至少两年。', '手机使用的时间至少两年。',
                     '这个手机号入网注销的时间至少两年。', '这个手机号入网工作稳定的时间至少两年。',
                     '这个手机号入网使用的时间两年。', '这个手机号入网使用的时间已达到三年以上。',
                     '手机在网24个月以上，贷款使用的时间至少两年。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)
        with self.assertRaises(PrivacyError):
            strategy._check_text('这个手机号使用的时间至少两年，号码13700000000。')

    def test_omitted_subject_explanation_verbs_preserve_the_same_network_bound(self):
        """表示/意味着/说明是省略主语的解释连接，不能借此改三年或引入电脑主体。"""
        facts = [{'name': '手机在网时长', 'value': '24个月以上'}]
        for connector in ('表示', '意味着', '说明'):
            text = '您的手机在网时长为24个月以上，' + connector + '已在网至少24个月，具体时长无法确认。'
            check_answer_numbers(text, facts)
            check_answer_numbers('手机在网24个月以上，' + connector + '在网至少两年。', facts)
            for tail in ('电脑已在网至少两年。', '已在网至少三年。', '贷款已使用至少两年。'):
                with self.subTest(connector=connector, tail=tail), self.assertRaises(PrivacyError):
                    check_answer_numbers('手机在网24个月以上，' + connector + tail, facts)

    def test_lower_bound_before_network_metric_keeps_its_original_scope(self):
        """“至少已在网两年”与“已在网至少两年”下界相同，不把三年或其他主体归一化放行。"""
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        facts = [{'name': '手机在网时长', 'value': '24个月以上'}]
        for text in ('您的手机在网时长显示为24个月以上，也就是至少已在网两年。',
                     '您的手机在网时长为24个月以上，至少已经在网两年。'):
            with self.subTest(text=text):
                strategy._check_text(text)
                check_answer_numbers(text, facts)
        for text in ('手机至少已在网三年。', '电脑至少已在网两年。', '手机至多已在网两年。',
                     '手机在网24个月以上，也就是至少已在网两年；贷款至少已在网两年。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)
        check_answer_numbers('手机在网24个月以上。',
                             [{'name': '手机在网时长', 'value': '手机至少已在网两年。'}])

    def test_account_activation_full_years_is_a_lower_bound_not_exact_age(self):
        """满表示已经达到该下界；未满/不满与裸两年不得继承这个下界授权。"""
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        facts = [{'name': '手机在网时长', 'value': '24个月以上'}]
        texts = ('您的手机在网时长显示为“24个月以上”，通俗说，就是这个手机号开通使用已满两年，具体用了多久无法确认。',
                 '这个手机号开通使用已经满2年。', '这个手机号开通使用满两年。')
        for text in texts:
            with self.subTest(text=text):
                strategy._check_text(text)
                check_answer_numbers(text, facts)
        for text in ('这个手机号开通使用已满三年。', '这个手机号开通使用两年。',
                     '这个手机号开通使用未满两年。', '手机在网不满24个月。',
                     '电脑开通使用已满两年。', '手机开通使用已满两年。',
                     '手机在网24个月以上，贷款开通使用已满两年。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)
        for source in ('未满24个月', '不满24个月', '尚未满24个月'):
            with self.subTest(source=source), self.assertRaises(PrivacyError):
                check_answer_numbers('这个手机号开通使用已满两年。', [{'name': '手机在网时长', 'value': source}])
        for text in ('手机号是13700000000。', '这个手机号开通使用已满两年，姓名为虚构甲。',
                     '这个手机号开通使用已满两年，token=synthetic_secret。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                strategy._check_text(text)

    def test_duration_actions_do_not_supply_missing_boundaries_or_another_metric(self):
        facts = [{'name': '手机在网时长', 'value': '24个月以上'}, {'name': '机构数', 'value': 3}]
        for predicate in ('使用', '使用了', '已经使用了', '已有', '持续了', '已经持续了', '达到了'):
            with self.subTest(predicate=predicate), self.assertRaises(PrivacyError):
                check_answer_numbers('手机在网' + predicate + '两年。', facts)
        for text in ('手机在网使用了至少两年；贷款已经持续了至少两年。',
                     '手机在网已达到至少两年，案件已经持续了至少三年。',
                     '运营商已为这个手机号提供通信服务至少两年，贷款已经有了至少两年。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)

    def test_duration_cannot_borrow_another_subject_or_another_range_endpoint(self):
        facts = [{'name': '手机在网时长', 'status': 'provided', 'value': '24个月以上'},
                 {'name': '最近一次记录时间', 'status': 'provided', 'value': '3到5年'}]
        for text in ('手机在网至少2年到3年。', '手机在网至少两年到三年。',
                     '电脑在网已使用了至少两年。', '车辆在网已经使用了至少2年。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)
        for text in ('在网已使用了至少两年。', '手机在网已使用了至少两年。',
                     '手机在网时长为24个月以上，也就是在网两年及以上。',
                     '该手机号的在网时长显示为24个月以上；最近一次记录时间为3到5年。'):
            with self.subTest(text=text):
                check_answer_numbers(text, facts)

    def test_duration_discourse_prefixes_preserve_ellipsis_but_cannot_cross_subjects(self):
        """话语连接不是新主体；只允许封闭连接，不能越过电脑、贷款等实质名词。"""
        facts = [{'name': '手机在网时长', 'value': '24个月以上'}]
        for prefix in ('通俗地说', '通俗说', '简单来说', '也就是说', '这表示', '可理解为',
                       '可以理解为', '换句话说', '相当于'):
            for body in ('在网时长至少两年。', '在网至少2年。', '在网已使用了至少两年。'):
                with self.subTest(prefix=prefix, body=body):
                    check_answer_numbers(prefix + body, facts)
                with self.subTest(other_subject=prefix + '电脑' + body), self.assertRaises(PrivacyError):
                    check_answer_numbers(prefix + '电脑' + body, facts)
            check_answer_numbers('手机在网24个月以上，' + prefix + '至少两年。', facts)
            with self.subTest(new_topic=prefix), self.assertRaises(PrivacyError):
                check_answer_numbers('手机在网24个月以上，' + prefix + '贷款期限至少两年。', facts)
    def test_numbered_multi_metric_answer_does_not_treat_ordinals_as_facts(self):
        facts = [{'name': '非银行申请次数', 'window': '近6月', 'status': 'missing'},
                 {'name': '银行申请次数', 'window': '近1月', 'value': 2},
                 {'name': '非银行申请机构数', 'window': '近1月', 'value': 3}]
        check_answer_numbers('1. 过去六个月次数暂未提供。\n2. 银行近一个月为2次。\n'
                             '3. 非银行近一个月涉及3家机构。', facts)
        check_answer_numbers('1. 余额1000至2000元。\n2. 近6月次数未提供。',
                             [{'value': '1000至2000元'}, {'window': '近6月', 'status': 'missing'}])
        check_answer_numbers('1. 次数为8次。\n2. 机构数为3家。', [{'value': 8}, {'value': 3}])

    def test_list_formatting_cannot_hide_amounts_standalone_numbers_or_fake_counts(self):
        for text in ('1.5万元。', '2. 8次。\n3. 8次。', '1. 8次。',
                     '1. 999次。\n2. 8次。', '1.\n2.', '1. 8次，金额999元。\n2. 8次。',
                     '1. 次\n2. 次', '1. 万元余额\n2. 万元余额', '1. %\n2. %'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, [{'value': 8}])

    def test_same_window_anaphora_and_parenthetical_equivalents_are_allowed(self):
        facts = [{'name': '申请次数', 'window': '近7天', 'value': 0}]
        for text in ('这7天申请0次。', '近一周（7天）的申请次数为0次。',
                     '该7天的申请次数为0次。', '最近一周（近7天）为0次。'):
            with self.subTest(text=text):
                check_answer_numbers(text, facts)
        check_answer_numbers('近半年（6个月）的申请次数未提供。',
                             [{'name': '申请次数', 'window': '近6月', 'status': 'missing'}])

    def test_window_restatement_does_not_authorize_new_counts_or_cross_periods(self):
        facts = [{'name': '申请次数', 'window': '近7天', 'value': 0}]
        for text in ('这8天申请0次。', '近一周（8天）申请0次。',
                     '近一周（7天）申请7次。', '近2周（14天）申请0次。', '这7天申请7次。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)
        with self.assertRaises(PrivacyError):
            check_answer_numbers('这7天申请0次。', [{'value': 7}, {'value': 0}])

    def test_cycle_noun_does_not_invent_a_week_window(self):
        facts = [{'name': '申请次数', 'window': '近1月', 'value': 8}]
        for text in ('您近1个月申请8次，指这一周期内的申请次数。',
                     '近1个月申请8次，该一周期的次数为8。'):
            with self.subTest(text=text):
                check_answer_numbers(text, facts)
        with self.assertRaises(PrivacyError):
            check_answer_numbers('您近1个月申请8次，这一周也申请8次。', facts)

    def test_year_grade_and_calendar_nouns_are_not_duration_units(self):
        """“年级/年度/年份”中的年不是时长，不得误套在网边界或补出滚动周期。"""
        facts = [{'name': '学历', 'value': '小学三年级'},
                 {'name': '报告年份', 'value': '2024年度'},
                 {'name': '手机在网时长', 'value': '24个月以上'},
                 {'name': '申请次数', 'window': '近1月', 'value': 8}]
        check_answer_numbers('学历显示为小学三年级，报告年份为2024年度，手机在网至少两年。', facts)
        check_answer_numbers('近1个月申请8次，这一年度的具体情况无法确认。', facts)
        check_answer_numbers('学历记录显示二至三年级。', [{'name': '学历', 'value': '二至三年级'}])
        check_answer_numbers('学历为二年级。', [{'name': '学历', 'value': '二年级'}])
        with self.assertRaises(PrivacyError):
            check_answer_numbers('学历为两年。', [{'name': '学历', 'value': '二年级'}])

    def test_same_lower_bound_can_change_between_whole_months_and_years(self):
        facts = [{'name': '手机在网时长', 'value': '24个月以上'}]
        for text in ('手机在网至少2年。', '在网24个月以上，也就是至少2年。',
                     '手机在网至少两年。', '手机在网2年以上。', '手机在网已有两年或更久。'):
            with self.subTest(text=text):
                check_answer_numbers(text, facts)
        check_answer_numbers('手机在网24个月以上。', [{'name': '手机在网时长', 'value': '至少2年'}])
        check_answer_numbers('手机在网至多2年。', [{'name': '手机在网时长', 'value': '24个月以下'}])

    def test_duration_conversion_preserves_boundary_and_does_not_authorize_other_units(self):
        facts = [{'name': '手机在网时长', 'value': '24个月以上'}]
        for text in ('手机在网恰好2年。', '手机在网恰好两年。', '手机在网24个月。',
                     '手机在网至多2年。', '手机在网至少3年。', '手机在网至少二十五年。',
                     '手机在网至少730天。',
                     '手机在网至少2年，申请2次。', '手机在网至少2年，金额2万元。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)
        with self.assertRaises(PrivacyError):
            check_answer_numbers('手机在网至少2年。', [{'name': '手机在网时长', 'value': 24}])

    def test_duration_conversion_is_bound_to_the_same_metric_in_customer_output(self):
        """在网时长可解释为整年，不能给同段新增的贷款期限、还款或案件时长提供数字依据。"""
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        ref = next(ref for ref, item in strategy.projection.fields.items()
                   if item['public']['name'] == '手机在网时长')
        fact = strategy.projection.read([ref])[0]

        def render(text):
            import json
            return strategy._render(json.dumps({'sections': [{'text': text, 'sources': [ref]}]},
                                              ensure_ascii=False), {ref: fact})

        for text in ('手机在网时长至少2年。', '手机在网时长显示为24个月以上，也就是至少2年。',
                     '手机在网时长显示为“24个月以上”，即至少2年。'):
            with self.subTest(text=text):
                self.assertIn('2年', render(text))
        for text in ('手机在网时长显示为24个月以上；贷款期限至少2年。',
                     '手机在网时长显示为24个月以上，贷款期限至少2年。',
                     '手机在网时长24个月以上贷款期限至少2年。',
                     '手机在网时长24个月以上，也就是贷款期限至少2年。',
                     '手机在网时长24个月以上，案件持续至少2年。',
                     '手机在网时长24个月以上；也就是至少2年。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                render(text)

    def test_chinese_duration_cannot_escape_as_unparsed_or_cross_metric_numbers(self):
        facts = [{'name': '手机在网时长', 'value': '24个月以上'},
                 {'name': '贷款期限', 'value': '至少3年'}, {'name': '机构数', 'value': 3}]
        check_answer_numbers('手机在网至少两年，贷款期限至少三年。', facts)
        for text in ('手机在网至少三年。', '手机在网时长24个月以上，也就是至少三年。',
                     '手机在网至少二十五年。', '手机在网至少两年，案件持续至少三年。',
                     '手机在网半年。', '手机在网至少两年半。', '手机在网至少2年6个月。',
                     '手机在网三到五年。', '手机在网至少2年到三年。',
                     '手机在网时长24个月以上；贷款期限至少两年。',
                     '这个手机号已在运营商网络中使用至少三年。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)
        with self.assertRaises(PrivacyError):
            check_answer_numbers('贷款期限至少三年。', [{'name': '机构数', 'value': 3}])

    def test_duration_scope_preserves_dates_and_other_genuine_duration_sources(self):
        facts = [{'name': '手机在网时长', 'value': '24个月以上'},
                 {'name': '贷款期限', 'value': '至少3年'},
                 {'name': '报告日期', 'value': '2024-05-07'}]
        check_answer_numbers('报告日期2024年5月7日，手机在网至少两年；贷款期限至少三年。', facts)
        with self.assertRaises(PrivacyError):
            check_answer_numbers('报告日期2024年7月5日，手机在网至少两年。', facts)

    def test_duration_label_colon_keeps_the_same_verified_lower_bound(self):
        """模型常用“标签：结果”说明，不应使紧邻的同指标等价换算丢失来源。"""
        facts = [{'name': '手机在网时长', 'value': '24个月以上'}]
        for text in ('手机在网时长：24个月以上，也就是至少2年。',
                     '手机在网时长:至少2年。'):
            with self.subTest(text=text):
                check_answer_numbers(text, facts)
        with self.assertRaises(PrivacyError):
            check_answer_numbers('手机在网时长：24个月以上，贷款期限：至少2年。', facts)

    def test_unknown_period_denial_is_not_treated_as_a_report_fact(self):
        facts = [{'name': '银行申请机构数', 'window': '近1月', 'value': 1}]
        check_answer_numbers('近1月为1家，未单独提供最近30天的数据，不能直接按30天确认。', facts)
        for text in ('未单独提供最近30天的数据，不能直接按30天确认，但实际为30次。',
                     '未单独提供最近45天的数据，不能直接按45天确认。',
                     '近1月为1家，按30天确认申请30次。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)

    def test_new_normalizations_keep_date_percentage_and_unknown_number_guards(self):
        facts = [{'value': '2024-05-07'}, {'value': '32%'}, {'value': -19}]
        check_answer_numbers('日期2024年5月7日，比例32%，变动-19元。', facts)
        for text in ('日期2024年7月5日。', '比例31%。', '变动19元。', '金额999元。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                check_answer_numbers(text, facts)

    def test_negated_prior_history_does_not_become_a_positive_guarantee(self):
        for modifier in ('此前', '以往', '您以前', '你以前'):
            with self.subTest(modifier=modifier):
                text = '近7天0次，不代表' + modifier + '从未申请过。'
                self.assertNotRegex(assertion_text(text), r'从未申请')
        self.assertNotIn('无逾期', assertion_text('暂未提供，不代表此前无逾期记录。'))

    def test_negation_scope_never_erases_a_later_positive_or_double_negative(self):
        for text in ('不代表此前从未申请过，但您从未申请过。',
                     '不代表以往无风险；这份报告无风险。',
                     '不代表您以前无逾期记录，然而现在无逾期记录。',
                     '不能不代表此前从未申请过。', '并非不代表无风险。'):
            with self.subTest(text=text):
                self.assertRegex(assertion_text(text), r'从未申请|无风险|无逾期')


if __name__ == '__main__':
    unittest.main()
