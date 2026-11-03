"""四类个人信息边界回归；只使用虚构报告、脚本模型与 SDK 内存传输。"""

from copy import deepcopy
import json
from types import SimpleNamespace as NS

import httpx

import test_analysis as analysis
import test_model_provider as providers
import test_privacy as support
from report_model import DEEPSEEK_DEFAULT_MODEL
from report_projection import FactProjection, QuestionGuard
from report_tools import LocalReportTools
from report_session import Conversation


def scope_fixture():
    """包含非统计文字、案件对象、数组路径和业务缩写个人字段，覆盖真实读取形态。"""
    order, catalog = support.fixtures(61.25)
    report = order["report_data"]["report"]
    report.update({
        "person": {"name": "虚构甲姓名", "certNo": "A1234567", "mobile": "13800000000", "address": "虚构路十二号", "education": "本科", "marriage": "已婚"},
        "details": [{"personName": "虚构乙姓名", "idNumber": "110101199001011234", "tel": "13900000000", "homeAddress": "虚构街八号", "caseNo": "CASE-784621", "amount": 12500.5, "closed": False,
                     "court": {"name": "虚构示例法院"}, "company": {"name": "虚构示例公司", "owner": {"name": "虚构辛姓名", "education": "本科"}}, "note": "虚构甲姓名，已婚，本科；材料已核验"}],
        "summary": "姓名：陌生虚构丙；地址：虚构巷三号；手机号：13700000000；案件待核验",
        "personList": [{"pname": "虚构丁姓名", "age": 30}, "虚构戊姓名"],
        "encoded": json.dumps({"name": "虚构己姓名", "education": "硕士", "caseNo": "CASE-225566"}),
        "opaque": "虚构庚姓名",
        "copy": "虚构庚姓名的案件状态：已结案",
        "email": "synthetic@example.test",
        "website": "https://synthetic.invalid",
        "reportNo": "900012345678901234",
    })
    fields = [
        ("学历", "report.person.education"), ("婚姻", "report.person.marriage"),
        ("案件明细", "report.details"), ("案件金额", "report.details[].amount"),
        ("说明", "report.summary"), ("相关人员", "report.personList"),
        ("附加资料", "report.encoded"), ("姓名", "report.opaque"),
        ("办理情况", "report.copy"), ("邮箱", "report.email"), ("网站", "report.website"),
        ("报告编号", "report.reportNo"), ("学历候选", "report.absent|report.person.education"),
    ]
    for name, path in fields:
        catalog["fields"].append({"module_id": 9, "module_name": "报告信息", "name": name, "path": path,
                                  "frontend_processing": "直接输出原值", "description": "状态和明细按报告原文解释，不推断审批；虚构庚姓名"})
    return order, catalog


class ReportScopeTests(support.NoExternalIO):
    def projection(self):
        """返回本轮可用投影，所有输入均在内存构造。"""
        tools = LocalReportTools(*scope_fixture())
        return FactProjection(tools, QuestionGuard(tools))

    def read_named(self, projection, name):
        """通过公开字段名选择引用，避免让测试依赖新增字段的内部顺序。"""
        ref = next(ref for ref, item in projection.fields.items() if item["public"]["name"] == name)
        return projection.read([ref])[0]

    def assert_filtered(self, data):
        wire = json.dumps(data, ensure_ascii=False)
        for value in ("虚构甲姓名", "虚构乙姓名", "虚构丁姓名", "虚构戊姓名", "虚构己姓名", "虚构庚姓名", "虚构辛姓名", "陌生虚构丙", "虚构路十二号", "虚构街八号", "虚构巷三号", "A1234567", "110101199001011234", "13800000000", "13900000000", "13700000000"):
            self.assertNotIn(value, wire)

    def test_nonstatistical_report_fields_are_available(self):
        p = self.projection()
        for name, expected in (("学历", "本科"), ("婚姻", "已婚"), ("邮箱", "synthetic@example.test"), ("网站", "https://synthetic.invalid"), ("报告编号", "900012345678901234")):
            with self.subTest(name=name):
                fact = self.read_named(p, name)
                self.assertEqual(fact["status"], "provided")
                self.assertEqual(fact["value"], expected)
        self.assertNotIn("姓名", [item["public"]["name"] for item in p.fields.values()])

    def test_nested_details_keep_case_amount_boolean_and_organization_names(self):
        fact = self.read_named(self.projection(), "案件明细")
        row = fact["value"][0]
        self.assertEqual(row["caseNo"], "CASE-784621")
        self.assertEqual(row["amount"], 12500.5)
        self.assertIs(row["closed"], False)
        self.assertEqual(row["court"]["name"], "虚构示例法院")
        self.assertEqual(row["company"]["name"], "虚构示例公司")
        self.assertEqual(row["company"]["owner"], {"education": "本科"})
        self.assertIn("本科", row["note"])
        self.assert_filtered(fact)

    def test_array_and_candidate_paths_preserve_values_without_exposing_paths(self):
        p = self.projection()
        fact = self.read_named(p, "案件金额")
        self.assertEqual(fact["value"], [{"present": True, "value": 12500.5}])
        candidates = self.read_named(p, "学历候选")
        self.assertEqual(candidates["status"], "withheld")
        self.assertNotIn("value", candidates)
        self.assertNotIn("report.", json.dumps(candidates))

    def test_encoded_json_name_lists_opaque_fields_and_unstructured_labels_are_filtered(self):
        p = self.projection()
        facts = [self.read_named(p, name) for name in ("说明", "相关人员", "附加资料", "办理情况")]
        self.assert_filtered(facts)
        self.assertIn("案件待核验", facts[0]["value"])
        self.assertEqual(facts[1]["value"][0]["age"], 30)
        self.assertEqual(json.loads(facts[2]["value"])["education"], "硕士")
        self.assertIn("已结案", facts[3]["value"])
        self.assertNotIn("状态和明细按报告原文解释", facts[3]["rule"])

    def test_private_values_are_collected_even_for_inactive_opaque_fields(self):
        order, catalog = scope_fixture()
        next(f for f in catalog["fields"] if f["path"] == "report.opaque")["module_id"] = 999
        tools = LocalReportTools(order, catalog)
        guard = QuestionGuard(tools)
        self.assertIn("虚构庚姓名".casefold(), guard._private)
        self.assert_filtered(self.read_named(FactProjection(tools, guard), "办理情况"))

    def test_ordinary_report_text_and_business_identifiers_can_be_questions(self):
        guard = self.projection().guard
        for question in ("本科已婚的情况怎样", "案件CASE-784621怎么理解", "报告编号900012345678901234是什么意思", "看看784621的记录", "邮箱synthetic@example.test", "网站https://synthetic.invalid"):
            self.assertEqual(guard.question(question), question)

    def test_projection_does_not_mutate_local_report(self):
        order, catalog = scope_fixture()
        original = deepcopy(order)
        tools = LocalReportTools(order, catalog)
        p = FactProjection(tools, QuestionGuard(tools))
        self.read_named(p, "案件明细")
        self.assertEqual(order, original)
        self.assertEqual(tools.get_current_order_data(["report.details"])[0]["value"], original["report_data"]["report"]["details"])

    def test_entire_tool_loop_sends_filtered_details_and_renders_sources(self):
        tools = LocalReportTools(*scope_fixture())
        p = FactProjection(tools, QuestionGuard(tools))
        refs = tuple(ref for ref, item in p.fields.items() if item["public"]["name"] in {"学历", "婚姻", "案件明细"})
        client = analysis.report_client(refs, "学历为本科、婚姻为已婚，案件明细包含办理状态，应结合对应记录理解。")
        answer = Conversation(tools, strategy="analysis").answer("解读婚姻学历和案件明细", client, "synthetic-model")
        self.assertNotIn("依据", answer)
        self.assertNotIn("改用本地", answer)
        self.assertEqual(len(client.requests), 4)
        self.assertIn("CASE-784621", json.dumps(client.requests))
        self.assert_filtered(client.requests)
        self.assert_filtered(answer)

    def test_parallel_overview_flow_uses_the_same_filtered_facts(self):
        """整份报告新入口也必须通过既有投影，不能另走原始报告出口。"""
        wire = []

        def create(**options):
            wire.append(deepcopy(options))
            payload = json.loads(options["messages"][-1]["content"])
            modules = payload["modules"]
            if "facts" in modules[0]:
                rows = [{"module_ref": item["module_ref"], "text": "本模块提供了报告信息，可结合其他模块理解。",
                         "sources": [fact["field_ref"] for fact in item["facts"]]} for item in modules]
                return analysis.response(json.dumps({"modules": rows}, ensure_ascii=False))
            return analysis.response(json.dumps({"text": "已结合各模块提供的信息归纳，具体情况需结合对应记录理解。",
                                                  "sources": modules[0]["sources"]}, ensure_ascii=False))

        client = NS(chat=NS(completions=NS(create=create)))
        answer = Conversation(LocalReportTools(*scope_fixture()), strategy="analysis").answer("分析我的报告", client, "synthetic-model")
        self.assertIn("整体总结", answer)
        self.assertNotIn("改用本地", answer)
        self.assertEqual(len(wire), 2)
        self.assert_filtered(wire)
        self.assert_filtered(answer)


class SDKReportScopeTests(support.NoExternalIO):
    """复用已有真实 SDK 内存传输，验证嵌套脱敏结果经过最终序列化仍保持边界。"""

    client = providers.DeepSeekTests.client
    response = providers.DeepSeekTests.response

    def test_real_sdk_sends_filtered_case_records(self):
        tools = LocalReportTools(*scope_fixture())
        projection = FactProjection(tools, QuestionGuard(tools))
        refs = tuple(ref for ref, item in projection.fields.items() if item["public"]["name"] == "案件明细")
        script = analysis.report_client(refs, "案件记录给出了金额和办理状态，可继续核对记录口径。")
        wire = []

        def handler(request):
            payload = json.loads(request.content)
            wire.append(payload)
            return self.response(script.create(**payload))

        answer = Conversation(tools, strategy="analysis").answer("解读案件明细", self.client(handler), DEEPSEEK_DEFAULT_MODEL)
        self.assertNotIn("依据", answer)
        self.assertEqual(len(wire), 4)
        ReportScopeTests.assert_filtered(self, wire)
        self.assertIn("CASE-784621", json.dumps(wire))
