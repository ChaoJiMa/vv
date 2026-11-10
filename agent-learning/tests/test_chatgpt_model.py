"""ChatGPT计划路线的真实SDK内存回归：流式完成、工具namespace与失败保护。"""

from contextlib import ExitStack
import json
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from openai import APIStatusError

from report_assistant.integrations.chatgpt_auth import ChatGPTAuthError
from report_assistant.integrations.model import ChatGPTPlanClient, OPENAI_DEFAULT_MODEL
from report_assistant.conversation.session import Conversation
from report_assistant.conversation.service import SERVICE_REPLIES
from support import analysis as support
from support import privacy as privacy
from support import providers as provider_support


class ChatGPTModelTests(privacy.NoExternalIO):
    """不使用真实账号；订阅失败不重试、不回退API Key、不展示未完成增量。"""

    def client(self, handler, account=None, base_url=None):
        stack = ExitStack()
        self.addCleanup(stack.close)
        http = stack.enter_context(httpx.Client(transport=httpx.MockTransport(handler), trust_env=False, follow_redirects=False))
        account = account or SimpleNamespace(access_token=lambda: 'SYNTHETIC_PLAN_TOKEN')
        return stack.enter_context(ChatGPTPlanClient(account, http, base_url=base_url))

    def stream(self, result, *, status='completed', namespace=None):
        """沿用现有虚构模型响应，包为SDK真正解析的SSE，不另造会话行为。"""
        response = json.loads(provider_support.OpenAIProtocol.response(self, result).content)
        response['status'] = status
        if namespace:
            for item in response['output']:
                if item['type'] == 'function_call':
                    item['namespace'] = namespace
        return self.events({'type': 'response.' + status, 'response': response})

    def events(self, *events):
        return httpx.Response(200, headers={'content-type': 'text/event-stream'},
                              text=''.join('data: ' + json.dumps(event) + '\n\n' for event in events) + 'data: [DONE]\n\n')

    def test_json_routing_uses_authorized_bearer_developer_stream_and_no_output_cap(self):
        requests = []
        def handler(request):
            requests.append(request)
            return self.stream(support.response(json.dumps({'route': 'service', 'use_previous': False, 'topic': 'human'})))
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'SYNTHETIC_UNUSED_KEY', 'OPENAI_ORG_ID': 'UNUSED_ORG'}):
            answer = Conversation(support.analysis_tools(), strategy='analysis').answer(
                '请帮我找到工作人员的联络渠道', self.client(handler), OPENAI_DEFAULT_MODEL)
        self.assertEqual(answer, SERVICE_REPLIES['human'])
        self.assertEqual(len(requests), 1)
        wire = json.loads(requests[0].content)
        self.assertEqual(requests[0].headers['authorization'], 'Bearer SYNTHETIC_PLAN_TOKEN')
        self.assertEqual(str(requests[0].url), 'https://api.openai.com/v1/responses')
        self.assertTrue(wire['stream'])
        self.assertFalse(wire['store'])
        self.assertNotIn('max_output_tokens', wire)
        self.assertNotIn('system', [item['role'] for item in wire['input']])
        self.assertIn('developer', [item['role'] for item in wire['input']])
        self.assertEqual(wire['text'], {'format': {'type': 'json_object'}})
        for name in ('token', 'cookie', 'openai-organization', 'openai-project'):
            self.assertNotIn(name, requests[0].headers)

    def test_full_report_tools_remain_namespaced_read_only_and_privacy_filtered(self):
        script = support.report_client(text='您的报告分数为61.25，暂时没有可确认的等级说明。')
        wire = []
        def handler(request):
            payload = json.loads(request.content)
            wire.append(payload)
            return self.stream(script.create(**payload), namespace='report_assistant')
        conversation = Conversation(support.analysis_tools(), strategy='analysis')
        client = self.client(handler)
        answer = conversation.answer('分析报告中的指数', client, OPENAI_DEFAULT_MODEL)
        self.assertIn('61.25', answer)
        self.assertEqual(len(wire), 4)
        self.assertEqual(wire[1]['tools'][0]['type'], 'namespace')
        self.assertEqual(wire[1]['tools'][0]['name'], 'report_assistant')
        self.assertTrue(all(tool['type'] == 'function' and tool['strict'] for tool in wire[1]['tools'][0]['tools']))
        self.assertIn('executed_tool_result', json.dumps(wire[-1]))
        support.assert_no_private(self, wire)
        for marker in ('SYNTHETIC_PRIVATE_REASONING', 'encrypted_content', 'previous_response_id'):
            self.assertNotIn(marker, json.dumps(wire))
        before = len(wire)
        conversation.answer('姓名张三，身份证110101199001011234', client, OPENAI_DEFAULT_MODEL)
        self.assertEqual(len(wire), before)

    def test_failed_incomplete_or_disconnected_stream_never_publishes_partial_answer(self):
        for kind in ('failed', 'incomplete', 'disconnected', 'namespace'):
            requests = []
            def handler(request):
                requests.append(request)
                if kind == 'disconnected':
                    return self.events({'type': 'response.output_text.delta', 'delta': 'SYNTHETIC_PARTIAL_PRIVATE'})
                if kind == 'namespace':
                    return self.stream(support.tool('get_report_catalog', {}), namespace='unapproved')
                return self.stream(support.route(), status=kind)
            answer = Conversation(support.analysis_tools(), strategy='analysis').answer(
                '分析报告中的指数', self.client(handler), OPENAI_DEFAULT_MODEL)
            self.assertIn('本轮改用本地查询', answer)
            self.assertNotIn('SYNTHETIC_PARTIAL_PRIVATE', answer)
            self.assertEqual(len(requests), 1)

    def test_missing_auth_and_gateway_are_rejected_without_request(self):
        requests = []
        def missing():
            raise ChatGPTAuthError('reauthorization_required')
        client = self.client(lambda request: requests.append(request), SimpleNamespace(access_token=missing))
        with self.assertRaises(APIStatusError):
            client.chat.completions.create(model=OPENAI_DEFAULT_MODEL, messages=[])
        self.assertEqual(requests, [])
        with self.assertRaises(ValueError):
            self.client(lambda request: requests.append(request), base_url='https://gateway.invalid/v1')

    def test_api_rejection_does_not_retry_or_follow_redirect_with_token(self):
        for status in (302, 401, 429, 503):
            requests = []
            def handler(request):
                requests.append(request)
                return httpx.Response(status, headers={'location': 'https://unapproved.invalid'},
                                      json={'error': {'message': 'SYNTHETIC_PRIVATE_ERROR'}})
            answer = Conversation(support.analysis_tools(), strategy='analysis').answer(
                '分析报告中的指数', self.client(handler), OPENAI_DEFAULT_MODEL)
            self.assertIn('本轮改用本地查询', answer)
            self.assertNotIn('SYNTHETIC_PRIVATE_ERROR', answer)
            self.assertEqual(len(requests), 1)
