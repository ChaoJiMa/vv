"""虚构报告、禁止外部IO的测试基类与敏感输出断言；不包含测试用例。"""

from copy import deepcopy
import json
import logging
from pathlib import Path
import socket
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

from report_assistant.reports.tools import LocalReportTools

PRIVATE_VALUE = "SYNTHETIC_PRIVATE_VALUE_93641"


PRIVATE_META = "SYNTHETIC_PRIVATE_METADATA_86529"


PRIVATE_ID = "SYNTHETIC_PRIVATE_REPORT_73416"


def fixtures(value=PRIVATE_VALUE, report_id=PRIVATE_ID):
    catalog = {"theme": 3, "source": PRIVATE_META, "fields": [
        {"module_id": 5, "module_name": "测试指数模块", "name": "分析指数", "path": "report.synthetic_score", "window": "", "frontend_processing": "直接输出原值；" + PRIVATE_META},
        {"module_id": 9, "module_name": "非银行申请", "name": "非银行申请次数", "path": "report.synthetic_D7_COUNT", "window": "近7天"},
        {"module_id": 9, "module_name": "非银行申请", "name": "非银行申请次数", "path": "report.synthetic_M1_COUNT", "window": "近1月"},
        {"module_id": 9, "module_name": "非银行申请", "name": "非银行申请次数", "path": "report.synthetic_M12_COUNT", "window": "近1年"},
        {"module_id": 999, "module_name": "未授权模块", "name": "隐藏字段", "path": "report.hidden", "window": ""},
    ]}
    order = {"order_id": "SYNTHETIC_ORDER_51948", "report_id": report_id, "is_demo": False, "note": PRIVATE_META,
             "report_data": {"report": {"synthetic_score": value, "synthetic_D7_COUNT": 0, "synthetic_M1_COUNT": None, "hidden": "HIDDEN_SECRET"},
                             "template": {"theme": 3, "config": {"private": PRIVATE_META}, "modules": [
                                 {"moduleId": 5, "moduleName": PRIVATE_META}, {"moduleId": 9, "moduleName": "本地申请模块"},
                             ]}}}
    # 虚构页面明确为直出；生产目录未知规则不允许通过测试兼容默认成直出。
    for field in catalog["fields"]:
        field.setdefault("frontend_processing", "直接输出原值")
    return order, catalog


class FakeClient:
    def __init__(self, template="{{local_result}}", mutate=None, failure=None):
        self.requests = []
        self.template = template
        self.mutate = mutate
        self.failure = failure
        self.chat = NS(completions=NS(create=self.create))

    def create(self, **kwargs):
        self.requests.append(deepcopy(kwargs))
        if self.failure:
            raise self.failure
        if kwargs["messages"][-1]["role"] == "user":
            args = json.loads(kwargs["messages"][-1]["content"])
            if self.mutate:
                args = self.mutate(args)
            calls = [NS(id="synthetic_call_1", function=NS(name="query_current_report", arguments=json.dumps(args)))]
            return NS(choices=[NS(message=NS(tool_calls=calls, content=None, reasoning_content=PRIVATE_META))])
        return NS(choices=[NS(message=NS(tool_calls=None, content=self.template))])


class NoExternalIO(unittest.TestCase):
    def setUp(self):
        # 测试路径一旦尝试真实网络或读取 .env/data，就直接失败。
        self.addCleanup(patch.stopall)
        patch.object(socket.socket, "connect", side_effect=AssertionError("Network is forbidden in tests")).start()
        original = Path.read_text

        def guarded_read(path, *args, **kwargs):
            if path.name.startswith(".env") or "data" in path.parts:
                raise AssertionError("Configuration and report files are forbidden in tests")
            return original(path, *args, **kwargs)

        patch.object(Path, "read_text", guarded_read).start()

    def tools(self, **kwargs):
        return LocalReportTools(*fixtures(**kwargs))


def assert_private_absent(self, requests):
    outbound = json.dumps(requests, ensure_ascii=False)
    for marker in (PRIVATE_VALUE, PRIVATE_META, PRIVATE_ID, "SYNTHETIC_ORDER_51948", "synthetic_score", "report.synthetic", "HIDDEN_SECRET"):
        self.assertNotIn(marker, outbound)


def preserve_loggers(self):
    names = {"httpx", "httpcore", "zai", "zai.core._http_client", "httpcore.connection"}
    names.update(name for name in logging.root.manager.loggerDict
                 if name.startswith(("httpx.", "httpcore.", "zai.")))
    for name in names:
        logger = logging.getLogger(name)
        handlers, level, propagate, disabled = logger.handlers[:], logger.level, logger.propagate, logger.disabled

        def restore(logger=logger, handlers=handlers, level=level, propagate=propagate, disabled=disabled):
            logger.handlers = handlers
            logger.setLevel(level)
            logger.propagate = propagate
            logger.disabled = disabled

        self.addCleanup(restore)
