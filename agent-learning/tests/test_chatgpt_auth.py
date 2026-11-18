"""账号授权安全回归：虚构身份与内存HTTP，不读.env或Codex凭据。"""

from report_assistant.runtime import models as model_runtime

from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, redirect_stdout, redirect_stderr
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import time
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from cryptography.hazmat.primitives.asymmetric import rsa
import httpx
import jwt

import main
from report_assistant.integrations.chatgpt_auth import (
    AUTHORIZE_URL, TOKEN_URL, ISSUER, RESOURCE, SCOPES, PLAN_SCOPE,
    BrowserAuthorization, ChatGPTAccount, ChatGPTAuthError, CredentialStore,
)
from report_assistant.integrations.model import ChatGPTPlanClient
from scripts import evaluate_customer
from support import analysis as support
from support import privacy as privacy


class ChatGPTAuthTests(privacy.NoExternalIO):
    """覆盖PKCE、身份边界、令牌轮换与加密存储，不依赖真实订阅。"""

    @classmethod
    def setUpClass(cls):
        cls.signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.public_key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.signing_key.public_key()))
        cls.public_key.update(kid='synthetic-key', use='sig', alg='RS256')

    def setUp(self):
        super().setUp()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.temp = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.path = Path(self.temp) / 'auth.sqlite3'
        self.store = CredentialStore(self.path)
        self.requests = []
        self.token_result = None
        self.http = self.stack.enter_context(httpx.Client(transport=httpx.MockTransport(self.handler), trust_env=False))
        self.account = ChatGPTAccount(self.http, self.store)

    def handler(self, request):
        """只响应显式官方端点；测试若意外携带业务身份立即失败。"""
        self.requests.append(request)
        self.assertNotIn('token', request.headers)
        self.assertNotIn('cookie', request.headers)
        if str(request.url) == ISSUER + '/.well-known/openid-configuration':
            return httpx.Response(200, json={'issuer': ISSUER, 'jwks_uri': ISSUER + '/.well-known/jwks.json',
                'authorization_endpoint': AUTHORIZE_URL, 'token_endpoint': TOKEN_URL,
                'revocation_endpoint': ISSUER + '/revoke', 'id_token_signing_alg_values_supported': ['RS256']})
        if str(request.url) == ISSUER + '/.well-known/jwks.json':
            return httpx.Response(200, json={'keys': [self.public_key]})
        if str(request.url) == TOKEN_URL:
            if isinstance(self.token_result, int):
                return httpx.Response(self.token_result, json={'error': 'SYNTHETIC_SECRET_BODY'})
            return httpx.Response(200, json=self.token_result)
        if str(request.url) == ISSUER + '/revoke':
            return httpx.Response(200)
        self.fail('出现未批准端点')

    def token(self, **changes):
        """创建真实签名的虚构ID token，便于逐项验证OIDC拒绝条件。"""
        now = int(time.time())
        claims = dict(iss=ISSUER, sub='synthetic-subject', aud='oaiapp_synthetic',
                      iat=now, exp=now + 3600, nonce='synthetic-nonce', email='user@example.test')
        claims.update(changes)
        return jwt.encode(claims, self.signing_key, algorithm='RS256', headers={'kid': 'synthetic-key'})

    def saved(self, *, expired=False):
        """保存虚构账号注册；实际DPAPI密文应不包含以下任何明文令牌。"""
        with self.store.transaction() as data:
            data['accounts']['one'] = {'client_id': 'oaiapp_synthetic', 'subject': 'synthetic-subject',
                'access_token': 'SYNTHETIC_ACCESS_OLD', 'refresh_token': 'SYNTHETIC_REFRESH_OLD',
                'id_token': self.token(), 'scopes': SCOPES.split(), 'expires_at': time.time() + (-1 if expired else 3600)}
            data['active'] = 'one'

    def test_host_id_stable_and_tokens_encrypted_with_current_windows_user(self):
        self.saved()
        with self.store.transaction() as data:
            host = data['host_id']
        with CredentialStore(self.path).transaction() as data:
            self.assertEqual(host, data['host_id'])
        for raw in (b'SYNTHETIC_ACCESS_OLD', b'SYNTHETIC_REFRESH_OLD', b'synthetic-subject'):
            self.assertNotIn(raw, self.path.read_bytes())

    def test_corrupt_store_stops_without_replacement(self):
        self.path.write_bytes(b'SYNTHETIC_CORRUPT_DATABASE')
        with self.assertRaises(ChatGPTAuthError):
            self.account.access_token()
        self.assertEqual(self.path.read_bytes(), b'SYNTHETIC_CORRUPT_DATABASE')

    def test_identity_signature_issuer_audience_expiry_nonce_and_subject(self):
        self.assertEqual(self.account._identity(self.token(), 'oaiapp_synthetic', nonce='synthetic-nonce')['sub'], 'synthetic-subject')
        for changes in ({'iss': 'https://untrusted.invalid'}, {'aud': 'another-client'}, {'exp': 1},
                        {'nonce': 'another-nonce'}, {'sub': ''}):
            with self.subTest(changes=changes), self.assertRaises(ChatGPTAuthError):
                self.account._identity(self.token(**changes), 'oaiapp_synthetic', nonce='synthetic-nonce')
        with self.assertRaises(ChatGPTAuthError):
            self.account._identity(self.token(), 'oaiapp_synthetic', subject='another-account')
        unsigned = jwt.encode({'sub': 'synthetic'}, '', algorithm='none')
        with self.assertRaises(ChatGPTAuthError):
            self.account._identity(unsigned, 'oaiapp_synthetic')
        wrong = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        forged = jwt.encode({'iss': ISSUER, 'sub': 'fake', 'aud': 'oaiapp_synthetic',
                             'iat': int(time.time()), 'exp': int(time.time()) + 600},
                            wrong, algorithm='RS256', headers={'kid': 'synthetic-key'})
        with self.assertRaises(ChatGPTAuthError):
            self.account._identity(forged, 'oaiapp_synthetic')

    def test_refresh_rotates_atomically_across_independent_managers(self):
        self.saved(expired=True)
        self.token_result = {'access_token': 'SYNTHETIC_ACCESS_NEW', 'refresh_token': 'SYNTHETIC_REFRESH_NEW',
                             'expires_in': 3600, 'token_type': 'Bearer'}
        def obtain(_):
            return ChatGPTAccount(self.http, CredentialStore(self.path)).access_token()
        with ThreadPoolExecutor(max_workers=5) as pool:
            values = list(pool.map(obtain, range(5)))
        self.assertEqual(values, ['SYNTHETIC_ACCESS_NEW'] * 5)
        refreshes = [request for request in self.requests if str(request.url) == TOKEN_URL]
        self.assertEqual(len(refreshes), 1)
        form = parse_qs(refreshes[0].content.decode())
        self.assertEqual(form['client_id'], ['oaiapp_synthetic'])
        self.assertEqual(form['resource'], [RESOURCE])
        self.assertNotIn('scope', form)
        with self.store.transaction() as data:
            self.assertEqual(data['accounts']['one']['refresh_token'], 'SYNTHETIC_REFRESH_NEW')

    def test_refresh_failure_does_not_retry_or_overwrite_credentials(self):
        self.saved(expired=True)
        self.token_result = 401
        with self.assertRaises(ChatGPTAuthError) as caught:
            self.account.access_token()
        self.assertNotIn('SYNTHETIC_SECRET_BODY', str(caught.exception))
        self.assertEqual(len(self.requests), 1)
        with self.store.transaction() as data:
            self.assertEqual(data['accounts']['one']['refresh_token'], 'SYNTHETIC_REFRESH_OLD')

    def test_no_authorization_in_background_never_opens_browser(self):
        with patch('webbrowser.open') as browser, self.assertRaises(ChatGPTAuthError):
            self.account.ensure_authorized(interactive=False)
        browser.assert_not_called()
        self.assertEqual(self.requests, [])

    def test_flow_s256_state_and_exact_redirect_are_bound(self):
        flow = BrowserAuthorization({'host_id': 'urn:uuid:synthetic', 'accounts': {}}, lambda _: True)
        status, headers, _ = flow.handle(flow.launch_path + '/login', {}, '127.0.0.1:54321')
        self.assertEqual(status, 302)
        query = parse_qs(urlsplit(headers['Location']).query)
        self.assertEqual(query['client_id'], ['dynamic_agent_client'])
        self.assertEqual(query['redirect_uri'], ['http://127.0.0.1:54321/auth/callback'])
        self.assertEqual(query['scope'], [SCOPES])
        self.assertEqual(query['code_challenge_method'], ['S256'])
        self.assertNotIn(flow.pending['verifier'], headers['Location'])
        self.assertNotEqual(query['code_challenge'][0], flow.pending['verifier'])
        self.assertEqual(flow.handle('/auth/callback', {'state': 'wrong', 'code': 'synthetic'}, '127.0.0.1:54321')[0], 400)
        self.assertIsNotNone(flow.pending)
        correct = dict(state=flow.pending['state'], code='synthetic-code', client_id='oaiapp_synthetic')
        self.assertEqual(flow.handle('/auth/callback', correct, '127.0.0.1:54321')[0], 200)
        self.assertEqual(flow.result['client_id'], 'oaiapp_synthetic')
        self.assertEqual(flow.handle('/auth/callback', correct, '127.0.0.1:54321')[0], 400)

    def test_reauth_reuses_registration_rejects_client_change_and_handles_denial(self):
        record = {'client_id': 'oaiapp_synthetic', 'scopes': SCOPES.split(), 'id_token': 'SYNTHETIC_ID_TOKEN'}
        snapshot = {'host_id': 'urn:uuid:synthetic', 'accounts': {'one': record}}
        for denied in (False, True):
            flow = BrowserAuthorization(snapshot, lambda _: True)
            _, headers, _ = flow.handle(flow.launch_path + '/login', {'account': 'one'}, '127.0.0.1:54321')
            query = parse_qs(urlsplit(headers['Location']).query)
            self.assertEqual(query['client_id'], ['oaiapp_synthetic'])
            self.assertEqual(query['id_token_hint'], ['SYNTHETIC_ID_TOKEN'])
            self.assertNotIn('agent_name_hint', query)
            callback = dict(state=flow.pending['state'], client_id='different', code='synthetic')
            if denied:
                callback['error'] = 'access_denied'
            flow.handle('/auth/callback', callback, '127.0.0.1:54321')
            self.assertIsNone(flow.result)
            self.assertEqual(flow.error, 'authorization_denied' if denied else 'authorization_failed')

    def test_sign_in_validates_before_activation_and_retains_scope_decline(self):
        result = dict(selected=None, client_id='oaiapp_synthetic', code='synthetic-code',
                      verifier='synthetic-verifier', nonce='synthetic-nonce', redirect_uri='http://127.0.0.1:54321/auth/callback')
        self.token_result = dict(access_token='SYNTHETIC_ACCESS', refresh_token='SYNTHETIC_REFRESH',
                                 token_type='Bearer', expires_in=3600, scope=SCOPES, id_token=self.token())
        with patch.object(BrowserAuthorization, 'run', return_value=result):
            self.account.sign_in()
        self.assertEqual(self.account.access_token(), 'SYNTHETIC_ACCESS')
        form = parse_qs(next(r for r in self.requests if str(r.url) == TOKEN_URL).content.decode())
        self.assertEqual(form['code_verifier'], ['synthetic-verifier'])
        self.assertEqual(form['client_id'], ['oaiapp_synthetic'])
        self.token_result['scope'] = 'openid profile email'
        with patch.object(BrowserAuthorization, 'run', return_value=result), self.assertRaises(ChatGPTAuthError) as caught:
            self.account.sign_in()
        self.assertEqual(caught.exception.code, 'permission_missing')
        with self.store.transaction() as data:
            record = data['accounts'][data['active']]
            self.assertEqual(record['client_id'], 'oaiapp_synthetic')
            self.assertNotIn('access_token', record)

    def test_sign_out_clears_tokens_but_preserves_registration_and_host(self):
        self.saved()
        with self.store.transaction() as data:
            host = data['host_id']
        self.assertTrue(self.account.sign_out())
        with self.store.transaction() as data:
            self.assertEqual(host, data['host_id'])
            self.assertEqual(data['accounts']['one']['client_id'], 'oaiapp_synthetic')
            self.assertNotIn('access_token', data['accounts']['one'])
            self.assertIsNone(data['active'])

    def test_cli_account_mode_does_not_require_api_key(self):
        with patch.dict(os.environ, {'REPORT_EXTERNAL_MODEL': 'on', 'REPORT_MODEL_PROVIDER': 'openai',
                        'OPENAI_AUTH_MODE': 'chatgpt', 'REPORT_DATA_SOURCE': 'demo'}, clear=True), \
                patch.object(main, 'load_dotenv'), patch.object(main, 'configure_private_logging'), \
                patch.object(main, 'default_history_path', return_value=Path(self.temp) / 'history.sqlite3'), \
                patch.object(main, 'HistoryStore'), patch.object(model_runtime, 'ChatGPTAccount') as account, \
                patch.object(model_runtime, 'ChatGPTPlanClient') as client, patch.object(model_runtime, 'OpenAIResponsesClient') as api_client, \
                patch.object(main.LocalReportTools, 'demo', return_value=support.analysis_tools()), \
                patch('builtins.input', return_value='exit'), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(main.main(), 0)
            account.return_value.ensure_authorized.assert_called_once_with(interactive=True)
            self.assertIs(client.call_args.args[0], account.return_value)
            api_client.assert_not_called()

    def test_account_gateway_rejected_before_java_login_and_mode_changes_version(self):
        with patch.dict(os.environ, {'REPORT_EXTERNAL_MODEL': 'on', 'REPORT_MODEL_PROVIDER': 'openai',
                        'OPENAI_AUTH_MODE': 'chatgpt', 'OPENAI_BASE_URL': 'https://gateway.invalid/v1'}, clear=True), \
                patch.object(main, 'load_dotenv'), patch.object(main, 'configure_private_logging'), \
                patch.object(main, 'ReportApi') as api, redirect_stderr(io.StringIO()):
            self.assertEqual(main.main(), 1)
            api.from_env.assert_not_called()
        with patch.dict(os.environ, {'OPENAI_AUTH_MODE': 'api_key'}):
            before = evaluate_customer.fingerprint()
        with patch.dict(os.environ, {'OPENAI_AUTH_MODE': 'chatgpt'}):
            self.assertNotEqual(before, evaluate_customer.fingerprint())

    def test_evaluation_uses_saved_account_without_interactive_login(self):
        with ExitStack() as stack, patch.dict(os.environ, {'REPORT_MODEL_PROVIDER': 'openai', 'OPENAI_AUTH_MODE': 'chatgpt'}, clear=True), \
                patch.object(model_runtime, 'ChatGPTAccount') as account, \
                patch.object(model_runtime, 'ChatGPTPlanClient') as client:
            evaluate_customer.model_client(stack)
            account.return_value.ensure_authorized.assert_called_once_with(interactive=False)
            self.assertIs(client.call_args.args[0], account.return_value)
