"""当前入口个人资料授权回归：虚构资料可解读，凭据、报告权限与来源检查仍生效。"""

from contextlib import redirect_stdout
import io
import json

import main
from report_assistant.conversation.session import Conversation
from report_assistant.conversation.analysis import AnalysisStrategy
from report_assistant.conversation.targets import QuestionTargets
from report_assistant.reports.tools import LocalReportTools
from report_assistant.security.privacy import PrivacyError
from support import analysis as script
from support import privacy
from support.overview import OverviewClient


def personal_tools(*, phone_metrics=False):
    """为当前已启用模块登记四类虚构个人资料及不可外发的凭据字段。"""
    order, catalog = privacy.fixtures(61.25)
    order['report_data']['report']['person'] = {
        'name': '虚构张三', 'idcard': '110101199001011234',
        'mobile': '13800000000', 'address': '虚构城市幸福路九号',
        'token': 'SYNTHETIC_CREDENTIAL_88242',
    }
    for label, key in (('姓名', 'name'), ('身份证号', 'idcard'), ('手机号', 'mobile'),
                       ('地址', 'address'), ('登录token', 'token')):
        catalog['fields'].append({'module_id': 5, 'module_name': '测试指数模块',
                                  'name': label, 'path': 'report.person.' + key,
                                  'window': '', 'frontend_processing': '直接输出原值'})
    if phone_metrics:
        order['report_data']['report']['phone_duration'] = '1年以上'
        catalog['fields'].append({'module_id': 5, 'module_name': '测试指数模块',
                                  'name': '手机在网时长', 'path': 'report.phone_duration',
                                  'window': '', 'frontend_processing': '直接输出原值'})
    return LocalReportTools(order, catalog)


class PersonalDataAuthorizationTests(privacy.NoExternalIO):
    """固定模型脚本只验证本地数据流；不读取.env、不读取真实报告、不发网络请求。"""

    def conversation(self):
        return Conversation(personal_tools(), strategy='analysis', allow_personal=True)

    def target_names(self, question, *, phone_metrics=False):
        strategy = AnalysisStrategy(personal_tools(phone_metrics=phone_metrics), allow_personal=True)
        targets = QuestionTargets(question, strategy.tools, strategy.projection)
        return [strategy.projection.fields[ref]['public']['name'] for ref in targets.report_refs]

    def test_phone_business_questions_do_not_force_read_actual_phone_numbers(self):
        for question in ('手机号码在网时长是多少？', '手机号的在网时长是什么？'):
            with self.subTest(question=question):
                names = self.target_names(question, phone_metrics=True)
                self.assertIn('手机在网时长', names)
                self.assertNotIn('手机号', names)
        names = self.target_names('手机号和手机在网时长分别是什么？', phone_metrics=True)
        self.assertIn('手机号', names)
        self.assertIn('手机在网时长', names)

    def test_stated_identity_is_not_an_additional_query_target(self):
        names = self.target_names('我的姓名是虚构张三，帮我查近7天非银行申请次数')
        self.assertNotIn('姓名', names)
        self.assertIn('非银行申请次数', names)
        self.assertIn('姓名', self.target_names('姓名是什么？'))

    def test_conversational_exclusion_does_not_force_read_personal_fields(self):
        for question in ('我的姓名和身份证不要再说了，近7天非银行申请次数是多少',
                         '姓名和身份证不需要，查近7天非银行申请次数'):
            with self.subTest(question=question):
                names = self.target_names(question)
                self.assertNotIn('姓名', names)
                self.assertNotIn('身份证号', names)
                self.assertIn('非银行申请次数', names)

    def test_inline_unknown_credentials_are_removed_before_payload_validation(self):
        guard = self.conversation().analysis.guard
        for value in ('密码是SYNTHETIC_INLINE_64321', 'token为SYNTHETIC_INLINE_64321',
                      'Authorization: Bearer SYNTHETIC_INLINE_64321'):
            with self.subTest(kind=value.split('SYNTHETIC')[0]):
                redacted = guard.redact({'说明': value})
                self.assertNotIn('SYNTHETIC_INLINE_64321', json.dumps(redacted))
                guard.check_payload(redacted)
                with self.assertRaises(PrivacyError):
                    guard.check_payload({'说明': value})

    def test_module_listing_does_not_reintroduce_the_removed_identity_restriction(self):
        conversation = self.conversation()
        client = self.client(conversation, ['姓名'], '报告中的姓名是虚构张三。')
        client.script.insert(1, script.call('list_report_modules', {}, 'module_lookup'))
        answer = conversation.answer('姓名是什么？', client, 'synthetic-model')
        self.assertIn('虚构张三', answer)
        self.assertNotIn('改用本地', answer)
        wire = json.dumps(client.requests, ensure_ascii=False)
        self.assertFalse('姓名、证件、手机号、地址及凭据留在本地' in wire)
        self.assertIn('包含个人资料', wire)

    def test_phone_metric_turn_finishes_without_number_source_or_extra_reply(self):
        conversation = Conversation(personal_tools(phone_metrics=True), strategy='analysis', allow_personal=True)
        client = self.client(conversation, ['手机在网时长'], '您的手机在网时长为1年以上。')
        answer = conversation.answer('手机号的在网时长是什么？', client, 'synthetic-model')
        self.assertIn('1年以上', answer)
        self.assertNotIn('13800000000', answer)
        self.assertNotIn('改用本地', answer)
        self.assertEqual(len(conversation.analysis_context.field_refs), 1)
        self.assertEqual(len(client.requests), 4)

    def test_stated_and_excluded_identity_turns_do_not_force_extra_fact_reads(self):
        for question in ('我的姓名是虚构张三，帮我查近7天非银行申请次数',
                         '我的姓名和身份证不要再说了，近7天非银行申请次数是多少'):
            with self.subTest(question=question):
                conversation = self.conversation()
                ref = next(ref for ref, item in conversation.analysis.projection.fields.items()
                           if item['public']['name'] == '非银行申请次数' and item['public']['window'] == '近7天')
                client = script.ScriptClient([script.route(), script.call('list_report_fields', {'module_ref': 'all', 'offset': 0}),
                                              script.call('read_report_facts', {'field_refs': [ref]}, 'c2'),
                                              script.final('近7天非银行申请次数为0次。', [ref])])
                answer = conversation.answer(question, client, 'synthetic-model')
                self.assertIn('0次', answer)
                self.assertNotIn('虚构张三', answer)
                self.assertNotIn('110101199001011234', answer)
                self.assertNotIn('改用本地', answer)
                self.assertEqual(conversation.analysis_context.field_refs, (ref,))
                self.assertEqual(len(client.requests), 4)

    def client(self, conversation, labels, draft, identity_route=False):
        refs = [ref for ref, item in conversation.analysis.projection.fields.items()
                if item['public']['name'] in labels]
        route = script.response(json.dumps({'route': 'service', 'use_previous': False, 'topic': 'identity'})) if identity_route else script.route()
        return script.ScriptClient([route, script.call('list_report_fields', {'module_ref': 'all', 'offset': 0}),
                                    script.call('read_report_facts', {'field_refs': refs}, 'c2'), script.final(draft, refs)])

    def test_cli_explicitly_enables_personal_data_but_legacy_constructor_stays_compatible(self):
        with redirect_stdout(io.StringIO()):
            conversation = main.new_conversation(personal_tools())
        self.assertTrue(conversation.analysis.guard.allow_personal)
        self.assertFalse(AnalysisStrategy(personal_tools()).guard.allow_personal)

    def test_four_personal_fields_and_actual_values_are_queryable(self):
        for label, value in (('姓名', '虚构张三'), ('身份证号', '110101199001011234'),
                             ('手机号', '13800000000'), ('地址', '虚构城市幸福路九号')):
            with self.subTest(field=label):
                conversation = self.conversation()
                client = self.client(conversation, [label], f'报告中的{label}是{value}。', identity_route=True)
                answer = conversation.answer(f'报告中的{label}是什么？', client, 'synthetic-model')
                self.assertIn(value, answer)
                self.assertNotIn('改用本地', answer)
                self.assertNotIn('不会通过外部AI', answer)
                self.assertEqual(len(client.requests), 4)
                wire = json.dumps(client.requests, ensure_ascii=False)
                self.assertIn(value, wire)
                self.assertNotIn('SYNTHETIC_CREDENTIAL_88242', wire)

    def test_personal_and_ordinary_questions_are_answered_together(self):
        conversation = self.conversation()
        client = self.client(conversation, ['姓名', '分析指数'], '报告中的姓名是虚构张三，分析指数显示61.25。')
        answer = conversation.answer('姓名是虚构张三，帮我查姓名和报告分数', client, 'synthetic-model')
        self.assertIn('虚构张三', answer)
        self.assertIn('61.25', answer)
        self.assertNotIn('留在本地', answer)
        self.assertNotIn('改用本地', answer)
        self.assertIn('虚构张三', conversation.analysis_context.question)

    def test_generic_exclusion_no_longer_blocks_an_ordinary_question(self):
        conversation = self.conversation()
        client = self.client(conversation, ['分析指数'], '分析指数显示61.25。')
        answer = conversation.answer('姓名和身份证不用解释，只告诉我报告分数是多少', client, 'synthetic-model')
        self.assertIn('61.25', answer)
        self.assertNotIn('改用本地', answer)
        self.assertNotIn('个人信息', answer)
        self.assertNotIn('虚构张三', answer)
        self.assertNotIn('110101199001011234', answer)

    def test_nested_credentials_are_filtered_without_removing_personal_values(self):
        guard = self.conversation().analysis.guard
        value = {'person': {'name': '虚构张三', 'mobile': '13800000000',
                            'token': 'SYNTHETIC_CREDENTIAL_88242'},
                 'serialized': json.dumps({'address': '虚构城市幸福路九号', 'password': 'SYNTHETIC_PASSWORD'})}
        result = guard.redact(value)
        wire = json.dumps(result, ensure_ascii=False)
        self.assertIn('虚构张三', wire)
        self.assertIn('13800000000', wire)
        self.assertIn('虚构城市幸福路九号', wire)
        self.assertNotIn('SYNTHETIC_CREDENTIAL_88242', wire)
        self.assertNotIn('SYNTHETIC_PASSWORD', wire)
        guard.check_payload(result)

    def test_credential_questions_still_make_zero_model_requests(self):
        for question in ('token=SYNTHETIC_CREDENTIAL_88242，姓名是什么？',
                         '验证码是什么，报告分数是多少？', 'sk-SYNTHETICKEY88242998124'):
            with self.subTest(kind=question.split('=')[0]):
                client = script.ScriptClient([])
                answer = self.conversation().answer(question, client, 'synthetic-model')
                self.assertIn('登录凭据', answer)
                self.assertEqual(client.requests, [])

    def test_invented_identity_numbers_and_invalid_sources_still_fail(self):
        for draft in ('手机号是13999999999。', '手机号是13800000000，评分999分。'):
            conversation = self.conversation()
            answer = conversation.answer('手机号是多少？', self.client(conversation, ['手机号'], draft), 'synthetic-model')
            self.assertIn('改用本地', answer)
            self.assertNotIn('13999999999', answer)
            self.assertNotIn('999分', answer)
        guard = self.conversation().analysis.guard
        with self.assertRaises(PrivacyError):
            guard.check_payload({'value': 'SYNTHETIC_CREDENTIAL_88242'})
        with self.assertRaises(PrivacyError):
            self.conversation().analysis.projection.read(['report.someone_else.name'])

    def test_all_prompt_stages_match_the_authorized_policy(self):
        conversation, client = self.conversation(), OverviewClient()
        answer = conversation.answer('姓名和证件部分也包括在内，分析整份报告', client, 'synthetic-model')
        self.assertIn('整体总结', answer)
        prompts = '\n'.join(message['content'] for request in client.requests
                            for message in request['messages'] if message['role'] == 'system')
        self.assertNotIn('姓名、证件、手机号和地址留在本地', prompts)
        self.assertNotIn('四类个人信息时说明本地查询', prompts)
        wire = json.dumps(client.requests, ensure_ascii=False)
        self.assertIn('110101199001011234', wire)
        self.assertNotIn('SYNTHETIC_CREDENTIAL_88242', wire)

    def test_appeal_reply_does_not_repeat_the_removed_privacy_restriction(self):
        answer = self.conversation().answer('怎么申诉', script.ScriptClient([]), 'synthetic-model')
        self.assertNotIn('不要在AI对话里发送身份证', answer)
        self.assertIn('人工', answer)
