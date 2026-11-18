"""本机模型账号管理入口：浏览器登录/切换、退出或受限验证，不读取业务报告。"""

import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
from openai import APIError

from report_assistant.runtime.logging import configure_private_logging
from report_assistant.runtime.config import ModelSettings
from report_assistant.runtime.models import create_chatgpt_account, create_model_client
from report_assistant.integrations.chatgpt_auth import ChatGPTAuthError
from report_assistant.integrations.model import OPENAI_BASE_URL


def main():
    """只记录固定状态，不输出账号、授权地址、凭据、模型回包或异常正文。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sign-in', action='store_true')
    parser.add_argument('--sign-out', action='store_true')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--status-file', type=Path)
    args = parser.parse_args()
    if args.sign_in and args.sign_out:
        parser.error('登录和退出不能同时执行')
    configure_private_logging()
    load_dotenv(ROOT / '.env')

    def status(state):
        """可选原子写入脱敏状态，供本机有界等待；不保存任何OAuth参数。"""
        value = {'state': state}
        if args.status_file:
            args.status_file.parent.mkdir(parents=True, exist_ok=True)
            temporary = args.status_file.with_suffix('.tmp')
            temporary.write_text(json.dumps(value), encoding='utf-8')
            temporary.replace(args.status_file)
        print(json.dumps(value), flush=True)

    try:
        with ExitStack() as stack:
            # 账号管理独立于当前问答厂商；切回其他路线后仍能注销已授权会话。
            # 聊天的API网关不参与本应用账号维护，避免切换网关后无法注销原会话。
            settings = ModelSettings.from_env(provider='openai', auth_mode='chatgpt', base_url=OPENAI_BASE_URL)
            account = create_chatgpt_account(stack, settings)
            if args.sign_out:
                status('signed_out' if account.sign_out() else 'signed_out_remote_revocation_unconfirmed')
                return 0
            if args.sign_in:
                status('awaiting_browser_sign_in')
                account.sign_in()
            else:
                account.ensure_authorized(interactive=False)
            status('authorized')
            if args.verify:
                client = create_model_client(stack, settings, account=account)
                result = client.chat.completions.create(
                    model=settings.model,
                    messages=[{'role': 'user', 'content': '请只回复：连接正常。'}], timeout=20,
                )
                if not result.choices or result.choices[0].finish_reason != 'stop' or not result.choices[0].message.content:
                    status('inference_incomplete')
                    return 1
                status('inference_completed')
        return 0
    except ChatGPTAuthError as error:
        status(error.code)
    except APIError:
        status('inference_unavailable')
    except (OSError, ValueError, TypeError, KeyError):
        status('local_setup_unavailable')
    return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (KeyboardInterrupt, EOFError):
        sys.exit(130)
    except Exception:
        print('{"state":"authorization_failed"}', flush=True)
        sys.exit(1)
