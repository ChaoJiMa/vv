"""使用虚构多版本报告和字段资料验证主题隔离、路径语义及离线导入，不读取真实报告。"""

from copy import deepcopy
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

import httpx

import main
import test_privacy as support
from report_api import MY_REPORTS_PATH, ReportApi
from report_session import Conversation
from report_tools import LocalReportTools, UnsupportedReportTheme, read_report_path
from scripts.import_report_fields import AUTHORITATIVE, OTHER_SUPPLEMENT, SUPPLEMENT, build_catalog, import_fields
from test_privacy import FakeClient, NoExternalIO, fixtures


THEMES = (1, 2, 3, 4, 5, 6, 27, 28, 40, 50, 51, 52)


def theme_fixtures():
    """同名字段在不同主题使用不同路径与规则，并包含不应启用的模块字段。"""
    order, catalog = fixtures()
    catalogs = {}
    for theme in THEMES:
        entry = deepcopy(catalog)
        entry.update(theme=theme, theme_name=f"虚构版本{theme}")
        entry["fields"][0].update(path=f"report.synthetic_theme_{theme}", frontend_processing=f"虚构规则{theme}")
        catalogs[str(theme)] = entry
        order["report_data"]["report"][f"synthetic_theme_{theme}"] = f"SYNTHETIC_THEME_VALUE_{theme}"
    return order, {"schema_version": 2, "themes": catalogs}


def import_fixtures():
    """构造相同模块与路径但规则不同的主题资料，验证导入不会跨主题补充口径。"""
    def row(theme):
        return {"主题": f"虚构版本{theme}（theme={theme}）", "模块ID": 5, "模块名称": "虚构模块",
                "展示字段名称": "分析指数", "报告数据字段路径": "report.synthetic_score",
                "前端处理逻辑": f"权威规则{theme}", "枚举值映射": f"虚构枚举{theme}"}

    def module(theme):
        return {"moduleId": 5, "fields": [{"displayName": "分析指数", "reportDataPath": "report.synthetic_score",
                "backendProcessing": f"虚构后端口径{theme}", "frontendProcessing": "不得覆盖权威规则"}]}

    authoritative = {"rows": [row(theme) for theme in (1, 3, 50)]}
    rigorous = {"modules": [module(3)], "gaugeRules": {"synthetic": "严谨版规则"}, "gearRules": {},
                "pathConventions": {"storage": "虚构通用资料", "placeholders": {"windowLabel": {"D7": "近7天"}}}}
    other = {"themes": [{"themeId": theme, "effectiveThemeId": 3 if theme == 50 else theme,
                         "modules": [module(theme)]} for theme in (1, 50)]}
    return authoritative, rigorous, other


class ThemeSelectionTests(NoExternalIO):
    """主题目录、报告模块白名单、会话和模型消息在多版本之间相互隔离。"""

    def test_all_registered_themes_select_their_own_paths_and_rules(self):
        order, bundle = theme_fixtures()
        for theme in THEMES:
            with self.subTest(theme=theme):
                order["report_data"]["template"]["theme"] = theme
                tools = LocalReportTools(order, bundle)
                result = Conversation(tools).answer("分析指数是多少")
                self.assertEqual(tools.theme, theme)
                self.assertEqual(tools.theme_name, f"虚构版本{theme}")
                self.assertIn(f"SYNTHETIC_THEME_VALUE_{theme}", result)
                self.assertIn(f"虚构规则{theme}", result)
                self.assertNotIn("report.hidden", {field["path"] for field in tools.current_fields()})
                other = 1 if theme != 1 else 2
                with self.assertRaises(ValueError):
                    tools.get_current_order_data([f"report.synthetic_theme_{other}"])

    def test_unknown_theme_never_uses_effective_theme_or_rigorous_fallback(self):
        order, bundle = theme_fixtures()
        for theme in (50, 999):
            order["report_data"]["template"]["theme"] = theme
            bundle["themes"].pop(str(theme), None)
            with self.subTest(theme=theme), self.assertRaises(UnsupportedReportTheme):
                LocalReportTools(order, bundle)

    def test_malformed_theme_ids_or_mismatched_catalog_are_rejected(self):
        order, bundle = theme_fixtures()
        for theme in (True, "3", None, 3.0):
            order["report_data"]["template"]["theme"] = theme
            with self.subTest(theme=theme), self.assertRaises(ValueError):
                LocalReportTools(order, bundle)
        order["report_data"]["template"]["theme"] = 3
        bundle["themes"]["3"]["theme"] = 1
        with self.assertRaises(ValueError):
            LocalReportTools(order, bundle)

    def test_switching_theme_resets_field_selection_and_model_history(self):
        order, bundle = theme_fixtures()
        first = Conversation(LocalReportTools(order, bundle))
        first.answer("/find 分析指数")
        first.answer("分析指数是多少")
        order["report_id"] = "SYNTHETIC_ANOTHER_REPORT"
        order["report_data"]["template"]["theme"] = 40
        second = Conversation(LocalReportTools(order, bundle))
        self.assertEqual(second.last_fields, [])
        self.assertEqual(second.public_history, [])
        self.assertEqual(second.local_history, [])
        self.assertNotIn("SYNTHETIC_THEME_VALUE_3", second.answer("/pick 1"))
        self.assertIn("SYNTHETIC_THEME_VALUE_40", second.answer("分析指数是多少"))
        self.assertNotEqual(first.tools.history_scope, second.tools.history_scope)

    def test_outbound_requests_are_identical_across_all_themes(self):
        order, bundle = theme_fixtures()
        serialized = []
        for theme in THEMES:
            order["report_data"]["template"]["theme"] = theme
            client = FakeClient()
            Conversation(LocalReportTools(order, bundle)).answer("分析指数是多少", client, "synthetic-model")
            serialized.append(client.requests)
            support.OutboundTests.assert_private_absent(self, client.requests)
            self.assertNotIn("SYNTHETIC_THEME_VALUE", json.dumps(client.requests))
        self.assertTrue(all(requests == serialized[0] for requests in serialized))

    def test_cli_can_select_a_supported_non_rigorous_report(self):
        order, bundle = theme_fixtures()
        order["report_data"]["template"]["theme"] = 40
        report_id = order["report_id"]

        def respond(request):
            data = ({"records": [{"reportId": report_id}], "total": 1} if request.url.path == MY_REPORTS_PATH
                    else {**order["report_data"], "report_id": report_id})
            return httpx.Response(200, json={"code": 200, "data": data})

        api = ReportApi("https://synthetic-business.invalid", "SYNTHETIC_TOKEN", httpx.MockTransport(respond))
        self.addCleanup(api.close)
        with patch("builtins.input", return_value="1") as prompt, redirect_stdout(io.StringIO()) as output, \
                patch.object(main, "LocalReportTools", side_effect=lambda value: LocalReportTools(value, bundle)):
            tools = main.choose_order(api)
        prompt.assert_called_once()
        self.assertEqual(tools.theme, 40)
        self.assertIn("已识别报告版本：虚构版本40", output.getvalue())
        self.assertNotIn("仅支持", output.getvalue())


class MultiThemePathTests(NoExternalIO):
    """企业报告的动态键、数字键与多个候选依赖均保留原值和缺失语义。"""

    def test_dynamic_keys_with_arrays_preserve_each_items_presence(self):
        data = {"report": {"companies": {"syntheticA": [{"count": 0}, {}], "syntheticB": [{"count": None}]}}}
        self.assertEqual(read_report_path(data, "report.companies.*[].count"), {"present": True, "value": {
            "syntheticA": {"present": True, "value": [{"present": True, "value": 0}, {"present": False}]},
            "syntheticB": {"present": True, "value": [{"present": True, "value": None}]}}})

    def test_numeric_object_keys_and_array_indexes_are_distinct_and_supported(self):
        data = {"report": {"124": {"rows": [{"value": ""}]}}}
        self.assertEqual(read_report_path(data, "report[124].rows[0].value"), {"present": True, "value": ""})
        self.assertEqual(read_report_path(data, "report[124].rows[1].value"), {"present": False})
        self.assertEqual(read_report_path(data, "report[124].*"), {"present": True, "value": {
            "rows": {"present": True, "value": [{"value": ""}]}}})

    def test_candidates_preserve_zero_null_and_absence_without_fallback(self):
        data = {"report": {"first": 0, "second": None}}
        self.assertEqual(read_report_path(data, "report.first | report.second | report.third"), {
            "present": True, "value": [{"path": "report.first", "present": True, "value": 0},
            {"path": "report.second", "present": True, "value": None}, {"path": "report.third", "present": False}]})
        self.assertFalse(read_report_path(data, "report.absent | report.third")["present"])

    def test_expressions_are_rejected_instead_of_partially_tokenized(self):
        for path in ("report.x + report.y", "report.x || report.y", "report..x", "report.x()", "report['x']"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                read_report_path({}, path)


class ThemeImportTests(NoExternalIO):
    """导入器仅使用同一提交中的通用资料，并精确匹配每个主题的补充规则。"""

    def test_import_keeps_theme_rules_separate_and_frontend_authoritative(self):
        catalog = build_catalog(*import_fixtures(), {"revision": "SYNTHETIC_REVISION"})
        for theme in (1, 3, 50):
            field = catalog["themes"][str(theme)]["fields"][0]
            self.assertEqual(field["frontend_processing"], f"权威规则{theme}")
            self.assertEqual(field["backend_processing"], f"虚构后端口径{theme}")
            self.assertEqual("gaugeRules" in field["module_rules"], theme == 3)
        self.assertEqual(catalog["themes"]["50"]["effective_theme"], 3)

    def test_missing_or_conflicting_supplement_does_not_borrow_another_themes_rules(self):
        authority, rigorous, other = import_fixtures()
        other["themes"][0]["modules"][0]["fields"] = []
        conflicting = deepcopy(other["themes"][1]["modules"][0]["fields"][0])
        conflicting["backendProcessing"] = "冲突口径"
        other["themes"][1]["modules"][0]["fields"].append(conflicting)
        catalog = build_catalog(authority, rigorous, other, {})
        for theme in (1, 50):
            self.assertEqual(catalog["themes"][str(theme)]["fields"][0]["backend_processing"], "")

    def test_static_text_has_no_value_path_and_unknown_themes_fail_import(self):
        authority, rigorous, other = import_fixtures()
        authority["rows"][0]["报告数据字段路径"] = "（静态文案，无 report_data 路径）"
        catalog = build_catalog(authority, rigorous, other, {})
        self.assertEqual(catalog["themes"]["1"]["fields"][0]["path"], "")
        authority["rows"][0]["主题"] = "未登记版本（theme=999）"
        with self.assertRaises(ValueError):
            build_catalog(authority, rigorous, other, {})

    def test_import_reads_all_documents_from_one_pinned_revision(self):
        authority, rigorous, other = import_fixtures()
        documents = {AUTHORITATIVE: authority, SUPPLEMENT: rigorous, OTHER_SUPPLEMENT: other}
        revision = "SYNTHETIC_PINNED_REVISION"

        def git(args, **kwargs):
            if args[3] == "rev-parse":
                return revision + "\n"
            self.assertEqual(args[3], "show")
            prefix, filename = args[4].split(":", 1)
            self.assertEqual(prefix, revision)
            return json.dumps(documents[filename]).encode()

        with tempfile.TemporaryDirectory() as tmp, patch("subprocess.check_output", side_effect=git) as calls, \
                redirect_stdout(io.StringIO()):
            output = Path(tmp) / "catalog.json"
            imported = import_fields(Path(tmp), "synthetic-ref", output)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), imported)
        self.assertEqual(calls.call_count, 4)
