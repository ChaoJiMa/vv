"""仅在127.0.0.1验证真实HTTP回调，不打开浏览器或访问任何外网。"""

import threading
from urllib.parse import parse_qs, urlencode, urlsplit
import unittest

import httpx

from report_assistant.integrations.chatgpt_auth import BrowserAuthorization


class LoopbackCallbackTests(unittest.TestCase):
    """验证Host、重复参数、错误state及回调生命周期在实际HTTP处理器中生效。"""

    def test_loopback_rejects_bad_callbacks_then_accepts_exact_once(self):
        outcomes, errors, threads = [], [], []

        def browser(url):
            def simulate_user():
                try:
                    parts = urlsplit(url)
                    base = parts.scheme + '://' + parts.netloc
                    with httpx.Client(trust_env=False, follow_redirects=False, timeout=5) as client:
                        outcomes.append(client.get(url).status_code)
                        outcomes.append(client.get(url, headers={'Host': 'untrusted.invalid'}).status_code)
                        redirect = client.get(url + '/login').headers['Location']
                        query = parse_qs(urlsplit(redirect).query)
                        callback = base + '/auth/callback'
                        params = dict(state=query['state'][0], code='synthetic-code', client_id='oaiapp_synthetic')
                        outcomes.append(client.get(callback + '?' + urlencode(params) + '&state=duplicate').status_code)
                        outcomes.append(client.get(callback, params={**params, 'state': 'wrong'}).status_code)
                        response = client.get(callback, params=params)
                        outcomes.append(response.status_code)
                        self.assertNotIn('synthetic-code', response.text)
                except Exception as error:
                    errors.append(type(error).__name__)
            thread = threading.Thread(target=simulate_user)
            threads.append(thread)
            thread.start()
            return True

        flow = BrowserAuthorization({'host_id': 'urn:uuid:synthetic', 'accounts': {}}, browser)
        result = flow.run(10)
        for thread in threads:
            thread.join(5)
            self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(outcomes, [200, 400, 400, 400, 200])
        self.assertEqual(result['client_id'], 'oaiapp_synthetic')
        self.assertEqual(result['code'], 'synthetic-code')
        self.assertIsNone(flow.pending)
