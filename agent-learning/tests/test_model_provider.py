"""DeepSeek 的真实 SDK 内存协议回归；使用虚构凭据且禁止外部网络。"""

from support.providers import DeepSeekProtocol, OpenAIProtocol

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
from support import analysis as support
from support import privacy as privacy
from report_assistant.integrations.model import DEEPSEEK_DEFAULT_MODEL, OPENAI_BASE_URL, OPENAI_DEFAULT_MODEL, DeepSeekClient, OpenAIResponsesClient, openai_base_url
from report_assistant.conversation.service import SERVICE_REPLIES
from report_assistant.conversation.session import Conversation


class DeepSeekTests(DeepSeekProtocol, privacy.NoExternalIO):
    """检查 SDK 参数、工具往返、权限出口、失败分类和终端厂商选择。"""



    def test_service_route_pins_endpoint_and_sends_only_selected_key(self):
        requests = []

        def handler(request):
            requests.append(request)
            return self.response(support.response(json.dumps({
                "route": "service", "use_previous": False, "topic": "human",
            })))

        with patch.dict(os.environ, {
            "OPENAI_BASE_URL": "https://unapproved.invalid", "OPENAI_ORG_ID": "OTHER_ORG",
            "OPENAI_PROJECT_ID": "OTHER_PROJECT", "OPENAI_CUSTOM_HEADERS": "Authorization: OTHER_KEY\ntoken: BUSINESS_TOKEN",
        }):
            client = self.client(handler)
        answer = Conversation(support.analysis_tools(), strategy="analysis").answer(
            "请帮我找到工作人员的联络渠道", client, DEEPSEEK_DEFAULT_MODEL,
        )
        self.assertEqual(answer, SERVICE_REPLIES["human"])
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(str(request.url), "https://api.deepseek.com/chat/completions")
        self.assertEqual(request.headers["authorization"], "Bearer SYNTHETIC_DEEPSEEK_KEY")
        self.assertNotIn("token", request.headers)
        self.assertNotIn("openai-organization", request.headers)
        self.assertNotIn("openai-project", request.headers)
        payload = json.loads(request.content)
        self.assertEqual(payload["thinking"], {"type": "disabled"})
        self.assertEqual(payload["response_format"], {"type": "json_object"})
        self.assertEqual(payload["max_tokens"], 1800)
        self.assertNotIn("timeout", payload)
        self.assertNotIn("tools", payload)
        self.assertNotIn("61.25", request.content.decode())

    def test_full_analysis_preserves_tools_and_privacy_checks(self):
        script = support.report_client(text="您的报告分数为61.25，暂时没有可确认的等级说明。")
        wire = []

        def handler(request):
            payload = json.loads(request.content)
            wire.append(payload)
            return self.response(script.create(**payload))

        conversation = Conversation(support.analysis_tools(), strategy="analysis")
        answer = conversation.answer("分析报告中的指数", self.client(handler), DEEPSEEK_DEFAULT_MODEL)
        self.assertNotIn("依据", answer)
        self.assertIn("61.25", answer)
        self.assertEqual(len(wire), 4)
        for payload in wire:
            self.assertEqual(payload["thinking"], {"type": "disabled"})
            self.assertNotIn("reasoning_content", json.dumps(payload))
        support.assert_no_private(self, wire)
        before = len(wire)
        answer = conversation.answer("姓名张三，身份证110101199001011234", self.client(handler), DEEPSEEK_DEFAULT_MODEL)
        self.assertIn("本轮已留在本地", answer)
        self.assertEqual(len(wire), before)

    def test_errors_are_classified_without_retry_or_response_leak(self):
        cases = [(401, "模型服务拒绝"), (429, "模型服务拒绝"), (500, "模型服务拒绝"),
                 (302, "模型服务拒绝"), ("timeout", "模型响应超时"), ("connection", "模型服务连接失败")]
        for kind, expected in cases:
            with self.subTest(kind=kind):
                requests = []

                def handler(request):
                    requests.append(request)
                    if kind == "timeout":
                        raise httpx.ReadTimeout("SYNTHETIC_PRIVATE_ERROR", request=request)
                    if kind == "connection":
                        raise httpx.ConnectError("SYNTHETIC_PRIVATE_ERROR", request=request)
                    return httpx.Response(kind, headers={"location": "https://unapproved.invalid"},
                                          json={"error": {"message": "SYNTHETIC_PRIVATE_ERROR"}})

                answer = Conversation(support.analysis_tools(), strategy="analysis").answer(
                    "分析报告中的指数", self.client(handler), DEEPSEEK_DEFAULT_MODEL,
                )
                self.assertIn(expected, answer)
                self.assertNotIn("SYNTHETIC_PRIVATE_ERROR", answer)
                self.assertEqual(len(requests), 1)

    def test_thinking_mode_is_rejected_before_sending(self):
        requests = []
        client = self.client(lambda request: requests.append(request))
        with self.assertRaises(ValueError):
            client.chat.completions.create(model=DEEPSEEK_DEFAULT_MODEL, messages=[], thinking={"type": "enabled"})
        self.assertEqual(requests, [])

    def test_cli_selects_deepseek_and_announces_actual_provider(self):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {
                "REPORT_DATA_SOURCE": "demo", "REPORT_EXTERNAL_MODEL": "on",
                "REPORT_MODEL_PROVIDER": "deepseek", "DEEPSEEK_API_KEY": "SYNTHETIC_DEEPSEEK_KEY",
                "ZHIPU_API_KEY": "OTHER_PROVIDER_KEY", "REPORT_USER_TOKEN": "SYNTHETIC_BUSINESS_TOKEN",
            }, clear=True))
            stack.enter_context(patch.object(main, "load_dotenv"))
            stack.enter_context(patch.object(main, "configure_private_logging"))
            stack.enter_context(patch.object(main, "default_history_path", return_value=Path(tmp) / "history.sqlite3"))
            stack.enter_context(patch.object(main.LocalReportTools, "demo", return_value=support.analysis_tools()))
            deepseek = stack.enter_context(patch.object(model_runtime, "DeepSeekClient"))
            zhipu = stack.enter_context(patch.object(model_runtime, "ZhipuAiClient"))
            stack.enter_context(patch("builtins.input", side_effect=["你好", "exit"]))
            output = io.StringIO()
            with redirect_stdout(output), redirect_stderr(output):
                self.assertEqual(main.main(), 0)
            deepseek.assert_called_once()
            self.assertEqual(deepseek.call_args.args[0], "SYNTHETIC_DEEPSEEK_KEY")
            transport = deepseek.call_args.args[1]
            self.assertFalse(transport.follow_redirects)
            self.assertNotIn("token", transport.headers)
            zhipu.assert_not_called()
            self.assertIn("DeepSeek（deepseek-flash）", output.getvalue())
            for secret in ("SYNTHETIC_DEEPSEEK_KEY", "OTHER_PROVIDER_KEY", "SYNTHETIC_BUSINESS_TOKEN"):
                self.assertNotIn(secret, output.getvalue())

    def test_unknown_provider_fails_before_business_login(self):
        with patch.dict(os.environ, {"REPORT_EXTERNAL_MODEL": "on", "REPORT_MODEL_PROVIDER": "unknown"}, clear=True), \
                patch.object(main, "load_dotenv"), patch.object(main, "configure_private_logging"), \
                patch.object(main, "HistoryStore") as history, redirect_stderr(io.StringIO()):
            self.assertEqual(main.main(), 1)
            history.assert_not_called()


class OpenAIProviderTests(OpenAIProtocol, privacy.NoExternalIO):
    """真实 SDK 的 Responses 内存验证；不读取本机密钥或 Codex 身份。"""



    def test_sol_uses_responses_and_keeps_json_route_stateless(self):
        requests = []

        def handler(request):
            requests.append(request)
            return self.response(support.response(json.dumps({
                "route": "service", "use_previous": False, "topic": "human",
            })))

        with patch.dict(os.environ, {"OPENAI_BASE_URL": "https://unapproved.invalid",
                                    "OPENAI_CUSTOM_HEADERS": "Authorization: OTHER_KEY\ntoken: BUSINESS_TOKEN"}):
            client = self.client(handler)
        conversation = Conversation(support.analysis_tools(), strategy="analysis")
        answer = conversation.answer("请帮我找到工作人员的联络渠道", client, OPENAI_DEFAULT_MODEL)
        self.assertEqual(answer, SERVICE_REPLIES["human"])
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(str(request.url), "https://api.openai.com/v1/responses")
        self.assertEqual(request.headers["authorization"], "Bearer SYNTHETIC_OPENAI_KEY")
        self.assertNotIn("token", request.headers)
        payload = json.loads(request.content)
        self.assertEqual(payload["model"], "gpt-6.1-sol")
        self.assertEqual(payload["reasoning"], {"effort": "low"})
        self.assertEqual(payload["text"], {"format": {"type": "json_object"}})
        self.assertEqual(payload["max_output_tokens"], 8192)
        self.assertFalse(payload["store"])
        self.assertNotIn("thinking", payload)
        self.assertNotIn("max_tokens", payload)
        self.assertEqual(request.extensions["timeout"]["read"], 30.0)
        self.assertNotIn("tools", payload)

    def test_sol_honors_per_request_timeout_without_sending_it_as_json(self):
        """短问答与整份分析的网络预算必须到达真实SDK，不能被适配器统一覆盖。"""
        requests = []

        def handler(request):
            requests.append(request)
            return self.response(support.response('{"route":"general","use_previous":false}'))

        client = self.client(handler)
        for timeout in (30.0, 90.0):
            client.chat.completions.create(model=OPENAI_DEFAULT_MODEL,
                                           messages=[{"role": "user", "content": "合成问题"}], timeout=timeout)
        self.assertEqual([request.extensions["timeout"]["read"] for request in requests], [30.0, 90.0])
        self.assertTrue(all("timeout" not in json.loads(request.content) for request in requests))

    def test_sol_executes_full_tool_loop_without_forwarding_reasoning(self):
        script = support.report_client(text="您的报告分数为61.25，暂时没有可确认的等级说明。")
        wire = []

        def handler(request):
            payload = json.loads(request.content)
            wire.append(payload)
            return self.response(script.create(**payload))

        conversation = Conversation(support.analysis_tools(), strategy="analysis")
        client = self.client(handler)
        answer = conversation.answer("分析报告中的指数", client, OPENAI_DEFAULT_MODEL)
        self.assertNotIn("依据", answer)
        self.assertIn("61.25", answer)
        self.assertEqual(len(wire), 4)
        self.assertIn("executed_tool_result", json.dumps(wire[-1]))
        self.assertEqual(wire[1]["tools"][0]["type"], "function")
        self.assertTrue(wire[1]["tools"][0]["strict"])
        self.assertNotIn("function", wire[1]["tools"][0])
        for payload in wire:
            self.assertFalse(payload["store"])
            self.assertNotIn("previous_response_id", payload)
            self.assertTrue(all("type" not in item for item in payload["input"]))
        serialized = json.dumps(wire)
        for forbidden in ("SYNTHETIC_PRIVATE_REASONING", "reasoning_content", "encrypted_content", "resp_synthetic", "fc_c1"):
            self.assertNotIn(forbidden, serialized)
        support.assert_no_private(self, wire)
        before = len(wire)
        conversation.answer("姓名张三，身份证110101199001011234", client, OPENAI_DEFAULT_MODEL)
        self.assertEqual(len(wire), before)

    def test_sol_incomplete_and_refusal_responses_fall_back(self):
        for status in ("incomplete", "failed", "refusal"):
            with self.subTest(status=status):
                def handler(request):
                    response = self.response(support.route())
                    body = json.loads(response.content)
                    if status == "refusal":
                        body["output"] = [{"type": "message", "id": "msg_refusal", "role": "assistant", "status": "completed",
                                           "content": [{"type": "refusal", "refusal": "PRIVATE_REFUSAL"}]}]
                    else:
                        body["status"] = status
                    return httpx.Response(200, json=body)

                answer = Conversation(support.analysis_tools(), strategy="analysis").answer(
                    "分析报告中的指数", self.client(handler), OPENAI_DEFAULT_MODEL,
                )
                self.assertIn("模型未返回完整回答", answer)
                self.assertNotIn("PRIVATE_REFUSAL", answer)

    def test_sol_errors_do_not_retry_or_leak_and_only_use_openai(self):
        for kind in (401, 429, 500, 302, "timeout", "connection"):
            with self.subTest(kind=kind):
                requests = []

                def handler(request):
                    requests.append(request)
                    if kind == "timeout":
                        raise httpx.ReadTimeout("PRIVATE_ERROR", request=request)
                    if kind == "connection":
                        raise httpx.ConnectError("PRIVATE_ERROR", request=request)
                    return httpx.Response(kind, headers={"location": "https://unapproved.invalid"},
                                          json={"error": {"message": "PRIVATE_ERROR"}})

                answer = Conversation(support.analysis_tools(), strategy="analysis").answer(
                    "分析报告中的指数", self.client(handler), OPENAI_DEFAULT_MODEL,
                )
                self.assertIn("本轮改用本地查询", answer)
                self.assertNotIn("PRIVATE_ERROR", answer)
                self.assertEqual(len(requests), 1)
                self.assertEqual(requests[0].url.host, "api.openai.com")

    def test_cli_sol_selection_requires_its_own_key_and_model(self):
        for has_key in (True, False):
            with self.subTest(has_key=has_key), tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
                stack.enter_context(patch.dict(os.environ, {
                    "REPORT_DATA_SOURCE": "demo", "REPORT_EXTERNAL_MODEL": "on", "REPORT_MODEL_PROVIDER": "openai",
                    "OPENAI_API_KEY": "SYNTHETIC_OPENAI_KEY" if has_key else "",
                    "OPENAI_BASE_URL": "http://gateway.invalid:2455/v1/",
                    "DEEPSEEK_API_KEY": "OTHER_PROVIDER_KEY", "REPORT_USER_TOKEN": "SYNTHETIC_BUSINESS_TOKEN",
                }, clear=True))
                stack.enter_context(patch.object(main, "load_dotenv"))
                stack.enter_context(patch.object(main, "configure_private_logging"))
                stack.enter_context(patch.object(main, "default_history_path", return_value=Path(tmp) / "history.sqlite3"))
                stack.enter_context(patch.object(main.LocalReportTools, "demo", return_value=support.analysis_tools()))
                sdk = stack.enter_context(patch.object(model_runtime, "OpenAIResponsesClient"))
                deepseek = stack.enter_context(patch.object(model_runtime, "DeepSeekClient"))
                stack.enter_context(patch("builtins.input", side_effect=["exit"]))
                output = io.StringIO()
                with redirect_stdout(output), redirect_stderr(output):
                    self.assertEqual(main.main(), 0 if has_key else 1)
                deepseek.assert_not_called()
                if has_key:
                    self.assertEqual(sdk.call_args.args[0], "SYNTHETIC_OPENAI_KEY")
                    self.assertEqual(sdk.call_args.kwargs["base_url"], "http://gateway.invalid:2455/v1")
                    self.assertIn("OpenAI兼容网关（gpt-6.1-sol）", output.getvalue())
                else:
                    sdk.assert_not_called()
                for secret in ("SYNTHETIC_OPENAI_KEY", "OTHER_PROVIDER_KEY", "SYNTHETIC_BUSINESS_TOKEN"):
                    self.assertNotIn(secret, output.getvalue())

    def test_custom_gateway_preserves_json_protocol_and_isolated_credentials(self):
        """HTTP网关按显式地址拼接responses，仍只发送选定模型凭据。"""
        requests = []
        def handler(request):
            requests.append(request)
            body = json.loads(request.content)
            # 模拟网关对JSON模式的输入要求，不依赖system内容或中文分词识别。
            self.assertIn({"role": "user", "content": "Return a JSON object."}, body["input"])
            return self.response(support.response(json.dumps({"route": "service", "use_previous": False, "topic": "human"})))
        with patch.dict(os.environ, {"OPENAI_BASE_URL": "https://unselected.invalid", "OPENAI_CUSTOM_HEADERS": "token: BUSINESS_TOKEN"}):
            client = self.client(handler, "http://gateway.invalid:2455/v1/")
        answer = Conversation(support.analysis_tools(), strategy="analysis").answer("请帮我找到工作人员的联络渠道", client, OPENAI_DEFAULT_MODEL)
        self.assertEqual(answer, SERVICE_REPLIES["human"])
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(str(request.url), "http://gateway.invalid:2455/v1/responses")
        self.assertEqual(request.headers["authorization"], "Bearer SYNTHETIC_OPENAI_KEY")
        for name in ("token", "cookie", "openai-organization", "openai-project"):
            self.assertNotIn(name, request.headers)
        self.assertEqual(json.loads(request.content)["text"], {"format": {"type": "json_object"}})

    def test_json_hint_preserves_input_payload_and_does_not_affect_tool_requests(self):
        """JSON提示作为固定独立消息插入，业务JSON仍可直接解析且调用方对象不变。"""
        requests = []
        def handler(request):
            requests.append(json.loads(request.content))
            return self.response(support.response('{"text":"合成回复"}'))
        client = self.client(handler, "http://gateway.invalid:2455/v1")
        messages = [{"role": "system", "content": "仅输出JSON对象"},
                    {"role": "user", "content": '{"question":"合成问题","modules":[]}'}]
        before = json.dumps(messages, ensure_ascii=False)
        client.chat.completions.create(model=OPENAI_DEFAULT_MODEL, messages=messages, response_format={"type": "json_object"})
        client.chat.completions.create(model=OPENAI_DEFAULT_MODEL, messages=messages)
        self.assertEqual(json.dumps(messages, ensure_ascii=False), before)
        self.assertEqual(json.loads(requests[0]["input"][-1]["content"]), {"question": "合成问题", "modules": []})
        self.assertEqual(sum(item["content"] == "Return a JSON object." for item in requests[0]["input"]), 1)
        self.assertEqual(requests[1]["input"], messages)

    def test_gateway_redirect_and_errors_never_fall_back_to_official_endpoint(self):
        """网关失败不转官方地址，跳转不携带key跟随至其他域名。"""
        for status in (302, 401, 429, 500):
            with self.subTest(status=status):
                requests = []
                def handler(request):
                    requests.append(request)
                    return httpx.Response(status, headers={"location": "https://unselected.invalid"}, json={"error": {"message": "PRIVATE_ERROR"}})
                answer = Conversation(support.analysis_tools(), strategy="analysis").answer(
                    "分析报告中的指数", self.client(handler, "http://gateway.invalid:2455/v1"), OPENAI_DEFAULT_MODEL)
                self.assertIn("改用本地", answer)
                self.assertNotIn("PRIVATE_ERROR", answer)
                self.assertEqual(len(requests), 1)
                self.assertEqual(requests[0].url.host, "gateway.invalid")

    def test_base_url_validation_does_not_echo_credentials(self):
        for value in (None, "", "   "):
            self.assertEqual(openai_base_url(value), OPENAI_BASE_URL)
        self.assertEqual(openai_base_url(" https://gateway.invalid/prefix/v1/ "), "https://gateway.invalid/prefix/v1")
        for value in ("ftp://gateway.invalid/v1", "//gateway.invalid/v1", "https:///v1", "http://gateway.invalid:0/v1",
                      "http://gateway.invalid:99999/v1", "http://gateway.invalid:bad/v1", "https://user:PRIVATE_ERROR@gateway.invalid/v1",
                      "https://gateway.invalid/v1?key=PRIVATE_ERROR", "https://gateway.invalid/v1#PRIVATE_ERROR", "http://gateway.invalid/v1\n", "http://gateway.invalid/has space", "https://gateway.invalid\\other/v1", 123):
            with self.subTest(value=value), self.assertRaises(ValueError) as caught:
                openai_base_url(value)
            self.assertNotIn("PRIVATE_ERROR", str(caught.exception))

    def test_invalid_gateway_fails_before_business_login(self):
        with patch.dict(os.environ, {"REPORT_EXTERNAL_MODEL": "on", "REPORT_MODEL_PROVIDER": "openai",
                                     "REPORT_DATA_SOURCE": "api", "OPENAI_BASE_URL": "https://user:PRIVATE_ERROR@gateway.invalid/v1"}, clear=True), \
                patch.object(main, "load_dotenv"), patch.object(main, "configure_private_logging"), \
                patch.object(main, "HistoryStore") as history, patch.object(main.ReportApi, "from_env") as business:
            output = io.StringIO()
            with redirect_stderr(output):
                self.assertEqual(main.main(), 1)
            self.assertIn("OPENAI_BASE_URL", output.getvalue())
            self.assertNotIn("PRIVATE_ERROR", output.getvalue())
            history.assert_not_called()
            business.assert_not_called()
