"""公共启动设施的风险回归：关闭模式、凭据隔离、授权交互与资源释放。"""

from contextlib import ExitStack
from contextlib import redirect_stdout
import io
import json
import os
import sys
from unittest.mock import MagicMock, patch

from report_assistant.runtime.config import ModelSettings
from report_assistant.runtime import models
from report_assistant.integrations.chatgpt_auth import ChatGPTAuthError
from scripts.evaluate_customer import model_client
from scripts import chatgpt_account
from support.privacy import NoExternalIO


class RuntimeTests(NoExternalIO):
    """只使用虚构配置及模拟资源，不读.env、不触碰已授权账号或外部网络。"""

    def test_disabled_mode_ignores_invalid_model_credentials_and_creates_nothing(self):
        with patch.dict(os.environ, {'REPORT_MODEL_PROVIDER': 'openai', 'OPENAI_AUTH_MODE': 'invalid',
                        'OPENAI_BASE_URL': 'invalid', 'OPENAI_API_KEY': 'SYNTHETIC_KEY'}, clear=True), \
                patch.object(models, 'model_http_client') as transport, \
                patch.object(models, 'ChatGPTAccount') as account, ExitStack() as stack:
            settings = ModelSettings.from_env(enabled=False)
            self.assertEqual(settings.api_key, '')
            self.assertIsNone(models.create_model_client(stack, settings))
            transport.assert_not_called()
            account.assert_not_called()

    def test_configuration_repr_excludes_key_and_proxy(self):
        settings = ModelSettings('openai', 'synthetic', api_key='SYNTHETIC_SECRET_KEY', proxy_url='http://127.0.0.1:7890')
        self.assertNotIn('SYNTHETIC_SECRET_KEY', repr(settings))
        self.assertNotIn('127.0.0.1', repr(settings))

    def test_account_maintenance_remains_available_when_chat_uses_another_provider(self):
        with patch.dict(os.environ, {'REPORT_MODEL_PROVIDER': 'deepseek', 'OPENAI_AUTH_MODE': 'api_key',
                        'OPENAI_MODEL': 'synthetic-openai', 'OPENAI_API_KEY': 'SYNTHETIC_UNUSED_KEY'}, clear=True):
            settings = ModelSettings.from_env(provider='openai', auth_mode='chatgpt')
        self.assertTrue(settings.uses_account)
        self.assertEqual(settings.model, 'synthetic-openai')
        self.assertEqual(settings.api_key, '')

    def test_account_logout_ignores_chat_gateway_and_does_not_start_inference(self):
        output = io.StringIO()
        with patch.dict(os.environ, {'REPORT_MODEL_PROVIDER': 'openai', 'OPENAI_AUTH_MODE': 'api_key',
                        'OPENAI_BASE_URL': 'https://synthetic-gateway.invalid/v1'}, clear=True), \
                patch.object(sys, 'argv', ['account', '--sign-out']), \
                patch.object(chatgpt_account, 'load_dotenv'), \
                patch.object(chatgpt_account, 'configure_private_logging'), \
                patch.object(chatgpt_account, 'create_chatgpt_account') as account, \
                patch.object(chatgpt_account, 'create_model_client') as inference, redirect_stdout(output):
            account.return_value.sign_out.return_value = True
            self.assertEqual(chatgpt_account.main(), 0)
        settings = account.call_args.args[1]
        self.assertEqual(settings.base_url, 'https://api.openai.com/v1')
        self.assertTrue(settings.uses_account)
        account.return_value.sign_out.assert_called_once()
        inference.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())['state'], 'signed_out')

    def test_account_config_does_not_read_any_api_key(self):
        original = os.getenv
        def guarded(name, default=None):
            if name.endswith('API_KEY'):
                self.fail('账号模式不应读取模型密钥')
            return original(name, default)
        with patch.dict(os.environ, {'REPORT_MODEL_PROVIDER': 'openai', 'OPENAI_AUTH_MODE': 'chatgpt'}, clear=True), \
                patch('os.getenv', side_effect=guarded):
            settings = ModelSettings.from_env()
        self.assertTrue(settings.uses_account)
        self.assertEqual(settings.api_key, '')

    def test_background_account_uses_separate_transports_and_never_enables_interaction(self):
        settings = ModelSettings('openai', 'synthetic', auth_mode='chatgpt', proxy_url='http://127.0.0.1:7890')
        resources = [MagicMock(), MagicMock()]
        with ExitStack() as stack, patch.object(models, 'model_http_client', side_effect=resources) as factory, \
                patch.object(models, 'ChatGPTAccount') as account, patch.object(models, 'ChatGPTPlanClient') as sdk:
            models.create_model_client(stack, settings)
            account.return_value.ensure_authorized.assert_called_once_with(interactive=False)
            self.assertIs(account.call_args.args[0], resources[0].__enter__.return_value)
            self.assertIs(sdk.call_args.args[1], resources[1].__enter__.return_value)
            self.assertEqual(factory.call_count, 2)
            self.assertIsNot(resources[0], resources[1])
        for resource in resources:
            resource.__exit__.assert_called_once()

    def test_failed_authorization_releases_transport_and_does_not_create_inference_client(self):
        settings = ModelSettings('openai', 'synthetic', auth_mode='chatgpt')
        resource = MagicMock()
        with patch.object(models, 'model_http_client', return_value=resource), \
                patch.object(models, 'ChatGPTAccount') as account, patch.object(models, 'ChatGPTPlanClient') as sdk:
            account.return_value.ensure_authorized.side_effect = ChatGPTAuthError('reauthorization_required')
            with self.assertRaises(ChatGPTAuthError), ExitStack() as stack:
                models.create_model_client(stack, settings)
            sdk.assert_not_called()
            resource.__exit__.assert_called_once()

    def test_prepared_interactive_account_is_reused_without_second_authorization(self):
        settings = ModelSettings('openai', 'synthetic', auth_mode='chatgpt')
        with ExitStack() as stack, patch.object(models, 'model_http_client'), \
                patch.object(models, 'ChatGPTAccount') as account, patch.object(models, 'ChatGPTPlanClient'):
            prepared = models.prepare_account(stack, settings, interactive=True)
            models.create_model_client(stack, settings, account=prepared)
            account.assert_called_once()
            account.return_value.ensure_authorized.assert_called_once_with(interactive=True)

    def test_evaluation_uses_same_settings_validation_before_any_transport(self):
        with patch.dict(os.environ, {'REPORT_MODEL_PROVIDER': 'openai', 'OPENAI_AUTH_MODE': 'chatgpt',
                        'OPENAI_BASE_URL': 'https://gateway.invalid'}, clear=True), \
                patch.object(models, 'model_http_client') as transport, ExitStack() as stack:
            with self.assertRaises(ValueError):
                model_client(stack)
            transport.assert_not_called()
