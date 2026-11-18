"""整份总结的纯虚构目录和模型脚本，供各边界测试独立使用。"""

from copy import deepcopy
import json
from types import SimpleNamespace as NS
from support import analysis, privacy as support
from report_assistant.reports.tools import LocalReportTools

def overview_tools(count=3, fields=1, reverse=False):
    """构造模块目录与模板顺序可独立变化的虚构报告，不读取真实数据文件。"""
    order, catalog = support.fixtures(61.25)
    catalog["fields"] = []
    modules, report = [], order["report_data"]["report"]
    for i in range(count):
        mid, name = i + 20, "测试模块" + chr(65 + i % 26)
        modules.append({"moduleId": mid, "moduleName": name})
        for j in range(fields):
            key = f"item_{i}_{j}"
            report[key] = i + j
            catalog["fields"].append({"module_id": mid, "module_name": name,
                                      "name": "申请次数", "path": "report." + key, "window": "近7天", "frontend_processing": "直接输出原值"})
    order["report_data"]["template"]["modules"] = modules[::-1] if reverse else modules
    return LocalReportTools(order, catalog)


class OverviewClient:
    """根据实际批准的输入生成协议响应，可在边界注入失败或不可信输出。"""

    def __init__(self, mutate=None):
        self.requests, self.mutate = [], mutate
        self.chat = NS(completions=NS(create=self.create))

    def create(self, **options):
        self.requests.append(deepcopy(options))
        try:
            payload = json.loads(options["messages"][-1]["content"])
        except ValueError:
            payload = {}
        if not payload.get("modules"):
            stage = "route"
            value = {"route": "report", "use_previous": False, "scope": "overview"}
        elif "facts" in payload["modules"][0]:
            stage = "modules"
            value = {"modules": [{"module_ref": m["module_ref"],
                                  "text": "本模块登记了申请信息，可结合周期变化了解申请情况。",
                                  "sources": [f["field_ref"] for f in m["facts"]]}
                                 for m in reversed(payload["modules"])]}
        else:
            stage = "summary"
            value = {"text": "综合各模块，主要可关注申请记录及周期变化，未提供的信息仍需进一步核对。",
                     "sources": payload["modules"][0]["sources"]}
        if self.mutate:
            value = self.mutate(stage, value, payload, len(self.requests))
        return analysis.response(json.dumps(value, ensure_ascii=False))
