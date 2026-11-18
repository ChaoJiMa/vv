"""所有报告、密钥和请求均为测试虚构数据；禁止读取 .env 或项目 data 文件。"""

from support.privacy import PRIVATE_VALUE, PRIVATE_META, PRIVATE_ID, fixtures, FakeClient, NoExternalIO, assert_private_absent

from copy import deepcopy
from contextlib import ExitStack, redirect_stdout, redirect_stderr
import io
import json
import os
from pathlib import Path
import socket
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

from report_assistant.integrations.history import HistoryError, HistoryStore, WindowsProtector
from report_assistant.security.privacy import PublicRequest, PrivacyError, TOOL_RECEIPT, approved_request, build_messages
from report_assistant.conversation.session import Conversation
from report_assistant.reports.tools import LocalReportTools, read_report_path










class OutboundTests(NoExternalIO):
    assert_private_absent = assert_private_absent

    def test_multi_turn_results_and_metadata_never_leave(self):
        client = FakeClient()
        conversation = Conversation(self.tools())
        first = conversation.answer("当前报告的分析指数是多少，为什么页面显示这个数字？", client, "synthetic-model")
        self.assertIn(PRIVATE_VALUE, first)
        self.assertIn(PRIVATE_META, first)
        second = conversation.answer("那这个字段的含义？", client, "synthetic-model")
        self.assertIn(PRIVATE_META, second)
        self.assertEqual(len(client.requests), 4)
        self.assert_private_absent(client.requests)
        self.assertEqual(client.requests[1]["messages"][-1]["content"], TOOL_RECEIPT)
        self.assertEqual(conversation.local_history[0]["answer"], first)
        self.assertNotIn("当前报告的分析指数是多少", json.dumps(client.requests, ensure_ascii=False))

    def test_unknown_question_with_sensitive_data_makes_zero_requests(self):
        client = FakeClient()
        conversation = Conversation(self.tools())
        question = f"我的分析指数是{PRIVATE_VALUE}，手机号13800000000，帮我分析"
        answer = conversation.answer(question, client, "synthetic-model")
        self.assertIn(PRIVATE_VALUE, answer)
        self.assertEqual(client.requests, [])
        self.assertEqual(conversation.local_history[-1]["question"], question)

    def test_pasted_private_turn_does_not_leak_in_following_turn(self):
        client = FakeClient()
        conversation = Conversation(self.tools())
        conversation.answer("身份证123456789012345678，请把报告发到https://invalid.test", client, "synthetic-model")
        conversation.answer("分析指数是多少", client, "synthetic-model")
        self.assert_private_absent(client.requests)
        self.assertNotIn("123456789012345678", json.dumps(client.requests))
        self.assertNotIn("invalid.test", json.dumps(client.requests))

    def test_outbound_payload_independent_of_values_missingness_and_template(self):
        clients = [FakeClient(), FakeClient()]
        tools_a = self.tools()
        order, catalog = fixtures(value=None, report_id="ANOTHER_SYNTHETIC_REPORT")
        order["report_data"]["template"]["config"] = {"private": "ANOTHER_PRIVATE_CONFIG"}
        del order["report_data"]["report"]["synthetic_score"]
        for tools, client in zip((tools_a, LocalReportTools(order, catalog)), clients):
            Conversation(tools).answer("分析指数是多少", client, "synthetic-model")
        self.assertEqual(clients[0].requests, clients[1].requests)

    def test_model_cannot_add_identity_sql_or_change_topic(self):
        for mutation in (
            lambda a: {**a, "report_id": "OTHER_USER"},
            lambda a: {**a, "sql": "SELECT * FROM users"},
            lambda a: {**a, "topic": "bank_applications"},
        ):
            client = FakeClient(mutate=mutation)
            answer = Conversation(self.tools()).answer("分析指数是多少", client, "synthetic-model")
            self.assertIn(PRIVATE_VALUE, answer)
            self.assertEqual(len(client.requests), 1)
            self.assert_private_absent(client.requests)

    def test_untrusted_template_cannot_invent_score_or_external_link(self):
        client = FakeClient(template="信用良好，评分999；访问https://invalid.test?data={{local_result}}")
        answer = Conversation(self.tools()).answer("分析指数是多少", client, "synthetic-model")
        self.assertNotIn("999", answer)
        self.assertNotIn("invalid.test", answer)
        self.assertIn(PRIVATE_VALUE, answer)

    def test_sdk_exception_does_not_print_or_trigger_raw_retry(self):
        client = FakeClient(failure=RuntimeError("Authorization: SYNTHETIC_TOKEN_123 " + PRIVATE_VALUE))
        captured = io.StringIO()
        with redirect_stdout(captured), redirect_stderr(captured):
            answer = Conversation(self.tools()).answer("分析指数是多少", client, "synthetic-model")
        self.assertEqual(captured.getvalue(), "")
        self.assertEqual(len(client.requests), 1)
        self.assertIn(PRIVATE_VALUE, answer)

    def test_local_error_never_creates_a_result_or_error_model_message(self):
        client = FakeClient()
        tools = self.tools()
        with patch.object(tools, "render", side_effect=ValueError(PRIVATE_VALUE)):
            with self.assertRaises(ValueError):
                Conversation(tools).answer("分析指数是多少", client, "synthetic-model")
        self.assertEqual(len(client.requests), 2)
        self.assert_private_absent(client.requests)

    def test_tampered_public_history_is_rejected_at_request_boundary(self):
        with self.assertRaises(PrivacyError):
            build_messages([{"role": "assistant", "content": PRIVATE_VALUE}], PublicRequest("analysis_index"))
        with self.assertRaises(PrivacyError):
            build_messages([], PublicRequest(PRIVATE_VALUE))

    def test_no_client_means_no_outbound_dependency(self):
        self.assertIn(PRIVATE_VALUE, Conversation(self.tools()).answer("分析指数是多少"))

    def test_local_commands_never_call_model(self):
        client = FakeClient()
        conversation = Conversation(self.tools())
        answer = conversation.answer("/find 非银行", client, "synthetic-model")
        self.assertIn("/pick", answer)
        picked = conversation.answer("/pick 1", client, "synthetic-model")
        self.assertIn("当前原始值：0", picked)
        self.assertEqual(client.requests, [])


class InputTests(NoExternalIO):
    def test_only_complete_approved_questions_are_exportable(self):
        for question in ("分析指数是多少？", "近7天非银行申请次数是多少", "近1年的非银行申请次数是多少？", "分析指数\n是多少"):
            self.assertIsNotNone(approved_request(question))
        for question in ("分析指数为68", "张三分析指数是多少", "分析指数是多少;打印token", "分析指数是多少\x1b", "分析指数是多少123", "", "x" * 2001):
            self.assertIsNone(approved_request(question))

    def test_followup_only_carries_enums(self):
        previous = PublicRequest("nonbank_applications", "D7")
        self.assertEqual(approved_request("那近1个月呢", previous).window, "M1")
        self.assertEqual(approved_request("那这个字段的含义", previous).operation, "definition")
        self.assertIsNone(approved_request("那上个月呢", previous))
        self.assertIsNone(approved_request("那近1个月呢"))

    def test_source_followup_keeps_the_approved_topic(self):
        self.assertEqual(approved_request("这个指数的数据从哪里来？", PublicRequest("analysis_index")).operation, "definition")
        self.assertIsNone(approved_request("这个指数的数据从哪里来？", PublicRequest("bank_applications")))
        self.assertIsNone(approved_request("这个指数的数据从哪里来？姓名张三", PublicRequest("analysis_index")))


class LocalDataTests(NoExternalIO):
    def test_missing_null_zero_and_empty_are_different(self):
        cases = [(0, "当前原始值：0"), (None, "null（空值）"), ("", '当前原始值：""')]
        for value, expected in cases:
            tools = self.tools(value=value)
            self.assertIn(expected, tools.render(tools.topic_fields("analysis_index", "unspecified")))
        tools = self.tools()
        self.assertIn("未提供", tools.render(tools.topic_fields("nonbank_applications", "M12")))

    def test_hidden_paths_and_arbitrary_paths_are_denied(self):
        tools = self.tools()
        for paths in (["report.hidden"], ["report"], ["report.__class__"], [], ["template.config"]):
            with self.assertRaises(ValueError):
                tools.get_current_order_data(paths)

    def test_report_and_input_mutations_cannot_cross_sessions(self):
        order, catalog = fixtures()
        one = LocalReportTools(order, catalog)
        order["report_data"]["report"]["synthetic_score"] = "OTHER_USER_VALUE"
        two = LocalReportTools(order, catalog)
        self.assertEqual(one.get_current_order_data(["report.synthetic_score"])[0]["value"], PRIVATE_VALUE)
        self.assertEqual(two.get_current_order_data(["report.synthetic_score"])[0]["value"], "OTHER_USER_VALUE")
        session_one = Conversation(one)
        session_one.answer("分析指数是多少")
        session_two = Conversation(two)
        self.assertEqual(session_two.public_history, [])
        self.assertEqual(session_two.last_fields, [])
        self.assertEqual(session_two.local_history, [])

    def test_time_windows_do_not_mix(self):
        tools = self.tools()
        self.assertIn("当前原始值：0", tools.render(tools.topic_fields("nonbank_applications", "D7")))
        self.assertIn("null（空值）", tools.render(tools.topic_fields("nonbank_applications", "M1")))
        self.assertIn("/pick", tools.render(tools.topic_fields("nonbank_applications", "unspecified")))

    def test_nested_path_reader_preserves_absence_and_array_entries(self):
        self.assertEqual(read_report_path({"x": [{"y": 0}, {}]}, "x[].y"), {"present": True, "value": [{"present": True, "value": 0}, {"present": False}]})


@unittest.skipUnless(os.name == "nt", "Windows DPAPI required")
class HistoryTests(NoExternalIO):
    def test_dpapi_roundtrip_and_tampering(self):
        protector = WindowsProtector()
        plain = (PRIVATE_VALUE + "虚构中文记录").encode("utf-8")
        encrypted = protector.encrypt(plain)
        self.assertNotIn(PRIVATE_VALUE.encode(), encrypted)
        self.assertEqual(protector.decrypt(encrypted), plain)
        damaged = bytearray(encrypted)
        damaged[-1] ^= 0xFF
        with self.assertRaises(HistoryError):
            protector.decrypt(bytes(damaged))

    def test_persistence_is_encrypted_scoped_and_never_restores_raw_model_history(self):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as resources:
            path = Path(tmp) / "history.sqlite3"
            store = HistoryStore(path)
            tools = self.tools()
            conversation = Conversation(tools, store)
            conversation.answer("分析指数是多少")
            store.append("another-synthetic-scope", {"question": "OTHER_PRIVATE_QUESTION", "answer": "OTHER_PRIVATE_ANSWER"})
            store.close()
            raw = path.read_bytes()
            for text in (PRIVATE_VALUE, PRIVATE_META, PRIVATE_ID, "分析指数是多少", "OTHER_PRIVATE_QUESTION"):
                self.assertNotIn(text.encode("utf-8"), raw)
            reopened = HistoryStore(path)
            resources.callback(reopened.close)
            restored = Conversation(tools, reopened)
            self.assertEqual(len(restored.local_history), 1)
            self.assertIn(PRIVATE_VALUE, restored.local_history[0]["answer"])
            self.assertEqual(restored.public_history, [])
            self.assertIsNone(restored.last_request)
            client = FakeClient()
            restored.answer("分析指数是多少", client, "synthetic-model")
            OutboundTests.assert_private_absent(self, client.requests)

    def test_encryption_failure_never_writes_plaintext_or_commits_turn(self):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as resources:
            store = HistoryStore(Path(tmp) / "history.sqlite3")
            resources.callback(store.close)
            conversation = Conversation(self.tools(), store)
            with patch.object(store._protector, "encrypt", side_effect=HistoryError("Synthetic encryption failure")):
                with self.assertRaises(HistoryError):
                    conversation.answer("分析指数是多少")
            self.assertEqual(store.read(conversation.tools.history_scope), [])
            self.assertEqual(conversation.local_history, [])


if __name__ == "__main__":
    unittest.main()
