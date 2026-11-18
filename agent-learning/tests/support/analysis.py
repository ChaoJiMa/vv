"""分析策略的独立虚构报告、模型脚本与出站断言，不导入测试模块。"""

from copy import deepcopy
import json
from types import SimpleNamespace as NS

from support import privacy as support
from report_assistant.reports.tools import LocalReportTools

def analysis_tools(value=61.25):
    """报告统计和脱敏明细可外发；四类个人信息及凭据使用虚构值。"""
    order, catalog = support.fixtures(value=value)
    order["report_data"]["report"]["person"] = {"name": "虚构张三", "idcard": "110101199001011234", "mobile": "13800000000", "address": "虚构城市幸福路九号"}
    additions = [
        (9, "非银行申请", "申请次数", "report.empty_stat", ""),
        (9, "非银行申请", "申请次数明细", "report.records", [{"name": "虚构李四", "secret": support.PRIVATE_VALUE}]),
        (9, "非银行申请", "申请次数", "report.phone_count", "13800000000"),
        (9, "非银行申请", "申请次数", "report.unsafe_stat", support.PRIVATE_VALUE),
        (9, "非银行申请", "姓名统计数量", "report.person.name", "虚构张三"),
        (9, "非银行申请", "申请次数档位", "report.band_count", "2"),
        (10, "银行申请", "申请次数", "report.bank_count", 3),
    ]
    for mid, module, name, path, data in additions:
        catalog["fields"].append({"module_id": mid, "module_name": module, "name": name, "path": path, "window": "近7天", "frontend_processing": "直接输出原值", "backend_processing": support.PRIVATE_META})
        if path.count(".") == 1:
            order["report_data"]["report"][path.split(".")[1]] = data
    order["report_data"]["template"]["modules"].append({"moduleId": 10, "moduleName": support.PRIVATE_META})
    return LocalReportTools(order, catalog)


def numeric_identity_tools(value=61.25):
    """模拟温馨版明细的短编号与统计值重合，仍不开放明细或身份路径。"""
    order, catalog = support.fixtures(value=value)
    catalog.update(theme=1, theme_name="温馨版")
    order["report_data"]["template"]["theme"] = 1
    order["report_data"]["report"]["records"] = [{"id": 1, "code": 0, "secret": support.PRIVATE_VALUE}, {"id": 12, "code": 90}, {"id": 8192, "code": 784621}, {"code": "000123"}]
    return LocalReportTools(order, catalog)


def protocol_collision_tools():
    """虚构的明细值恰好与固定提示、JSON类型、状态和调用引用重合。"""
    order, catalog = support.fixtures()
    order["report_data"]["report"]["records"] = [{"secret": value} for value in ("规则", "object", "provided", "call_")]
    return LocalReportTools(order, catalog)


def response(content=None, calls=None):
    return NS(choices=[NS(message=NS(content=content, tool_calls=calls, reasoning_content=support.PRIVATE_META), finish_reason="stop")])


def call(name, args, call_id="c1"):
    return response(support.PRIVATE_META, [NS(id=call_id, function=NS(name=name, arguments=args if isinstance(args, str) else json.dumps(args)))])


def route(kind="report", follow=False):
    return response(json.dumps({"route": kind, "use_previous": follow}))


def final(text="您的报告分数为61.25，暂时没有可确认的等级说明。", refs=("f1",)):
    return response(json.dumps({"sections": [{"text": text, "sources": list(refs)}]}, ensure_ascii=False))


class ScriptClient:
    """按脚本返回模型协议，所有请求做深拷贝以检查实际数据流。"""
    def __init__(self, script):
        self.script, self.requests = list(script), []
        self.chat = NS(completions=NS(create=self.create))

    def create(self, **kwargs):
        self.requests.append(deepcopy(kwargs))
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def report_client(refs=("f1",), text="您的报告分数为61.25，暂时没有可确认的等级说明。", follow=False):
    return ScriptClient([route(follow=follow), call("list_report_fields", {"module_ref": "all", "offset": 0}),
                         call("read_report_facts", {"field_refs": list(refs)}, "c2"), final(text, refs)])


def assert_no_private(self, requests):
    wire = json.dumps(requests, ensure_ascii=False)
    for marker in (support.PRIVATE_VALUE, support.PRIVATE_ID, "SYNTHETIC_ORDER_51948", "synthetic_score", "report.synthetic", "虚构张三", "13800000000", "110101199001011234"):
        self.assertNotIn(marker, wire)
