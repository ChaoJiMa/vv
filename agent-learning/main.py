"""报告查询助手：AI理解分析，程序提供当前报告内经个人信息过滤的事实。"""

from contextlib import ExitStack
import os
from pathlib import Path
import sys

from dotenv import load_dotenv

from report_assistant.integrations.history import HistoryError, HistoryStore, default_history_path
from report_assistant.integrations.api import ReportApi, ReportApiError
from report_assistant.ui.report_selection import select_report
from report_assistant.integrations.chatgpt_auth import ChatGPTAuthError
from report_assistant.runtime.config import ModelSettings
from report_assistant.runtime.models import prepare_account, create_model_client
from report_assistant.runtime.logging import configure_private_logging
from report_assistant.conversation.progress import TurnProgress
from report_assistant.conversation.session import Conversation
from report_assistant.reports.tools import LocalReportTools, UnsupportedReportTheme




def new_conversation(tools, history=None):
    """绑定一份报告创建会话；重建时清空模型上下文及本地字段选择状态。"""
    conversation = Conversation(tools, history, strategy="analysis")
    print("报告查询助手（演示数据）" if tools.is_demo else "报告查询助手（当前报告）")
    return conversation


def choose_order(api):
    """选择 Java 返回的报告，并检查本地字段资料是否支持其模板。

    接口获取成功不代表本地解释器支持该报告；模板不匹配时允许重新选择，
    并把固定原因带到下一份列表之后，紧邻输入提示显示。
    无报告或用户退出时返回 None，由启动流程或 /orders 命令结束处理。
    """
    notice = ""
    while True:
        order = select_report(api, notice=notice)
        if order is None:
            return None
        print("报告正文已读取，正在校验本地模板和字段资料……", flush=True)
        try:
            tools = LocalReportTools(order)
            print(f"已识别报告版本：{tools.theme_name}（theme={tools.theme}）。", flush=True)
            return tools
        except UnsupportedReportTheme:
            notice = (
                "暂时无法解释所选报告：尚未登记此报告版本的字段资料。"
                "请选择其他报告，或输入 exit 退出。"
            )
        except (ValueError, OSError, KeyError, TypeError):
            notice = (
                "暂时无法解释所选报告：报告正文已读取，但模板或本地字段资料校验未通过。"
                "请检查本地字段资料、选择其他报告，或输入 exit 退出。"
            )


def run_turn(client, model, conversation, question):
    """先显示接收状态，在原线程完成校验和加密保存，退出等待后返回答案。"""
    with TurnProgress():
        answer = conversation.answer(question, client, model)
    return conversation, answer


def main():
    """终端入口：加载配置 -> Java 登录/选报告 -> 创建会话 -> 处理问答。

    api 模式读取 Java 业务数据，demo 模式读取虚构本地数据；模型是否启用
    单独由 REPORT_EXTERNAL_MODEL 决定，不参与业务身份和报告访问授权。
    """
    configure_private_logging()
    # 使用入口文件旁的 .env，避免从不同目录启动时读取到别处配置。
    # load_dotenv 默认不覆盖已存在的环境变量，便于终端临时指定测试账号。
    load_dotenv(Path(__file__).with_name(".env"))
    source = os.getenv("REPORT_DATA_SOURCE", "demo").strip().lower()
    external = os.getenv("REPORT_EXTERNAL_MODEL", "off").strip().lower()
    if external not in {"off", "on"}:
        print("REPORT_EXTERNAL_MODEL 只能是 off 或 on。", file=sys.stderr)
        return 1
    try:
        settings = ModelSettings.from_env(enabled=external == 'on')
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    model, provider_name = settings.model, settings.provider_name
    api = None
    try:
        with ExitStack() as stack:
            if settings.uses_account:
                print('正在连接模型账号；首次使用请在浏览器中完成ChatGPT登录授权。', flush=True)
            # 只由交互入口允许浏览器登录；模型账号不参与Java报告授权。
            account = prepare_account(stack, settings, interactive=True)
            # 连接创建后立即注册关闭操作；提前 return 或抛异常也会按逆序释放。
            # 历史加密组件先准备好，避免业务启动成功后才发现无法安全保存问答。
            history = HistoryStore(default_history_path())
            stack.callback(history.close)
            if source == "api":
                # Java 负责验证码校验和 token 签发；Python 持有凭证后查询报告。
                print("正在连接业务服务；未配置 token 时将通过手机号登录。")
                api = ReportApi.from_env()
                stack.callback(api.close)
                print("业务登录凭证已就绪，正在获取当前账号报告。")
                tools = choose_order(api)
                if tools is None:
                    return 0
            elif source == "demo":
                # 演示模式独立运行，不要求手机号、业务 token 或模型密钥。
                tools = LocalReportTools.demo()
            else:
                raise ValueError("数据来源不受支持。")
            client = create_model_client(stack, settings, account=account)
            conversation = new_conversation(tools, history)
            print(f"问题及按需读取的报告内容会发送至{provider_name}（{model}）；姓名、证件、手机号、地址已过滤。" if client else "当前根据已选报告回答您的问题。")
            print("您好，我是小贝。请直接告诉我您想了解的报告内容。", flush=True)
            while True:
                # input收到完整一行才进入问答；明确回车操作，便于区分未发送与处理等待。
                question = input("\n请输入问题（回车发送）：").strip()
                if question.lower() in {"exit", "quit", "退出"}:
                    break
                if question == "/orders" and api:
                    # 报告更换后重建整个 Conversation，避免旧话题和字段串入新报告。
                    tools = choose_order(api)
                    if tools is None:
                        break
                    conversation = new_conversation(tools, history)
                    continue
                if question == "/history":
                    # 完整历史只解密给本地终端查看，不传给模型或业务接口。
                    records = history.read(conversation.tools.history_scope)
                    if not records:
                        print("当前报告暂无本地历史。")
                    for entry in records:
                        print(f"\n用户：{entry['question']}\n助手：{entry['answer']}")
                    continue
                try:
                    _, answer = run_turn(client, model, conversation, question)
                    print(f"\n助手：{answer}", flush=True)
                except HistoryError:
                    print("本轮历史保存失败，已停止处理；不会改用明文历史。", file=sys.stderr, flush=True)
                    return 1
                except (ValueError, OSError, KeyError, TypeError):
                    print("本轮本地查询失败，请检查问题或字段资料；不会将错误内容发送给模型。", file=sys.stderr, flush=True)
    except (ReportApiError, ChatGPTAuthError) as error:
        # 仅显示客户端定义的固定提示，不输出服务端消息或请求内容。
        print(str(error), file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError, HistoryError):
        print("本地报告、连接配置或加密历史不可用，请在本地检查；详细内容不会写入日志。", file=sys.stderr)
        return 1
    print("已退出。")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (KeyboardInterrupt, EOFError):
        print("\n已退出。")
    except Exception:
        # CLI 最外层也不输出携带配置、URL或响应正文的 SDK traceback。
        print("程序已安全停止，请在本地检查配置和依赖。", file=sys.stderr)
        sys.exit(1)
