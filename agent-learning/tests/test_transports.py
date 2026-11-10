"""用真实 SDK + 内存 HTTP 传输验证出口；不读取配置、不连接外部服务。"""

from support.privacy import preserve_loggers

from report_assistant.runtime import models as model_runtime

from contextlib import ExitStack, redirect_stderr, redirect_stdout
import io
import json
import logging
import os
from pathlib import Path
import tempfile
from unittest.mock import patch

import httpx
from zai import ZhipuAiClient

import main
from support import privacy as support
from report_assistant.integrations.api import MY_REPORTS_PATH, REPORT_DATA_PATH, ReportApi, ReportApiError
from report_assistant.security.privacy import TOOL_RECEIPT
from report_assistant.conversation.session import Conversation
from report_assistant.reports.tools import LocalReportTools
from support.privacy import NoExternalIO, PRIVATE_ID, PRIVATE_META, PRIVATE_VALUE, fixtures


class ModelTransportTests(NoExternalIO):
    def sdk(self, resources, requests, *, arguments=None, status=200):
        def respond(request):
            body = json.loads(request.content)
            requests.append({"body": body, "headers": dict(request.headers), "url": str(request.url)})
            if status != 200:
                return httpx.Response(status, json={"error": {"message": PRIVATE_VALUE, "code": "synthetic_error"}})
            if body["messages"][-1]["role"] == "user":
                args = arguments or body["messages"][-1]["content"]
                message = {"role": "assistant", "content": PRIVATE_META, "reasoning_content": PRIVATE_META,
                           "tool_calls": [{"id": "synthetic_call", "type": "function", "function": {
                               "name": "query_current_report", "arguments": args,
                           }}]}
                reason = "tool_calls"
            else:
                message = {"role": "assistant", "content": "{{local_result}}"}
                reason = "stop"
            return httpx.Response(200, json={"id": "synthetic_response", "created": 1, "model": "synthetic-model",
                                            "choices": [{"index": 0, "finish_reason": reason, "message": message}]})

        transport = resources.enter_context(httpx.Client(
            transport=httpx.MockTransport(respond), trust_env=False, follow_redirects=False,
        ))
        return resources.enter_context(ZhipuAiClient(
            api_key="SYNTHETIC_MODEL_KEY", base_url="https://synthetic-model.invalid/v4",
            http_client=transport, max_retries=0,
        ))

    def test_real_sdk_serializes_only_approved_messages(self):
        with ExitStack() as resources:
            requests = []
            client = self.sdk(resources, requests)
            conversation = Conversation(self.tools())
            self.assertIn(PRIVATE_VALUE, conversation.answer("分析指数是多少", client, "synthetic-model"))
            conversation.answer("这个指数的数据从哪里来？", client, "synthetic-model")
            self.assertEqual(len(requests), 4)
            support.assert_private_absent(self, requests)
            self.assertEqual(requests[1]["body"]["messages"][-1]["content"], TOOL_RECEIPT)
            for request in requests:
                self.assertNotIn("token", request["headers"])
                self.assertNotIn("cookie", request["headers"])
                self.assertEqual(request["headers"]["authorization"], "Bearer SYNTHETIC_MODEL_KEY")

    def test_serialized_bodies_do_not_depend_on_report_contents(self):
        bodies = []
        for missing in (False, True):
            with ExitStack() as resources:
                requests = []
                client = self.sdk(resources, requests)
                order, catalog = fixtures()
                if missing:
                    order["report_id"] = "ANOTHER_SYNTHETIC_REPORT"
                    order["report_data"]["report"].clear()
                    order["report_data"]["template"]["modules"].clear()
                Conversation(LocalReportTools(order, catalog)).answer("分析指数是多少", client, "synthetic-model")
                self.assertEqual(len(requests), 2)
                bodies.append([item["body"] for item in requests])
        self.assertEqual(bodies[0], bodies[1])

    def test_duplicate_tool_argument_keys_are_rejected(self):
        with ExitStack() as resources:
            requests = []
            args = '{"topic":"other_user","topic":"analysis_index","window":"unspecified","operation":"both"}'
            client = self.sdk(resources, requests, arguments=args)
            answer = Conversation(self.tools()).answer("分析指数是多少", client, "synthetic-model")
            self.assertIn(PRIVATE_VALUE, answer)
            self.assertEqual(len(requests), 1)

    def test_http_error_stops_external_requests_and_uses_local_answer(self):
        with ExitStack() as resources:
            requests = []
            client = self.sdk(resources, requests, status=403)
            captured = io.StringIO()
            with redirect_stdout(captured), redirect_stderr(captured):
                answer = Conversation(self.tools()).answer("分析指数是多少", client, "synthetic-model")
            self.assertIn(PRIVATE_VALUE, answer)
            self.assertEqual(len(requests), 1)
            self.assertEqual(captured.getvalue(), "")
            support.assert_private_absent(self, requests)


class BusinessTransportTests(NoExternalIO):
    def api(self, handler):
        api = ReportApi("https://synthetic-business.invalid", "SYNTHETIC_BUSINESS_TOKEN", httpx.MockTransport(handler))
        self.addCleanup(api.close)
        return api

    def test_selected_report_is_rechecked_with_separate_business_credentials(self):
        requests = []

        def respond(request):
            requests.append(request)
            if request.url.path == MY_REPORTS_PATH:
                data = {"records": [{"reportId": PRIVATE_ID}], "total": 1}
            else:
                data = {**fixtures()[0]["report_data"], "report_id": PRIVATE_ID}
            return httpx.Response(200, json={"code": 200, "data": data})

        order = self.api(respond).load_selected_report(1, PRIVATE_ID)
        self.assertEqual(order["report_id"], PRIVATE_ID)
        self.assertEqual([request.url.path for request in requests], [MY_REPORTS_PATH, REPORT_DATA_PATH])
        self.assertEqual([json.loads(request.content) for request in requests], [
            {"page": 1, "size": 20}, {"reportId": PRIVATE_ID},
        ])
        for request in requests:
            self.assertEqual(request.headers["token"], "SYNTHETIC_BUSINESS_TOKEN")
            self.assertNotIn("authorization", request.headers)

    def test_report_outside_current_users_list_never_requests_body(self):
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(200, json={"code": 200, "data": {"records": [], "total": 0}})

        with self.assertRaises(ReportApiError):
            self.api(respond).load_selected_report(1, "OTHER_USERS_REPORT")
        self.assertEqual([request.url.path for request in requests], [MY_REPORTS_PATH])

    def test_mismatched_body_id_is_rejected(self):
        def respond(request):
            data = ({"records": [{"reportId": PRIVATE_ID}], "total": 1} if request.url.path == MY_REPORTS_PATH
                    else {"report_id": "OTHER_USERS_REPORT", "report": {"value": PRIVATE_VALUE}})
            return httpx.Response(200, json={"code": 200, "data": data})

        with self.assertRaises(ReportApiError):
            self.api(respond).load_selected_report(1, PRIVATE_ID)

    def test_business_errors_do_not_echo_response_or_follow_redirects(self):
        for status in (200, 302, 403, 500):
            with self.subTest(status=status):
                requests = []

                def respond(request):
                    requests.append(request)
                    return httpx.Response(status, headers={"location": "https://synthetic-other.invalid"},
                                          json={"code": 403, "message": PRIVATE_VALUE})

                with self.assertRaises(ReportApiError) as caught:
                    self.api(respond).list_my_reports()
                self.assertNotIn(PRIVATE_VALUE, str(caught.exception))
                self.assertEqual(len(requests), 1)


class StartupTests(NoExternalIO):
    preserve_loggers = preserve_loggers

    def test_existing_child_log_handlers_cannot_bypass_private_logging(self):
        self.preserve_loggers()
        captured = io.StringIO()
        names = ("zai.core._http_client", "httpcore.connection")
        for name in names:
            logger = logging.getLogger(name)
            logger.handlers = [logging.StreamHandler(captured)]
            logger.setLevel(logging.DEBUG)
            logger.disabled = False
            logger.propagate = False
        main.configure_private_logging()
        for name in names:
            logging.getLogger(name).critical(PRIVATE_VALUE)
        self.assertEqual(captured.getvalue(), "")

    def test_default_cli_stays_local_and_persists_only_encrypted_history(self):
        self.preserve_loggers()
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as resources:
            path = Path(tmp) / "history.sqlite3"
            resources.enter_context(patch.dict(os.environ, {"REPORT_DATA_SOURCE": "demo"}, clear=True))
            dotenv = resources.enter_context(patch.object(main, "load_dotenv"))
            resources.enter_context(patch.object(main, "default_history_path", return_value=path))
            resources.enter_context(patch.object(main.LocalReportTools, "demo", return_value=self.tools()))
            sdk = resources.enter_context(patch.object(model_runtime, "ZhipuAiClient"))
            resources.enter_context(patch("builtins.input", side_effect=["分析指数是多少", "/history", "exit"]))
            captured = io.StringIO()
            with redirect_stdout(captured), redirect_stderr(captured):
                self.assertEqual(main.main(), 0)
            dotenv.assert_called_once()
            sdk.assert_not_called()
            self.assertIn(PRIVATE_VALUE, captured.getvalue())
            self.assertNotIn(PRIVATE_VALUE.encode(), path.read_bytes())
            for internal_hint in ('/find', '/pick', '/orders', '/history', 'REPORT_EXTERNAL_MODEL='):
                self.assertNotIn(internal_hint, captured.getvalue())

    def test_external_mode_pins_endpoint_and_never_passes_business_token(self):
        from support import analysis as analysis_support

        self.preserve_loggers()
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as resources:
            resources.enter_context(patch.dict(os.environ, {
                "REPORT_DATA_SOURCE": "demo", "REPORT_EXTERNAL_MODEL": "on",
                "ZHIPU_API_KEY": "SYNTHETIC_MODEL_KEY", "ZHIPU_MODEL": "synthetic-model",
                "REPORT_USER_TOKEN": "SYNTHETIC_BUSINESS_TOKEN",
                "ZAI_BASE_URL": "https://synthetic-unapproved.invalid",
            }, clear=True))
            resources.enter_context(patch.object(main, "load_dotenv"))
            resources.enter_context(patch.object(main, "default_history_path", return_value=Path(tmp) / "history.sqlite3"))
            resources.enter_context(patch.object(main.LocalReportTools, "demo", return_value=self.tools()))
            sdk = resources.enter_context(patch.object(model_runtime, "ZhipuAiClient"))
            client = analysis_support.report_client(text="当前字段提供了报告原文，需结合其他字段查看。")
            sdk.return_value.__enter__.return_value = client
            resources.enter_context(patch("builtins.input", side_effect=[
                "分析指数是多少", "分析指数为68，姓名张三", "exit",
            ]))
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(main.main(), 0)
            sdk.assert_called_once()
            options = sdk.call_args.kwargs
            self.assertEqual(options["base_url"], "https://open.bigmodel.cn/api/paas/v4")
            self.assertEqual(options["api_key"], "SYNTHETIC_MODEL_KEY")
            self.assertEqual(options["max_retries"], 0)
            self.assertFalse(options["http_client"].follow_redirects)
            self.assertNotIn("token", options["http_client"].headers)
            self.assertEqual(len(client.requests), 4)
            self.assertIn("list_report_fields", json.dumps(client.requests))
            wire = json.dumps(client.requests)
            self.assertIn(PRIVATE_VALUE, wire)
            for forbidden in ("SYNTHETIC_BUSINESS_TOKEN", PRIVATE_ID, "report.synthetic", "synthetic_score"):
                self.assertNotIn(forbidden, wire)
