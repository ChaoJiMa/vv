"""真实SDK的内存HTTP协议辅助器；混入类不继承TestCase，不参与用例发现。"""

from contextlib import ExitStack
import json
import httpx
from report_assistant.integrations.model import DEEPSEEK_DEFAULT_MODEL, OPENAI_DEFAULT_MODEL, DeepSeekClient, OpenAIResponsesClient

class DeepSeekProtocol:
    """虚构凭据和内存传输构造器，不进行外网访问。"""

    def client(self, handler):
        """使用固定官网 URL 与内存传输，退出测试时统一释放 SDK 和 HTTP 连接。"""
        stack = ExitStack()
        self.addCleanup(stack.close)
        transport = stack.enter_context(httpx.Client(
            transport=httpx.MockTransport(handler), trust_env=False, follow_redirects=False,
        ))
        return stack.enter_context(DeepSeekClient("SYNTHETIC_DEEPSEEK_KEY", transport))

    def response(self, result):
        """将已有脚本响应转成真实 SDK 可解析的 HTTP JSON，不手写另一套工具协议。"""
        body = json.loads(json.dumps(result, default=vars))
        body.update(id="synthetic", created=1, model=DEEPSEEK_DEFAULT_MODEL)
        for choice in body["choices"]:
            choice.update(index=0)
            choice["message"]["role"] = "assistant"
            for call in choice["message"].get("tool_calls") or []:
                call["type"] = "function"
        return httpx.Response(200, json=body)


class OpenAIProtocol:
    """虚构凭据和内存传输构造器，不进行外网访问。"""

    def client(self, handler, base_url=None):
        """创建显式OpenAI出口，网络仅由内存handler接收。"""
        stack = ExitStack()
        self.addCleanup(stack.close)
        transport = stack.enter_context(httpx.Client(
            transport=httpx.MockTransport(handler), trust_env=False, follow_redirects=False,
        ))
        return stack.enter_context(OpenAIResponsesClient("SYNTHETIC_OPENAI_KEY", transport, base_url=base_url))

    def response(self, result):
        """把既有脚本工具响应转换为 Responses 格式，并附上必须丢弃的推理内容。"""
        message = result.choices[0].message
        output = [{"type": "reasoning", "id": "rs_synthetic", "summary": [],
                   "encrypted_content": "SYNTHETIC_PRIVATE_REASONING"}]
        for call in message.tool_calls or []:
            output.append({"type": "function_call", "id": "fc_" + call.id, "call_id": call.id,
                           "name": call.function.name, "arguments": call.function.arguments, "status": "completed"})
        if message.content is not None:
            output.append({"type": "message", "id": "msg_synthetic", "role": "assistant", "status": "completed",
                           "content": [{"type": "output_text", "text": message.content, "annotations": []}]})
        return httpx.Response(200, json={"id": "resp_synthetic", "object": "response", "created_at": 1,
                                        "model": OPENAI_DEFAULT_MODEL, "status": "completed", "error": None, "output": output})
