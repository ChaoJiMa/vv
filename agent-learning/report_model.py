"""模型协议适配：使用显式厂商或网关地址，复用受控消息，不读取业务身份或Codex登录。"""

import json
import re
from types import SimpleNamespace
from urllib.parse import urlsplit

from openai import OpenAI


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
        response = self._client.responses.create(**request)
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
