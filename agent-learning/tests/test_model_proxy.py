"""OpenAI显式网络代理回归：环境隔离、凭据拒绝及业务客户端不受影响。"""
from contextlib import redirect_stdout, redirect_stderr
import io
import os
import unittest
from unittest.mock import patch

import main
from report_assistant.integrations.model import model_http_client, openai_proxy_url
from report_assistant.integrations.api import ReportApi
from scripts.evaluate_customer import fingerprint


class ModelProxyTests(unittest.TestCase):
    """全部使用虚构代理和mock客户端，不读本机配置或发起网络请求。"""

    def test_only_openai_receives_the_explicit_proxy(self):
        for provider in ('openai', 'zhipu', 'deepseek'):
            with self.subTest(provider=provider), patch('httpx.Client') as client:
                model_http_client(provider, proxy_url='http://127.0.0.1:7890')
                options = {'trust_env': False, 'follow_redirects': False, 'timeout': 30.0}
                if provider == 'openai':
                    options['proxy'] = 'http://127.0.0.1:7890'
                client.assert_called_once_with(**options)

    def test_environment_proxy_is_never_implicitly_enabled(self):
        with patch.dict(os.environ, {'HTTPS_PROXY': 'http://untrusted.invalid:8080'}, clear=True), \
                patch('httpx.Client') as client:
            model_http_client('openai')
            self.assertFalse(client.call_args.kwargs['trust_env'])
            self.assertNotIn('proxy', client.call_args.kwargs)

    def test_invalid_proxy_is_rejected_without_echoing_credentials(self):
        self.assertIsNone(openai_proxy_url(''))
        for value in ('http://user:SYNTHETIC_SECRET@127.0.0.1:7890', 'http://127.0.0.1:7890/path',
                      'http://127.0.0.1:7890?key=SYNTHETIC_SECRET', 'file:///tmp/proxy',
                      'http://127.0.0.1:0', 'http://127.0.0.1:7890\n', True):
            with self.subTest(value_type=type(value).__name__):
                with self.assertRaises(ValueError) as error:
                    openai_proxy_url(value)
                self.assertNotIn('SYNTHETIC_SECRET', str(error.exception))

    def test_invalid_proxy_stops_before_business_login(self):
        env = {'REPORT_EXTERNAL_MODEL': 'on', 'REPORT_MODEL_PROVIDER': 'openai',
               'REPORT_DATA_SOURCE': 'api', 'OPENAI_MODEL': 'synthetic-model',
               'OPENAI_PROXY_URL': 'http://u:SYNTHETIC_SECRET@127.0.0.1:7890'}
        with patch.dict(os.environ, env, clear=True), patch.object(main, 'load_dotenv'), \
                patch.object(main, 'ReportApi') as api, patch.object(main, 'configure_private_logging'), \
                redirect_stdout(io.StringIO()) as output, redirect_stderr(output):
            self.assertEqual(1, main.main())
            api.assert_not_called()
            self.assertNotIn('SYNTHETIC_SECRET', output.getvalue())

    def test_proxy_configuration_changes_evaluation_version(self):
        with patch.dict(os.environ, {'OPENAI_PROXY_URL': ''}):
            original = fingerprint()
        with patch.dict(os.environ, {'OPENAI_PROXY_URL': 'http://127.0.0.1:7890'}):
            self.assertNotEqual(original, fingerprint())

    def test_business_client_ignores_openai_proxy(self):
        with patch.dict(os.environ, {'OPENAI_PROXY_URL': 'http://127.0.0.1:7890'}), \
                patch('httpx.Client') as client:
            api = ReportApi('https://synthetic-business.invalid', 'SYNTHETIC_BUSINESS_TOKEN')
            self.assertFalse(client.call_args.kwargs['trust_env'])
            self.assertNotIn('proxy', client.call_args.kwargs)
            api.close()
