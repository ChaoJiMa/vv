"""人工联系方式自然问法回归：完整短句本地答，复合诉求继续原路由。"""

from report_assistant.conversation.service import CONTACT_REPLY, local_service_topic
from report_assistant.conversation.session import Conversation
from support.analysis import ScriptClient
from support.overview import overview_tools
from support.privacy import NoExternalIO


class ServiceAliasesTests(NoExternalIO):
    """只用虚构报告与脚本模型，不读取本机配置、Java或真实报告。"""

    def test_complete_human_contact_aliases_are_local(self):
        for question in (
                '人工客服的服务时间', '客服工作时间是什么', '人工客服邮箱是什么',
                '人工客服的邮箱地址是什么', '请问客服的联系邮箱是多少',
                '客服服务时间是几点呢', '客服联系方式有哪些', '客服电话是多少'):
            with self.subTest(question=question):
                client = ScriptClient([])
                answer = Conversation(overview_tools(count=1), strategy='analysis',
                                      allow_personal=True).answer(question, client, 'synthetic-model')
                self.assertEqual(local_service_topic(question), 'human')
                self.assertIn(CONTACT_REPLY, answer)
                self.assertEqual(client.requests, [])

    def test_compound_report_or_other_service_question_is_not_consumed(self):
        for question in ('客服工作时间是什么，分析前三个模块',
                         '人工客服邮箱是什么，还想查评分',
                         '客服的服务时间和退款怎么处理'):
            with self.subTest(question=question):
                self.assertIsNone(local_service_topic(question))
