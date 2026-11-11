"""本地ChatGPT计划授权：独立OAuth、DPAPI凭据与串行令牌轮换，不读取Codex缓存。"""

import base64
from contextlib import contextmanager
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import html
import json
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from urllib.parse import parse_qs, urlencode, urlsplit
import uuid
import webbrowser

import httpx
import jwt

from report_assistant.integrations.history import HistoryError, WindowsProtector


ISSUER = 'https://auth.openai.com'
AUTHORIZE_URL = ISSUER + '/api/accounts/authorize'
TOKEN_URL = ISSUER + '/api/accounts/oauth/token'
RESOURCE = 'https://api.openai.com/v1'
SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
PLAN_SCOPE = 'chatgpt.tokens.use.direct'
APP_NAME = 'report-assistant-local'


class ChatGPTAuthError(RuntimeError):
    """仅含固定原因码；禁止携带服务响应、授权URL、账号或令牌。"""

    def __init__(self, code='authorization_failed'):
        self.code = code if code in {
            'authorization_failed', 'reauthorization_required', 'permission_missing',
            'network_unavailable', 'storage_unavailable', 'login_timeout',
            'browser_unavailable', 'identity_invalid', 'authorization_denied',
        } else 'authorization_failed'
        super().__init__({
            'reauthorization_required': '模型账号需要重新登录授权。',
            'permission_missing': '账号尚未允许本应用使用ChatGPT订阅额度。',
            'network_unavailable': '模型账号授权服务暂时无法连接，请稍后再试。',
            'storage_unavailable': '模型账号的本地加密存储不可用。',
            'login_timeout': '账号登录等待已结束，请重新打开客服后登录。',
            'browser_unavailable': '未能打开账号登录页面，请检查默认浏览器。',
            'identity_invalid': '模型账号授权校验未通过，未启用该账号。',
            'authorization_denied': '本次账号授权已取消。',
        }.get(self.code, '模型账号授权未完成，请重新登录。'))


def default_auth_path():
    """凭据只保存在当前Windows用户的应用目录，与业务历史及Codex登录分开。"""
    base = os.getenv('LOCALAPPDATA')
    if not base:
        raise ChatGPTAuthError('storage_unavailable')
    return Path(base) / 'ReportAssistant' / 'chatgpt-auth.sqlite3'


class CredentialStore:
    """SQLite单行保存DPAPI密文；事务锁同时约束多线程和多进程的刷新轮换。"""

    def __init__(self, path=None, protector=None):
        self.path = Path(path) if path is not None else default_auth_path()
        self.protector = protector if protector is not None else WindowsProtector()
        self.lock = threading.RLock()

    @contextmanager
    def transaction(self):
        """先取得写锁再解密最新记录；异常回滚，不落盘明文或覆盖损坏数据。"""
        with self.lock:
            connection = None
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                connection = sqlite3.connect(self.path, timeout=30)
                connection.execute('CREATE TABLE IF NOT EXISTS credentials (id INTEGER PRIMARY KEY CHECK(id=1), payload BLOB NOT NULL)')
                connection.execute('BEGIN IMMEDIATE')
                row = connection.execute('SELECT payload FROM credentials WHERE id=1').fetchone()
                if row:
                    data = json.loads(self.protector.decrypt(row[0]).decode('utf-8'))
                    if (data.get('version') != 1 or not isinstance(data.get('accounts'), dict)
                            or not isinstance(data.get('host_id'), str)
                            or not data['host_id'].startswith('urn:uuid:')):
                        raise ValueError('invalid encrypted record')
                else:
                    data = {'version': 1, 'host_id': 'urn:uuid:' + str(uuid.uuid4()),
                            'accounts': {}, 'active': None}
                yield data
                payload = self.protector.encrypt(json.dumps(data, ensure_ascii=False).encode('utf-8'))
                connection.execute('INSERT OR REPLACE INTO credentials VALUES (1, ?)', (payload,))
                connection.commit()
            except (OSError, sqlite3.Error, HistoryError, ValueError, TypeError, KeyError, AttributeError):
                raise ChatGPTAuthError('storage_unavailable') from None
            finally:
                if connection is not None:
                    connection.close()


def _credential(value):
    """限制协议凭据为不含空白的有界字符串，不把它们拼入错误提示。"""
    return (isinstance(value, str) and value.isascii() and 0 < len(value) <= 65536
            and not any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in value))


class ChatGPTAccount:
    """管理本应用账号注册、身份校验和访问令牌；HTTP客户端必须与业务接口隔离。"""

    def __init__(self, http_client, store=None):
        self.http = http_client
        self.store = store if store is not None else CredentialStore()

    def _json(self, method, url, **kwargs):
        """仅向固定官方授权主机请求；不重试、不跟随跳转、不外露响应正文。"""
        parts = urlsplit(url)
        if (parts.scheme != 'https' or parts.netloc != 'auth.openai.com'
                or parts.query or parts.fragment or parts.username):
            raise ChatGPTAuthError()
        try:
            response = self.http.request(method, url, timeout=20, follow_redirects=False, **kwargs)
            if response.status_code != 200:
                if response.status_code >= 500:
                    raise ChatGPTAuthError('network_unavailable')
                raise ChatGPTAuthError('reauthorization_required')
            if len(response.content) > 1_000_000:
                raise ChatGPTAuthError()
            value = response.json()
            if not isinstance(value, dict):
                raise ChatGPTAuthError()
            return value
        except httpx.HTTPError:
            raise ChatGPTAuthError('network_unavailable') from None
        except (ValueError, TypeError):
            raise ChatGPTAuthError() from None

    def _identity(self, token, client_id, *, nonce=None, subject=None):
        """校验签名、issuer/audience/时效及nonce；返回经验证身份，不信任JWT自述算法。"""
        try:
            if not _credential(token):
                raise ValueError('missing token')
            config = self._json('GET', ISSUER + '/.well-known/openid-configuration')
            if (config.get('issuer') != ISSUER or config.get('jwks_uri') != ISSUER + '/.well-known/jwks.json'
                    or config.get('authorization_endpoint') != AUTHORIZE_URL or config.get('token_endpoint') != TOKEN_URL):
                raise ValueError('untrusted issuer')
            header = jwt.get_unverified_header(token)
            allowed = {'RS256', 'ES256', 'EdDSA'} & set(config.get('id_token_signing_alg_values_supported', ['RS256']))
            if header.get('alg') not in allowed or not header.get('kid'):
                raise ValueError('untrusted algorithm')
            keys = self._json('GET', config['jwks_uri']).get('keys', [])
            matching = [key for key in keys if key.get('kid') == header['kid'] and key.get('use', 'sig') == 'sig']
            if len(matching) != 1:
                raise ValueError('unknown signing key')
            key = jwt.PyJWK.from_dict(matching[0], algorithm=header['alg'])
            identity = jwt.decode(token, key.key, algorithms=[header['alg']], issuer=ISSUER,
                                  audience=client_id, leeway=5,
                                  options={'require': ['iss', 'aud', 'sub', 'exp', 'iat']})
            if not isinstance(identity['sub'], str) or not identity['sub']:
                raise ValueError('missing subject')
            if nonce is not None and not hmac.compare_digest(str(identity.get('nonce', '')), nonce):
                raise ValueError('nonce mismatch')
            if subject is not None and identity['sub'] != subject:
                raise ValueError('account mismatch')
            return identity
        except ChatGPTAuthError:
            raise
        except (jwt.PyJWTError, ValueError, TypeError, KeyError):
            raise ChatGPTAuthError('identity_invalid') from None

    def _tokens(self, result, previous=None):
        """校验token响应并构造整组替换数据；缺少订阅权限时不允许推理。"""
        previous = previous or {}
        scopes = result.get('scope')
        scopes = scopes.split() if isinstance(scopes, str) else previous.get('scopes', [])
        if PLAN_SCOPE not in scopes or 'resource.invoke' not in scopes:
            raise ChatGPTAuthError('permission_missing')
        expires = result.get('expires_in')
        if (not _credential(result.get('access_token')) or result.get('token_type', '').lower() != 'bearer'
                or not isinstance(expires, (int, float)) or isinstance(expires, bool)
                or not 60 <= expires <= 31_536_000):
            raise ChatGPTAuthError()
        refresh = result.get('refresh_token', previous.get('refresh_token'))
        if refresh is not None and not _credential(refresh):
            raise ChatGPTAuthError()
        return {**previous, 'access_token': result['access_token'], 'refresh_token': refresh,
                'id_token': result.get('id_token', previous.get('id_token')),
                'scopes': scopes, 'expires_at': time.time() + expires}

    def access_token(self):
        """在事务内读最新令牌，提前60秒刷新；刷新失败不自动登录或切换API Key。"""
        with self.store.transaction() as data:
            record = data['accounts'].get(data.get('active'))
            if not record or not record.get('access_token'):
                raise ChatGPTAuthError('reauthorization_required')
            if PLAN_SCOPE not in record.get('scopes', []):
                raise ChatGPTAuthError('permission_missing')
            if record['expires_at'] <= time.time() + 60:
                if not record.get('refresh_token'):
                    raise ChatGPTAuthError('reauthorization_required')
                result = self._json('POST', TOKEN_URL, data={
                    'grant_type': 'refresh_token', 'client_id': record['client_id'],
                    'refresh_token': record['refresh_token'], 'resource': RESOURCE,
                })
                updated = self._tokens(result, record)
                if result.get('id_token'):
                    self._identity(result['id_token'], record['client_id'], subject=record['subject'])
                data['accounts'][data['active']] = record = updated
            return record['access_token']

    def ensure_authorized(self, *, interactive=False):
        """启动时复用独立授权；仅交互入口可打开浏览器，后台评测不会等待网页登录。"""
        try:
            self.access_token()
        except ChatGPTAuthError as error:
            if not interactive or error.code not in {'reauthorization_required', 'permission_missing'}:
                raise
            self.sign_in()

    def sign_in(self, *, timeout=300, open_browser=webbrowser.open):
        """打开本机账号选择页，完成一次有界授权；回调不记录URL，不返回模型凭据。"""
        with self.store.transaction() as data:
            snapshot = json.loads(json.dumps(data))
        flow = BrowserAuthorization(snapshot, open_browser)
        result = flow.run(timeout)
        selected, client_id = result['selected'], result['client_id']
        # 动态注册签发的client_id在交换失败时也保留，以免重试不断创建注册。
        if selected is None:
            with self.store.transaction() as data:
                data['pending_client_id'] = client_id
        tokens = self._json('POST', TOKEN_URL, data={
            'grant_type': 'authorization_code', 'client_id': client_id, 'code': result['code'],
            'code_verifier': result['verifier'], 'redirect_uri': result['redirect_uri'], 'resource': RESOURCE,
        })
        previous = snapshot['accounts'].get(selected)
        identity = self._identity(tokens.get('id_token'), client_id, nonce=result['nonce'],
                                  subject=previous['subject'] if previous else None)
        granted = tokens.get('scope', '').split() if isinstance(tokens.get('scope'), str) else []
        permitted = PLAN_SCOPE in granted and 'resource.invoke' in granted
        # 身份登录成功但未授予计划权限时仍保留注册，下一次沿用client_id请求授权。
        record = self._tokens(tokens) if permitted else {'id_token': tokens['id_token'], 'scopes': granted}
        record.update(client_id=client_id, subject=identity['sub'], issuer=ISSUER,
                      email=identity.get('email') if isinstance(identity.get('email'), str) else '')
        key = hashlib.sha256((ISSUER + '\0' + client_id + '\0' + identity['sub']).encode()).hexdigest()
        with self.store.transaction() as data:
            data['accounts'][key] = record
            if permitted:
                data['active'] = key
            data.pop('pending_client_id', None)
        if not permitted:
            raise ChatGPTAuthError('permission_missing')

    def sign_out(self):
        """撤销当前账号可续期会话并清本机令牌；保留注册和host标识供再次授权。"""
        confirmed = True
        with self.store.transaction() as data:
            record = data['accounts'].get(data.get('active'))
            if record and record.get('refresh_token'):
                confirmed = False
                try:
                    config = self._json('GET', ISSUER + '/.well-known/openid-configuration')
                    endpoint = config.get('revocation_endpoint', '')
                    if urlsplit(endpoint).netloc == 'auth.openai.com' and endpoint.startswith('https://auth.openai.com/'):
                        response = self.http.post(endpoint, data={'token': record['refresh_token'],
                            'token_type_hint': 'refresh_token', 'client_id': record['client_id']},
                            timeout=20, follow_redirects=False)
                        confirmed = response.status_code == 200
                except (httpx.HTTPError, ChatGPTAuthError):
                    pass
            if record:
                for name in ('access_token', 'refresh_token', 'id_token', 'expires_at', 'scopes'):
                    record.pop(name, None)
            data['active'] = None
        return confirmed


class BrowserAuthorization:
    """临时loopback页面与严格一次性回调；随机页面路径防止其他网站触发账号切换。"""

    def __init__(self, snapshot, open_browser):
        self.snapshot, self.open_browser = snapshot, open_browser
        self.launch_path = '/launch/' + secrets.token_urlsafe(32)
        self.pending, self.result, self.error = None, None, None

    def run(self, timeout):
        """监听先于浏览器启动，最多等待timeout秒，结束后释放端口。"""
        flow = self

        class Handler(BaseHTTPRequestHandler):
            """只接受当前loopback主机和固定路由；覆盖HTTP日志避免泄露授权码。"""

            def log_message(self, *_):
                pass

            def do_GET(self):
                self.connection.settimeout(2)
                expected_host = '127.0.0.1:' + str(self.server.server_port)
                if self.headers.get('Host') != expected_host or len(self.path) > 16384:
                    self.send_error(400)
                    return
                try:
                    parts = urlsplit(self.path)
                    params = parse_qs(parts.query, keep_blank_values=True, max_num_fields=12)
                    if any(len(values) != 1 for values in params.values()):
                        raise ValueError('duplicate callback field')
                    params = {key: values[0] for key, values in params.items()}
                    status, headers, body = flow.handle(parts.path, params, expected_host)
                except (ValueError, KeyError, TypeError):
                    status, headers, body = 400, {}, '本次请求无效，请回到登录页面。'
                encoded = body.encode('utf-8')
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(encoded)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Referrer-Policy', 'no-referrer')
                self.send_header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
                self.end_headers()
                self.wfile.write(encoded)

        class LoopbackServer(HTTPServer):
            """在读取HTTP请求头前设置连接时限，避免无数据连接拖住授权截止时间。"""

            def get_request(self):
                connection, address = super().get_request()
                connection.settimeout(2)
                return connection, address

        with LoopbackServer(('127.0.0.1', 0), Handler) as server:
            server.timeout = 0.5
            if not self.open_browser('http://127.0.0.1:' + str(server.server_port) + self.launch_path):
                raise ChatGPTAuthError('browser_unavailable')
            deadline = time.monotonic() + timeout
            while self.result is None and self.error is None and time.monotonic() < deadline:
                server.handle_request()
        if self.error:
            raise ChatGPTAuthError(self.error)
        if self.result is None:
            raise ChatGPTAuthError('login_timeout')
        return self.result

    def handle(self, path, params, host):
        """管理账号选择与OAuth回调；只在state匹配后一次性消费pending事务。"""
        if path == self.launch_path:
            links = []
            for index, (key, record) in enumerate(self.snapshot['accounts'].items(), 1):
                label = html.escape(record.get('email') or '已保存账号') + '（账号' + str(index) + '）'
                links.append('<p><a href="' + self.launch_path + '/login?account=' + key + '">' + label + '</a></p>')
            links.append('<p><a data-oai-siwc-button href="' + self.launch_path + '/login">Continue with ChatGPT</a></p>')
            return 200, {}, '<!doctype html><meta charset="utf-8"><title>报告助手账号授权</title><h1>连接ChatGPT账号</h1><p>仅授权本机报告助手使用您允许的订阅额度。报告访问仍由业务账号授权。</p>' + ''.join(links)
        if path == self.launch_path + '/login':
            if self.pending is not None:
                return 409, {}, '授权正在进行，请完成已打开的登录页面。'
            selected = params.get('account')
            if selected is not None and selected not in self.snapshot['accounts']:
                raise ValueError('unknown registration')
            record = self.snapshot['accounts'].get(selected, {})
            client_id = record.get('client_id') or self.snapshot.get('pending_client_id') or 'dynamic_agent_client'
            verifier = secrets.token_urlsafe(48)
            self.pending = {'state': secrets.token_urlsafe(32), 'nonce': secrets.token_urlsafe(32),
                            'verifier': verifier, 'selected': selected, 'client_id': client_id,
                            'redirect_uri': 'http://' + host + '/auth/callback'}
            query = {key: self.pending[key] for key in ('state', 'nonce', 'client_id', 'redirect_uri')}
            query.update(response_type='code', scope=SCOPES, resource=RESOURCE,
                         ext_agent_host_id=self.snapshot['host_id'], code_challenge_method='S256',
                         code_challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('='))
            if client_id == 'dynamic_agent_client':
                query['agent_name_hint'] = APP_NAME
            elif record.get('id_token'):
                query['id_token_hint'] = record['id_token']
            if client_id != 'dynamic_agent_client' and PLAN_SCOPE not in record.get('scopes', []):
                query['prompt'] = 'consent'
            return 302, {'Location': AUTHORIZE_URL + '?' + urlencode(query)}, ''
        if path == '/auth/callback':
            if (self.pending is None or self.result is not None or self.error is not None
                    or not hmac.compare_digest(params.get('state', ''), self.pending['state'])):
                return 400, {}, '登录校验未通过，请回到原登录页面。'
            pending, self.pending = self.pending, None
            if params.get('error'):
                self.error = 'authorization_denied'
                return 200, {}, '本次账号授权已取消，可以关闭此页面。'
            issued = params.get('client_id', pending['client_id'])
            if (not _credential(params.get('code')) or not _credential(issued)
                    or issued == 'dynamic_agent_client'
                    or pending['client_id'] != 'dynamic_agent_client' and issued != pending['client_id']):
                self.error = 'authorization_failed'
                return 400, {}, '授权未完成，请重新登录。'
            self.result = {**pending, 'client_id': issued, 'code': params['code']}
            return 200, {}, '登录回调已收到，正在由本机应用校验授权。请回到报告助手查看结果。'
        return 404, {}, '页面不存在。'
