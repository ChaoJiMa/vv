"""模型协议适配：隔离厂商密钥与本应用账号授权，复用受控消息，不读取Codex登录。"""

import json
import re
import time
import httpx
from types import SimpleNamespace
from urllib.parse import urlsplit

from openai import OpenAI, APIStatusError, APITimeoutError


DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_DEFAULT_MODEL = "deepseek-flash"
OPENAI_BASE_URL = "https://api.openai.com/v1"
OPENAI_DEFAULT_MODEL = "gpt-6.1-sol"


def openai_base_url(value=None):
    """校验操作者显式配置的API基础地址；空值使用官方地址，错误不回显原始值。

    兼容用户指定的HTTP网关，不将用户名、查询参数或片段作为凭据入口。
    模型消息不能指定此地址；调用方须在业务登录前完成检查。
    """
    message = "OPENAI_BASE_URL须为不含内嵌凭据、查询串或片段的HTTP(S)基础地址。"
    if value is not None and not isinstance(value, str):
        raise ValueError(message)
    raw = value or ""
    if re.search(r"[\x00-\x1f\x7f]", raw):
        raise ValueError(message)
    value = raw.strip() or OPENAI_BASE_URL
    try:
        parts = urlsplit(value)
        if (parts.scheme not in {"http", "https"} or not parts.hostname
                or parts.username is not None or parts.password is not None
                or "?" in value or "#" in value or re.search(r"\s|\\", value)
                or parts.port == 0):
            raise ValueError(message)
    except ValueError:
        raise ValueError(message) from None
    return value.rstrip("/")


def openai_proxy_url(value=None):
    """校验显式网络代理地址；不接收凭据、路径或查询串，不自动采用系统代理。

    网络代理只转发HTTPS连接，不改变官方API基础地址或目标模型。
    错误使用固定提示，避免把操作者填写的敏感URL带入终端或日志。
    """
    message = 'OpenAI网络代理地址格式无效。'
    if value is None or isinstance(value, str) and not value.strip():
        return None
    if not isinstance(value, str) or re.search(r'[\x00-\x20\x7f\\]', value):
        raise ValueError(message)
    try:
        parts = urlsplit(value)
        if (parts.scheme not in {'http', 'https'} or not parts.hostname or not parts.port
                or parts.username is not None or parts.password is not None
                or parts.path not in {'', '/'} or '?' in value or '#' in value):
            raise ValueError(message)
    except ValueError:
        raise ValueError(message) from None
    return value.rstrip('/')


def model_http_client(provider, *, proxy_url=None, timeout=30.0):
    """创建模型专属HTTP客户端；代理仅限显式OpenAI配置，始终保留TLS校验与环境隔离。"""
    options = {'trust_env': False, 'follow_redirects': False, 'timeout': timeout}
    if provider == 'openai':
        proxy = openai_proxy_url(proxy_url)
        if proxy:
            options['proxy'] = proxy
    return httpx.Client(**options)


class IsolatedOpenAI(OpenAI):
    """禁止 SDK 环境变量注入业务凭据、自定义鉴权头或其他项目的组织标识。"""

    @property
    def default_headers(self):
        """模型请求只携带显式传入的 API key，不继承 OPENAI_CUSTOM_HEADERS。"""
        return {"Accept": "application/json", "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}"}


class DeepSeekClient:
    """将现有 chat.completions 调用适配至官方兼容接口；资源由入口统一关闭。"""

    def __init__(self, api_key, http_client):
        """仅接受模型密钥和独立 HTTP 客户端，禁止通过环境变量更换模型出口。"""
        self._client = IsolatedOpenAI(
            api_key=api_key, base_url=DEEPSEEK_BASE_URL,
            http_client=http_client, max_retries=0, timeout=30.0,
        )
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **options):
        """保留消息、工具及 JSON 约束；把厂商扩展移到 SDK 的 extra_body 中。

        现有工具循环不转发思维链，因此只使用非思考模式；不能静默开启需要回传
        reasoning_content 的模式。超时留作 SDK 请求选项，不作为 JSON 字段外发。
        """
        thinking = options.pop("thinking", {"type": "disabled"})
        if thinking != {"type": "disabled"}:
            raise ValueError("DeepSeek 当前仅支持非思考模式。")
        return self._client.chat.completions.create(
            **options, extra_body={"thinking": {"type": "disabled"}},
        )

    def __enter__(self):
        """供 ExitStack 登记退出操作，即使启动或问答失败也释放连接。"""
        return self

    def __exit__(self, *_):
        """关闭 SDK 所持连接；不记录响应、请求头或异常正文。"""
        self._client.close()


class OpenAIResponsesClient:
    """使用 GPT-6.1 Sol 的 Responses API，对外保持现有会话的工具消息接口。"""

    def __init__(self, api_key, http_client, *, base_url=None):
        """使用显式基础地址和API key，省略地址时用官方出口；不读取Codex凭据。"""
        self._client = IsolatedOpenAI(
            api_key=api_key, base_url=openai_base_url(base_url), http_client=http_client,
            max_retries=0, timeout=90.0,
        )
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _input(self, messages):
        """把已校验的工具执行记录重建成普通消息，逐请求重新推理。

        不续接供应商响应或回传任何 reasoning item。工具历史是本地生成的调用引用、
        已批准参数和受控结果摘要，不携带原始响应 ID、思维链或完整问答历史。
        因而不把缺失 reasoning item 的历史伪装为供应商的 function_call_output。
        """
        result = []
        for message in messages:
            if message["role"] == "tool":
                result.append({"role": "user", "content": json.dumps({
                    "executed_tool_result": {"call_id": message["tool_call_id"], "output": message["content"]},
                }, ensure_ascii=False)})
            elif message.get("tool_calls"):
                result.append({"role": "assistant", "content": json.dumps({
                    "executed_tool_calls": [{"call_id": call["id"],
                                             "name": call["function"]["name"],
                                             "arguments": call["function"]["arguments"]}
                                            for call in message["tool_calls"]],
                }, ensure_ascii=False)})
            else:
                result.append({"role": message["role"], "content": message["content"]})
        return result

    def _create(self, **options):
        """转换请求参数及工具定义，只返回正文和待本地校验的函数调用。

        Sol 不支持关闭推理；使用 low、8192 tokens，不发送智谱/DeepSeek 的 thinking。
        网络预算沿用调用方：路由和具体问题30秒、整份分析90秒，未指定时默认90秒。
        store=false 关闭响应存储，不代表服务商承诺零留存。
        """
        request = {"model": options["model"], "input": self._input(options["messages"]),
                   "store": False, "stream": False, "reasoning": {"effort": "low"},
                   "max_output_tokens": 8192, "timeout": options.get("timeout", 90.0)}
        if options.get("tools"):
            # 所有工具 schema 已具备严格模式必需的 required / additionalProperties。
            request.update(tools=[{"type": "function", **tool["function"], "strict": True}
                                  for tool in options["tools"]], tool_choice="auto")
        if options.get("response_format"):
            request["text"] = {"format": options["response_format"]}
            if options["response_format"].get("type") == "json_object":
                # 显式提供固定JSON格式提示，兼容只检查user输入的网关。
                # 原问题和投影JSON保持原样；不把网关异常或响应内容加进下一次请求。
                index = next((i for i, item in enumerate(request["input"]) if item["role"] == "user"), len(request["input"]))
                request["input"].insert(index, {"role": "user", "content": "Return a JSON object."})
        response = self._complete(request)
        return self._translate(response)

    def _complete(self, request):
        """API Key模式沿用非流式Responses；账号模式覆盖此协议边界。"""
        return self._client.responses.create(**request)

    def _translate(self, response):
        """仅从完整响应提取正文与受控函数调用，不向客户暴露推理或半截答案。"""
        if response.status != "completed" or response.error:
            return SimpleNamespace(choices=[])
        texts, calls, refused = [], [], False
        for item in response.output:
            if item.type == "function_call":
                calls.append(SimpleNamespace(id=item.call_id, function=SimpleNamespace(
                    name=item.name, arguments=item.arguments,
                )))
            elif item.type == "message":
                for part in item.content:
                    if part.type == "output_text":
                        texts.append(part.text)
                    elif part.type == "refusal":
                        refused = True
            elif item.type != "reasoning":
                # 本项目只开放本地只读函数，不接受网页、文件或其他外部执行结果。
                return SimpleNamespace(choices=[])
        return SimpleNamespace(choices=[SimpleNamespace(
            finish_reason="content_filter" if refused else "stop",
            message=SimpleNamespace(content="".join(texts), tool_calls=calls or None),
        )])

    def __enter__(self):
        """由入口的 ExitStack 管理连接生命周期。"""
        return self

    def __exit__(self, *_):
        """退出时关闭 SDK，不缓存模型响应或推理内容。"""
        self._client.close()


class ChatGPTPlanClient(OpenAIResponsesClient):
    """官方ChatGPT计划授权适配；每次只从本应用凭据管理器取得访问令牌。"""

    def __init__(self, account, http_client, *, base_url=None):
        """固定官方出口，禁止把OAuth令牌发给兼容网关；不读取OPENAI_API_KEY。"""
        if openai_base_url(base_url) != OPENAI_BASE_URL:
            raise ValueError('ChatGPT账号授权仅支持官方模型接口。')
        self.account = account
        super().__init__('chatgpt-plan-no-api-key', http_client, base_url=OPENAI_BASE_URL)

    def _complete(self, request):
        """使用预览支持的流式协议；完成前丢弃增量，失败和断流不伪装成功。

        不支持服务端max_output_tokens，改以原请求时限、事件数与输出字节上限中止，
        不增加会话请求/工具预算；客户端限额不能保证服务端用量精确封顶。
        """
        from report_assistant.integrations.chatgpt_auth import ChatGPTAuthError
        try:
            token = self.account.access_token()
        except ChatGPTAuthError:
            # 复用业务层已有服务故障保护；异常中不含原授权错误或任何令牌。
            self._service_error(401)
        request = {**request, 'stream': True}
        request.pop('max_output_tokens', None)
        request['input'] = [{**item, 'role': 'developer' if item['role'] == 'system' else item['role']}
                            for item in request['input']]
        if request.get('tools'):
            request['tools'] = [{'type': 'namespace', 'name': 'report_assistant',
                                 'description': '当前报告的受控本地只读工具', 'tools': request['tools']}]
        request['extra_headers'] = {'Authorization': 'Bearer ' + token}
        started, size, completed = time.monotonic(), 0, None
        with self._client.responses.create(**request) as stream:
            for count, event in enumerate(stream, 1):
                if time.monotonic() - started > request['timeout']:
                    raise APITimeoutError(request=httpx.Request('POST', OPENAI_BASE_URL + '/responses'))
                # 只计量事件，不写出原事件、思维链、原始错误或增量答案。
                size += len(event.model_dump_json().encode('utf-8'))
                if count > 4096 or size > 2_000_000:
                    self._service_error(502)
                if event.type in {'response.failed', 'error'}:
                    self._service_error(429)
                if event.type == 'response.incomplete':
                    return SimpleNamespace(status='incomplete', error=None, output=[])
                if event.type == 'response.completed':
                    completed = event.response
                    break
        if completed is None:
            self._service_error(502)
        for item in completed.output:
            if item.type == 'function_call' and (
                    getattr(item, 'namespace', None) not in {None, 'report_assistant'}
                    or getattr(item, 'status', None) in {'in_progress', 'incomplete'}):
                self._service_error(502)
        return completed

    def _service_error(self, status):
        """使用固定SDK错误接入既有停止保护，不将远端错误或授权信息交给会话层。"""
        response = httpx.Response(status, request=httpx.Request('POST', OPENAI_BASE_URL + '/responses'))
        raise APIStatusError('模型账号或服务暂不可用。', response=response, body=None) from None


def openai_auth_mode(value=None):
    """启动配置选择账号或API Key；未配置沿用旧调用者，当前本机显式切为账号模式。"""
    mode = (value or 'api_key').strip().lower()
    if mode not in {'api_key', 'chatgpt'}:
        raise ValueError('OpenAI授权方式配置无效。')
    return mode
