"""登录协议、错误脱敏及 CLI 联通路径；凭据虚构，禁止真实网络。"""

from report_assistant.runtime import models as model_runtime

from contextlib import ExitStack, redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import tempfile
from unittest.mock import patch

import httpx

import main
from report_assistant.ui.report_selection import select_report
from report_assistant.integrations.api import MY_REPORTS_PATH, REPORT_DATA_PATH, ReportApi
from report_assistant.integrations.auth import LOGIN_PATH, TEST_CODE_PATH, ReportAuth, login_from_env
from report_assistant.integrations.http import ReportApiError, TEST_API_BASE_URL
from report_assistant.reports.tools import LocalReportTools
from support.privacy import NoExternalIO, PRIVATE_VALUE, fixtures


MOBILE = "13800000000"
SMS_CODE = "936412"
TOKEN = "SYNTHETIC_LOGIN_TOKEN"
TEST_USER = "SYNTHETIC_TEST_USER"


class LoginTests(NoExternalIO):
    def auth(self, handler, base=TEST_API_BASE_URL):
        auth = ReportAuth(base, httpx.MockTransport(handler))
        self.addCleanup(auth.close)
        return auth

    def test_test_login_then_report_list_uses_received_token(self):
        requests = []

        def respond(request):
            requests.append(request)
            if request.url.path == TEST_CODE_PATH:
                data = SMS_CODE
            elif request.url.path == LOGIN_PATH:
                data = {"token": TOKEN, "userId": "SYNTHETIC_USER"}
            else:
                data = {"records": [], "total": 0}
            return httpx.Response(200, json={"code": 200, "data": data})

        env = {"REPORT_API_BASE_URL": TEST_API_BASE_URL, "REPORT_LOGIN_MODE": "test",
               "REPORT_LOGIN_MOBILE": MOBILE, "REPORT_TEST_USER_NAME": TEST_USER}
        with patch.dict(os.environ, env, clear=True), patch("builtins.input") as prompt:
            api = ReportApi.from_env(httpx.MockTransport(respond))
            self.addCleanup(api.close)
            self.assertEqual(api.list_my_reports()["total"], 0)
            prompt.assert_not_called()
            self.assertNotIn("REPORT_USER_TOKEN", os.environ)
        self.assertEqual([request.url.path for request in requests], [TEST_CODE_PATH, LOGIN_PATH, MY_REPORTS_PATH])
        self.assertEqual(dict(requests[0].url.params), {"mobile": MOBILE, "testUserName": TEST_USER})
        self.assertEqual(requests[0].content, b"")
        self.assertEqual(json.loads(requests[1].content), {
            "mobile": MOBILE, "smsCode": SMS_CODE, "type": 3, "registerType": 3,
        })
        for request in requests[:2]:
            self.assertNotIn("token", request.headers)
            self.assertNotIn("authorization", request.headers)
            self.assertEqual(request.headers["type"], "3")
        self.assertEqual(requests[2].headers["token"], TOKEN)
        self.assertEqual(requests[2].url.params, httpx.QueryParams())

    def test_sms_login_skips_test_code_endpoint(self):
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(200, json={"code": 200, "data": {"token": TOKEN}})

        auth = self.auth(respond, "https://synthetic-business.invalid")
        self.assertEqual(auth.login(MOBILE, sms_code=SMS_CODE), TOKEN)
        self.assertEqual([request.url.path for request in requests], [LOGIN_PATH])
        self.assertFalse(auth.client.follow_redirects)

    def test_test_mode_cannot_contact_other_gateways(self):
        requests = []
        for base in ("https://open.beironsign.com", "https://testopen.beironsign.com.other.invalid",
                     TEST_API_BASE_URL + "/other", TEST_API_BASE_URL + ":444"):
            with self.subTest(base=base), self.assertRaises(ReportApiError):
                self.auth(lambda request: requests.append(request), base).login(
                    MOBILE, mode="test", test_user_name=TEST_USER)
        self.assertEqual(requests, [])

    def test_invalid_parameters_never_send_requests(self):
        requests = []
        auth = self.auth(lambda request: requests.append(request))
        for mobile, options in (("invalid", {"sms_code": SMS_CODE}),
                                (MOBILE, {"mode": "unknown"}),
                                (MOBILE, {"sms_code": ""}),
                                (MOBILE, {"mode": "test", "test_user_name": ""})):
            with self.subTest(options=options), self.assertRaises(ReportApiError):
                auth.login(mobile, **options)
        self.assertEqual(requests, [])

    def test_code_failure_never_attempts_login_or_echoes_response(self):
        for status, body in ((200, {"code": 403, "msg": TOKEN}),
                             (302, {"code": 200, "data": SMS_CODE}),
                             (500, {"msg": TEST_USER}),
                             (200, {"code": 200, "data": {"code": SMS_CODE}})):
            requests = []

            def respond(request):
                requests.append(request)
                return httpx.Response(status, json=body, headers={"location": "https://other.invalid"})

            with self.subTest(status=status), self.assertRaises(ReportApiError) as caught:
                self.auth(respond).login(MOBILE, mode="test", test_user_name=TEST_USER)
            self.assertEqual(len(requests), 1)
            self.assertNotIn(TOKEN, str(caught.exception))
            self.assertNotIn(TEST_USER, str(caught.exception))
            self.assertNotIn(SMS_CODE, str(caught.exception))

    def test_login_rejects_missing_or_invalid_token(self):
        for data in (None, {}, {"token": ""}, {"token": 123}, {"token": "bad\r\nheader"}):
            with self.subTest(data=data), self.assertRaises(ReportApiError):
                self.auth(lambda request: httpx.Response(200, json={"code": 200, "data": data})).login(
                    MOBILE, sms_code=SMS_CODE)

    def test_login_network_and_protocol_errors_are_sanitized(self):
        def timeout(request):
            raise httpx.ConnectTimeout(TOKEN, request=request)

        handlers = [timeout, lambda request: httpx.Response(200, text=TOKEN),
                    lambda request: httpx.Response(200, json=[TOKEN]),
                    lambda request: httpx.Response(200, json={"code": 4001, "msg": TOKEN})]
        for handler in handlers:
            with self.subTest(handler=handler), self.assertRaises(ReportApiError) as caught:
                self.auth(handler).login(MOBILE, sms_code=SMS_CODE)
            self.assertNotIn(TOKEN, str(caught.exception))

    def test_existing_token_does_not_trigger_login(self):
        with patch.dict(os.environ, {"REPORT_API_BASE_URL": TEST_API_BASE_URL, "REPORT_USER_TOKEN": TOKEN}, clear=True), \
                patch("report_assistant.integrations.api.login_from_env") as login:
            api = ReportApi.from_env(httpx.MockTransport(lambda request: None))
            self.addCleanup(api.close)
            login.assert_not_called()
            self.assertEqual(api.client.headers["token"], TOKEN)

    def test_prompted_sms_code_uses_hidden_input_and_closes_login_client(self):
        with patch.dict(os.environ, {"REPORT_LOGIN_MODE": "sms"}, clear=True), \
                patch("builtins.input", return_value=MOBILE), \
                patch("report_assistant.integrations.auth.getpass", return_value=SMS_CODE) as secret, \
                patch("report_assistant.integrations.auth.ReportAuth") as auth:
            auth.return_value.login.return_value = TOKEN
            self.assertEqual(login_from_env(TEST_API_BASE_URL), TOKEN)
            secret.assert_called_once()
            auth.return_value.close.assert_called_once()
            auth.return_value.login.assert_called_once_with(
                MOBILE, mode="sms", sms_code=SMS_CODE, test_user_name="")

    def test_empty_report_list_exits_without_prompting_for_a_selection(self):
        api = ReportApi(TEST_API_BASE_URL, TOKEN, httpx.MockTransport(
            lambda request: httpx.Response(200, json={"code": 200, "data": {"records": [], "total": 0}})))
        self.addCleanup(api.close)
        with patch("builtins.input") as prompt, redirect_stdout(io.StringIO()) as output:
            self.assertIsNone(select_report(api))
            prompt.assert_not_called()
        self.assertIn("暂无可用报告", output.getvalue())
        self.assertNotIn("REPORT_LOGIN_MOBILE", output.getvalue())

    def test_cli_uses_automatic_login_and_reports_empty_account(self):
        # 复用已有日志恢复逻辑，避免本测试永久关闭其他测试的日志。
        from support.privacy import preserve_loggers
        preserve_loggers(self)

        def respond(request):
            data = (SMS_CODE if request.url.path == TEST_CODE_PATH else
                    {"token": TOKEN} if request.url.path == LOGIN_PATH else {"records": [], "total": 0})
            return httpx.Response(200, json={"code": 200, "data": data})

        env = {"REPORT_DATA_SOURCE": "api", "REPORT_API_BASE_URL": TEST_API_BASE_URL,
               "REPORT_LOGIN_MODE": "test", "REPORT_LOGIN_MOBILE": MOBILE, "REPORT_TEST_USER_NAME": TEST_USER}
        original = ReportApi.from_env
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as resources:
            resources.enter_context(patch.dict(os.environ, env, clear=True))
            resources.enter_context(patch.object(main, "load_dotenv"))
            resources.enter_context(patch.object(main, "default_history_path", return_value=Path(tmp) / "history.sqlite3"))
            resources.enter_context(patch.object(ReportApi, "from_env", side_effect=lambda: original(httpx.MockTransport(respond))))
            sdk = resources.enter_context(patch.object(model_runtime, "ZhipuAiClient"))
            resources.enter_context(patch("builtins.input", side_effect=AssertionError("Unexpected prompt")))
            output = io.StringIO()
            with redirect_stdout(output), redirect_stderr(output):
                self.assertEqual(main.main(), 0)
            sdk.assert_not_called()
            self.assertIn("暂无可用报告", output.getvalue())
            for secret in (MOBILE, SMS_CODE, TOKEN, TEST_USER):
                self.assertNotIn(secret, output.getvalue())


class ReportSelectionTests(NoExternalIO):
    """使用虚构报告验证选择、重试与提示顺序，禁止真实网络和本机配置读取。"""

    def api(self, handler):
        api = ReportApi(TEST_API_BASE_URL, TOKEN, httpx.MockTransport(handler))
        self.addCleanup(api.close)
        return api

    def test_body_failure_is_visible_after_refreshed_list_and_retry_can_succeed(self):
        requests = []
        body_attempts = 0
        order, _ = fixtures()
        report_id = order["report_id"]

        def respond(request):
            nonlocal body_attempts
            requests.append(request)
            if request.url.path == MY_REPORTS_PATH:
                data = {"records": [{"reportId": report_id}], "total": 1}
            else:
                body_attempts += 1
                if body_attempts == 1:
                    return httpx.Response(200, json={"code": 403, "message": TOKEN})
                data = {**order["report_data"], "report_id": report_id}
            return httpx.Response(200, json={"code": 200, "data": data})

        output = io.StringIO()
        snapshots = []

        def choose(prompt):
            snapshots.append(output.getvalue())
            return "1"

        with patch("builtins.input", side_effect=choose), redirect_stdout(output):
            selected = select_report(self.api(respond))
        self.assertEqual(selected["report_id"], report_id)
        self.assertEqual(len(snapshots), 2)
        self.assertGreater(snapshots[1].rfind("读取失败：报告正文接口"), snapshots[1].rfind("我的报告："))
        self.assertIn("已选择第 1 项", output.getvalue())
        self.assertNotIn(TOKEN, output.getvalue())
        self.assertNotIn(PRIVATE_VALUE, output.getvalue())
        self.assertEqual([request.url.path for request in requests], [MY_REPORTS_PATH, MY_REPORTS_PATH,
                         REPORT_DATA_PATH, MY_REPORTS_PATH, MY_REPORTS_PATH, REPORT_DATA_PATH])

    def test_template_rejection_is_visible_at_next_prompt_and_another_report_can_succeed(self):
        order, catalog = fixtures()
        first_id, second_id = "SYNTHETIC_UNSUPPORTED_REPORT", order["report_id"]
        selected_ids = []

        def respond(request):
            if request.url.path == MY_REPORTS_PATH:
                data = {"records": [{"reportId": first_id}, {"reportId": second_id}], "total": 2}
            else:
                report_id = json.loads(request.content)["reportId"]
                selected_ids.append(report_id)
                data = {**order["report_data"], "report_id": report_id}
                if report_id == first_id:
                    data["template"] = {**data["template"], "theme": 2}
            return httpx.Response(200, json={"code": 200, "data": data})

        output = io.StringIO()
        snapshots = []
        choices = iter(["1", "2"])

        def choose(prompt):
            snapshots.append(output.getvalue())
            return next(choices)

        with patch("builtins.input", side_effect=choose), redirect_stdout(output), \
                patch.object(main, "LocalReportTools", side_effect=lambda value: LocalReportTools(value, catalog)):
            tools = main.choose_order(self.api(respond))
        self.assertEqual(json.loads(tools.history_scope)[1], second_id)
        self.assertEqual(selected_ids, [first_id, second_id])
        self.assertEqual(len(snapshots), 2)
        self.assertGreater(snapshots[1].rfind("暂时无法解释所选报告"), snapshots[1].rfind("我的报告："))
        self.assertIn("报告正文已读取，正在校验", snapshots[1])
        self.assertNotIn(PRIVATE_VALUE, output.getvalue())

    def test_invalid_inputs_and_page_boundaries_explain_retry_without_reading_body(self):
        for choice, message in (("", "请输入当前页"), ("0", "请输入当前页"), ("2", "请输入当前页"),
                                ("²", "请输入当前页"), ("p", "已经是第一页"), ("n", "已经是最后一页")):
            with self.subTest(choice=choice):
                paths = []

                def respond(request):
                    paths.append(request.url.path)
                    return httpx.Response(200, json={"code": 200, "data": {
                        "records": [{"reportId": "SYNTHETIC_REPORT"}], "total": 1}})

                with patch("builtins.input", side_effect=[choice, "exit"]), redirect_stdout(io.StringIO()) as output:
                    self.assertIsNone(select_report(self.api(respond)))
                self.assertGreater(output.getvalue().rfind(message), output.getvalue().rfind("我的报告："))
                self.assertEqual(paths, [MY_REPORTS_PATH, MY_REPORTS_PATH])

    def test_pagination_loads_report_from_current_page(self):
        pages = []

        def respond(request):
            payload = json.loads(request.content)
            if request.url.path == MY_REPORTS_PATH:
                pages.append(payload["page"])
                report_id = f"SYNTHETIC_PAGE_{payload['page']}"
                data = {"records": [{"reportId": report_id}], "total": 21}
            else:
                data = {"report_id": payload["reportId"], "report": {}}
            return httpx.Response(200, json={"code": 200, "data": data})

        with patch("builtins.input", side_effect=["n", "p", "n", "1"]), redirect_stdout(io.StringIO()):
            order = select_report(self.api(respond))
        self.assertEqual(order["report_id"], "SYNTHETIC_PAGE_2")
        self.assertEqual(pages, [1, 2, 1, 2, 2])

    def test_disappearing_report_keeps_failure_notice_when_account_becomes_empty(self):
        calls = 0

        def respond(request):
            nonlocal calls
            calls += 1
            data = ({"records": [{"reportId": "SYNTHETIC_REPORT"}], "total": 1} if calls == 1
                    else {"records": [], "total": 0})
            self.assertEqual(request.url.path, MY_REPORTS_PATH)
            return httpx.Response(200, json={"code": 200, "data": data})

        with patch("builtins.input", return_value="1") as prompt, redirect_stdout(io.StringIO()) as output:
            self.assertIsNone(select_report(self.api(respond)))
        prompt.assert_called_once()
        self.assertIn("读取失败", output.getvalue())
        self.assertIn("暂无可用报告", output.getvalue())
        self.assertEqual(calls, 3)
