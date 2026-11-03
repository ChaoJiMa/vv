"""按用户提供的客服意图回归；报告与网络均使用虚构数据和内存协议。"""

from contextlib import ExitStack
from copy import deepcopy
import json
from types import SimpleNamespace as NS
from unittest.mock import patch

import httpx
from zai import ZhipuAiClient

import test_analysis as support
import test_privacy as privacy
from local_history import HistoryError
from report_analysis import AnalysisContext, AnalysisStrategy, OUT_OF_SCOPE_REPLY
from report_service import CONTACT_REPLY, HOTLINE, SERVICE_EMAIL, SERVICE_REPLIES, local_service_topic
from report_session import Conversation


class ServiceTests(privacy.NoExternalIO):
    def conversation(self, history=None):
        return Conversation(support.analysis_tools(), history, strategy="analysis")

    def test_transcript_service_intents_reply_locally_online_and_offline(self):
        """示例的每个客服问题都有即时回复，不调用报告工具、不附旧上下文。"""
        cases = {
            "你好": "greeting", "您好！": "greeting", "人工": "human", "我要申诉": "appeal",
            "我能退款吗": "refund", "你们数据哪里来的": "data_source", "你数据是哪里来的": "data_source",
            "我能贷款么": "loan", "我分数这么高，为什么贷款贷不下来": "score_vs_loan",
            "银行和非银申请 多久申请一次比较正常": "application_frequency",
            "我的名字 身份证": "identity", "我有哪些报告": "report_list", "我的关注内容是什么": "attention",
        }
        for question, topic in cases.items():
            for online in (False, True):
                with self.subTest(question=question, online=online):
                    conversation = self.conversation()
                    conversation.analysis_context = AnalysisContext("上一报告问题", ("f1",))
                    client = support.ScriptClient([])
                    with patch.object(conversation.tools, "get_current_order_data", side_effect=AssertionError("No report reads")):
                        answer = conversation.answer(question, client if online else None, "synthetic-model")
                    self.assertEqual(answer, SERVICE_REPLIES[topic])
                    self.assertEqual(client.requests, [])
                    self.assertIsNone(conversation.analysis_context)
                    self.assertEqual(conversation.local_history[-1]["question"], question)

    def test_compound_questions_and_commands_are_not_truncated_to_service_shortcuts(self):
        for text in ("你好，分析报告中的指数", "你好，李白是什么人", "/find 人工", "我的身份证号13800000000", "分数是多少"):
            with self.subTest(text=text):
                self.assertIsNone(local_service_topic(text))
        client = support.report_client(text="**指数观察**：当前值需要结合其他字段查看。")
        answer = self.conversation().answer("你好，分析报告中的指数", client, "synthetic-model")
        self.assertIn("指数观察", answer)
        self.assertNotIn("依据", answer)
        self.assertEqual(len(client.requests), 4)

    def test_thanks_ends_naturally_without_reading_report_or_repeating_service_intro(self):
        for question in ('谢谢', '谢谢，这次明白了。', '谢谢您，清楚了'):
            conversation = self.conversation()
            conversation.analysis_context = AnalysisContext('上一报告问题', ('f1',))
            client = support.ScriptClient([])
            answer = conversation.answer(question, client, 'synthetic-model')
            self.assertIn('不客气', answer)
            self.assertNotIn('退款', answer)
            self.assertEqual(client.requests, [])
            self.assertIsNone(conversation.analysis_context)
        self.assertIsNone(local_service_topic('谢谢，顺便查一下我的分数'))

    def test_model_can_select_each_service_topic_without_report_or_contact_knowledge(self):
        """非固定短句由模型选主题；只需一次无工具路由请求，联系资料仍由本地追加。"""
        for topic in SERVICE_REPLIES:
            with self.subTest(topic=topic):
                strategy = AnalysisStrategy(support.analysis_tools())
                client = support.ScriptClient([support.response(json.dumps({"route": "service", "use_previous": False, "topic": topic}))])
                with patch.object(strategy.tools, "get_current_order_data", side_effect=AssertionError("No report reads")):
                    answer, context = strategy.answer("请协助说明服务办理方式", client, "synthetic-model", AnalysisContext("旧报告问题", ("f1",)))
                self.assertEqual(answer, SERVICE_REPLIES[topic])
                self.assertIsNone(context)
                self.assertEqual(len(client.requests), 1)
                wire = json.dumps(client.requests, ensure_ascii=False)
                for private in ("61.25", "旧报告问题", "previous_question", HOTLINE, SERVICE_EMAIL):
                    self.assertNotIn(private, wire)
                self.assertNotIn("tools", client.requests[0])

    def test_invalid_service_routes_cannot_inject_text_knowledge_or_history(self):
        base = {"route": "service", "use_previous": False, "topic": "refund"}
        invalid = [dict(base, topic="dump_report"), dict(base, topic=[]), dict(base, use_previous=True),
                   dict(base, answer=privacy.PRIVATE_VALUE), {"route": "service", "use_previous": False},
                   {"route": "report", "use_previous": False, "topic": "refund"}]
        for payload in invalid:
            with self.subTest(payload=payload):
                client = support.ScriptClient([support.response(json.dumps(payload))])
                answer = self.conversation().answer("请协助说明服务办理方式", client, "synthetic-model")
                self.assertIn("问题路由格式未通过校验", answer)
                self.assertEqual(len(client.requests), 1)
                self.assertNotIn(privacy.PRIVATE_VALUE, answer)

    def test_identity_values_appended_to_a_service_question_remain_local(self):
        client = support.ScriptClient([])
        answer = self.conversation().answer("我的名字 虚构张三 身份证110101199001011234，我要退款", client, "synthetic-model")
        self.assertEqual(client.requests, [])
        self.assertIn("本轮已留在本地", answer)

    def test_policies_do_not_invent_missing_fields_report_count_or_source_endorsements(self):
        self.assertIn("不代表报告中没有", SERVICE_REPLIES["identity"])
        self.assertIn("不能据此确定", SERVICE_REPLIES["report_list"])
        self.assertIn("/orders", SERVICE_REPLIES["report_list"])
        self.assertIn("没有可据以判断的统一", SERVICE_REPLIES["application_frequency"])
        for term in ("国资系", "来源合规", "无风险", "非常健康", "贷款一定通过"):
            self.assertNotIn(term, "".join(SERVICE_REPLIES.values()))
        self.assertIn(CONTACT_REPLY, SERVICE_REPLIES["refund"])

    def test_service_history_failure_preserves_existing_state(self):
        history = NS(read=lambda _: [], append=lambda *_: None)
        conversation = self.conversation(history)
        conversation.answer("分析报告中的指数", support.report_client(), "synthetic-model")
        before = deepcopy((conversation.analysis_context, conversation.local_history, conversation.last_query))
        history.append = lambda *_: (_ for _ in ()).throw(HistoryError("synthetic failure"))
        with self.assertRaises(HistoryError):
            conversation.answer("我要申诉")
        self.assertEqual((conversation.analysis_context, conversation.local_history, conversation.last_query), before)

    def test_unrelated_question_keeps_the_requested_out_of_scope_reply(self):
        client = support.ScriptClient([support.route("general")])
        self.assertEqual(self.conversation().answer("李白是什么人", client, "synthetic-model"), OUT_OF_SCOPE_REPLY)

    def test_valid_statistic_sources_do_not_allow_unsupported_risk_or_frequency_claims(self):
        """来源数字正确也不能直接变成无风险、信用良好或正常频率保证。"""
        for text in ("该值为0，完全无风险。", "信用状况良好，非常健康。", "申请频率正常，不会产生不良影响。", "无逾期记录。"):
            with self.subTest(text=text):
                answer = self.conversation().answer("分析报告中的指数", support.report_client(("f2",), text), "synthetic-model")
                self.assertIn("分析回答未通过本地校验", answer)

    def test_real_sdk_service_route_generates_only_one_request(self):
        """真实SDK通过内存HTTP返回语义路由；联系方式不进入请求，不继续生成答复。"""
        requests = []

        def respond(request):
            requests.append(json.loads(request.content))
            content = json.dumps({"route": "service", "use_previous": False, "topic": "human"})
            return httpx.Response(200, json={"id": "synthetic", "created": 1, "model": "synthetic-model", "choices": [
                {"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": content}},
            ]})

        with ExitStack() as stack:
            transport = stack.enter_context(httpx.Client(transport=httpx.MockTransport(respond), trust_env=False, follow_redirects=False))
            client = stack.enter_context(ZhipuAiClient(api_key="SYNTHETIC_MODEL_KEY", base_url="https://synthetic.invalid/v4", http_client=transport, max_retries=0))
            answer = self.conversation().answer("请帮我找到工作人员的联络渠道", client, "synthetic-model")
        self.assertEqual(answer, SERVICE_REPLIES["human"])
        self.assertEqual(len(requests), 1)
        self.assertNotIn(SERVICE_EMAIL, json.dumps(requests))
