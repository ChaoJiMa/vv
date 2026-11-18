"""将操作者环境配置解析为不可变模型设置，入口和评测使用同一校验规则。"""

from dataclasses import dataclass, field
import os
from typing import Optional

from report_assistant.integrations.model import (
    DEEPSEEK_DEFAULT_MODEL, OPENAI_DEFAULT_MODEL, OPENAI_BASE_URL,
    openai_auth_mode, openai_base_url, openai_proxy_url,
)


@dataclass(frozen=True)
class ModelSettings:
    """显式启动设置；密钥不参与repr，账号模式不读取API Key，不携带业务身份。"""

    provider: str
    model: str
    enabled: bool = True
    auth_mode: str = 'api_key'
    base_url: str = OPENAI_BASE_URL
    proxy_url: Optional[str] = field(default=None, repr=False)
    api_key: str = field(default='', repr=False)

    @classmethod
    def from_env(cls, *, enabled=True, provider=None, auth_mode=None, base_url=None):
        """只读取当前进程环境；账号维护可显式选OpenAI，不受当前聊天厂商影响。

        不加载.env；关闭模型时不校验或启用任何模型连接。显式覆盖仅由程序入口
        指定，不接受用户问题或模型参数，账号模式始终不读取API Key。
        base_url覆盖仅供固定官方账号维护使用；普通问答不覆盖操作者配置。
        """
        provider = (provider if provider is not None else os.getenv('REPORT_MODEL_PROVIDER', 'zhipu')).strip().lower()
        names = {'openai': ('OPENAI_API_KEY', 'OPENAI_MODEL', OPENAI_DEFAULT_MODEL),
                 'deepseek': ('DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', DEEPSEEK_DEFAULT_MODEL),
                 'zhipu': ('ZHIPU_API_KEY', 'ZHIPU_MODEL', 'glm-5.3-flash')}
        if provider not in names:
            if enabled:
                raise ValueError('REPORT_MODEL_PROVIDER 只能是 zhipu、deepseek 或 openai。')
            return cls(provider, '', enabled=False)
        key_name, model_name, default = names[provider]
        mode, base, proxy = 'api_key', OPENAI_BASE_URL, None
        if enabled and provider == 'openai':
            mode = openai_auth_mode(auth_mode if auth_mode is not None else os.getenv('OPENAI_AUTH_MODE'))
            base = openai_base_url(base_url if base_url is not None else os.getenv('OPENAI_BASE_URL'))
            proxy = openai_proxy_url(os.getenv('OPENAI_PROXY_URL'))
            if mode == 'chatgpt' and base != OPENAI_BASE_URL:
                raise ValueError('ChatGPT账号授权仅支持官方模型接口。')
        key = os.getenv(key_name, '').strip() if enabled and mode != 'chatgpt' else ''
        return cls(provider, os.getenv(model_name, default).strip(), enabled, mode, base, proxy, key)

    @property
    def uses_account(self):
        """账号授权只属于启用中的OpenAI模型，不影响Java报告登录。"""
        return self.enabled and self.provider == 'openai' and self.auth_mode == 'chatgpt'

    @property
    def provider_name(self):
        """向用户准确说明内容外发对象，不回显地址、账号或其他配置。"""
        if self.uses_account:
            return 'OpenAI（ChatGPT账号授权）'
        if self.provider == 'openai':
            return 'OpenAI' if self.base_url == OPENAI_BASE_URL else 'OpenAI兼容网关'
        return {'deepseek': 'DeepSeek', 'zhipu': '智谱'}.get(self.provider, '')
