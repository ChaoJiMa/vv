"""统一模型资源装配；交互能力由入口显式传入，评测默认禁止弹出账号登录。"""

from zai import ZhipuAiClient

from report_assistant.integrations.chatgpt_auth import ChatGPTAccount
from report_assistant.integrations.model import (
    ChatGPTPlanClient, DeepSeekClient, OpenAIResponsesClient, model_http_client,
)


def create_chatgpt_account(stack, settings):
    """建立独立授权HTTP连接；ExitStack负责关闭，不复用模型或业务客户端。"""
    transport = stack.enter_context(model_http_client('openai', proxy_url=settings.proxy_url))
    return ChatGPTAccount(transport)


def prepare_account(stack, settings, *, interactive=False):
    """按需完成模型账号授权；主入口可在Java登录前调用，后台入口不交互。"""
    if not settings.uses_account:
        return None
    account = create_chatgpt_account(stack, settings)
    account.ensure_authorized(interactive=interactive)
    return account


def create_model_client(stack, settings, *, account=None, interactive=False):
    """统一厂商参数与资源生命周期；零SDK重试，关闭模式不创建任何客户端。"""
    if not settings.enabled:
        return None
    if not settings.model or not settings.uses_account and not settings.api_key:
        raise ValueError('外部模型未配置密钥或型号。')
    if settings.uses_account and account is None:
        account = prepare_account(stack, settings, interactive=interactive)
    transport = stack.enter_context(model_http_client(settings.provider, proxy_url=settings.proxy_url))
    if settings.provider == 'openai':
        client = (ChatGPTPlanClient(account, transport, base_url=settings.base_url) if settings.uses_account
                  else OpenAIResponsesClient(settings.api_key, transport, base_url=settings.base_url))
    elif settings.provider == 'deepseek':
        client = DeepSeekClient(settings.api_key, transport)
    elif settings.provider == 'zhipu':
        client = ZhipuAiClient(api_key=settings.api_key, base_url='https://open.bigmodel.cn/api/paas/v4',
                              http_client=transport, timeout=30.0, max_retries=0)
    else:
        raise ValueError('不支持的模型厂商。')
    return stack.enter_context(client)
