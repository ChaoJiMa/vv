"""失败原因只进当前用户加密诊断表，客户答案不暴露内部校验详情。"""

from contextlib import ExitStack, redirect_stdout
import httpx
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from zai.core._errors import APIConnectionError, APIStatusError, APITimeoutError

from report_assistant.conversation.analysis import AnalysisFailure
from report_assistant.conversation.module_selection import ModuleSelection, selected_module_fallback
from report_assistant.conversation.overview import OverviewValidationError
from report_assistant.conversation.session import Conversation
from report_assistant.integrations.history import (
    DIAGNOSTIC_REASONS, DIAGNOSTIC_ROUTES, HistoryError, HistoryStore)
from report_assistant.integrations.model import OpenAIResponsesClient
from report_assistant.reports.tools import LocalReportTools
from report_assistant.security.privacy import PrivacyError
from scripts.inspect_failure_diagnostics import (
    DURATION_SUBREASON_LABELS, REASON_LABELS, ROUTE_LABELS, display,
    main as inspect_diagnostics)
from support.analysis import (ScriptClient, analysis_tools, call as model_call,
                              report_client, response as model_response, route as model_route)
from support.overview import OverviewClient, overview_tools


@unittest.skipUnless(os.name == "nt", "本地诊断正式使用 Windows 当前用户 DPAPI")
class FailureDiagnosticTests(unittest.TestCase):
    """使用虚构报告和临时数据库核对诊断持久化、隔离与失败边界。"""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "history.sqlite3"
        self.store = HistoryStore(self.path)
        self.addCleanup(self.store.close)

    def test_numeric_validation_is_logged_but_not_shown_to_customer(self):
        validation = OverviewValidationError(PrivacyError("回答包含未验证数字。"), "modules", 2, 1)
        conversation = Conversation(LocalReportTools.demo(), self.store, strategy="analysis")
        with patch.object(conversation.analysis, "answer", side_effect=AnalysisFailure("answer", validation)):
            answer = conversation.answer("分析下我的报告", object(), "synthetic-model")

        self.assertIn("整体分析暂未完成", answer)
        self.assertNotIn("包含来源未支持的数字", answer)
        self.assertNotIn("第2批", answer)
        record, = self.store.read_diagnostics()
        self.assertEqual((record["reason"], record["route"]), ("answer", "full_report"))
        self.assertEqual(record["validation"], {
            "code": "numbers", "detail": "包含来源未支持的数字或比例",
            "stage": "modules", "batch": 2, "position": 1, "subreason": None,
        })
        raw = self.path.read_bytes()
        for private_text in ("分析下我的报告", "包含来源未支持的数字或比例"):
            self.assertNotIn(private_text.encode("utf-8"), raw)

        # 维护入口只读取封闭诊断字段，不会顺带显示历史问答。
        output = io.StringIO()
        with redirect_stdout(output):
            display(self.store.read_diagnostics())
        self.assertIn("包含来源未支持的数字或比例", output.getvalue())
        self.assertNotIn("分析下我的报告", output.getvalue())

    def test_real_overview_batch_failure_keeps_exact_internal_location(self):
        """经过真实分批校验链路，而非手工构造异常，核对第二批数字失败位置。"""
        def mutate(stage, value, _, request_index):
            if stage == "modules" and request_index in (2, 3):
                value["modules"][0]["text"] = "未经支持的999999次申请。"
            return value

        conversation = Conversation(overview_tools(count=10), self.store, strategy="analysis")
        answer = conversation.answer("分析下我的报告", OverviewClient(mutate), "synthetic-model")
        self.assertIn("整体分析暂未完成", answer)
        self.assertNotIn("999999", answer)
        self.assertNotIn("第2批", answer)
        record, = self.store.read_diagnostics()
        self.assertEqual(record["reason"], "answer")
        self.assertEqual(record["validation"], {
            "code": "numbers", "detail": "包含来源未支持的数字或比例",
            "stage": "modules", "batch": 2, "position": 1, "subreason": None,
        })

    def test_duration_subreasons_and_legacy_v1_diagnostics(self):
        """固定子码拆分时长路径；旧版密文无子码仍可读取，不能倒推旧错误。"""
        self.assertEqual(set(DURATION_SUBREASON_LABELS),
                         set(OverviewValidationError.DURATION_SUBREASONS.values()))
        self.assertEqual(set(OverviewValidationError.DURATION_SUBREASONS), {
            error for error, pair in OverviewValidationError.REASONS.items()
            if pair == ("numbers", "时长或范围与对应指标来源不一致")})
        for error, subreason in OverviewValidationError.DURATION_SUBREASONS.items():
            with self.subTest(error=error):
                validation = OverviewValidationError(PrivacyError(error), "modules", 2, 1)
                self.assertEqual(validation.diagnostic_subreason, subreason)
                self.assertEqual((validation.code, validation.diagnostic_detail),
                                 ("numbers", "时长或范围与对应指标来源不一致"))
        cases = (
            ("回答包含尚未支持的复合时长区间。", "composite_duration_interval"),
            ("回答改变了时长来源的范围边界。", "duration_boundary_changed"),
        )
        for error, subreason in cases:
            validation = OverviewValidationError(PrivacyError(error), "modules", 2, 1)
            self.store.append_diagnostic("answer", "full_report", validation)
        records = self.store.read_diagnostics()
        self.assertEqual([record["version"] for record in records], [2, 2])
        self.assertEqual([record["validation"]["subreason"] for record in records],
                         ["duration_boundary_changed", "composite_duration_interval"])
        output = io.StringIO()
        with redirect_stdout(output):
            display(records)
        self.assertIn("复合时长区间无法核验", output.getvalue())
        self.assertIn("时长范围边界改变", output.getvalue())
        self.assertNotIn("回答改变了时长来源的范围边界。".encode("utf-8"), self.path.read_bytes())

        legacy = self.store._validated_diagnostic(
            "answer", "full_report", OverviewValidationError(PrivacyError(cases[0][0]), "modules", 2, 1))
        legacy["version"] = 1
        del legacy["validation"]["subreason"]
        payload = self.store._protector.encrypt(json.dumps(legacy, ensure_ascii=False).encode("utf-8"))
        with self.store._connection:
            self.store._connection.execute("INSERT INTO diagnostics (payload) VALUES (?)", (payload,))
        old = self.store.read_diagnostics()[0]
        self.assertEqual(old["version"], 1)
        self.assertNotIn("subreason", old["validation"])
        output = io.StringIO()
        with redirect_stdout(output):
            display([old])
        self.assertIn("时长或范围与对应指标来源不一致", output.getvalue())

    def test_unapproved_duration_subreason_is_rejected_on_write_and_read(self):
        """新诊断格式拒绝自由文本子因，避免通过异常或篡改密文夹带私有信息。"""
        validation = OverviewValidationError(PrivacyError("回答包含尚未支持的复合时长区间。"),
                                             "modules", 2, 1)
        validation.diagnostic_subreason = "PRIVATE_DRAFT"
        with self.assertRaises(HistoryError):
            self.store.append_diagnostic("answer", "full_report", validation)
        self.assertEqual(self.store.read_diagnostics(), [])
        record = self.store._validated_diagnostic("answer", "full_report", OverviewValidationError(
            PrivacyError("回答包含尚未支持的复合时长区间。"), "modules", 2, 1))
        record["validation"]["subreason"] = "PRIVATE_DRAFT"
        payload = self.store._protector.encrypt(json.dumps(record, ensure_ascii=False).encode("utf-8"))
        with self.store._connection:
            self.store._connection.execute("INSERT INTO diagnostics (payload) VALUES (?)", (payload,))
        with self.assertRaises(HistoryError):
            self.store.read_diagnostics()

    def test_non_duration_subreason_must_be_null(self):
        """普通校验不能夹带自由文本子因，写入和读取执行同一边界。"""
        for invalid in ("PRIVATE_DRAFT", "composite_duration", 7, [], {}):
            with self.subTest(value_type=type(invalid).__name__):
                validation = OverviewValidationError(PrivacyError("回答包含未验证数字。"), "modules")
                validation.diagnostic_subreason = invalid
                with self.assertRaises(HistoryError):
                    self.store.append_diagnostic("answer", "full_report", validation)
                record = self.store._validated_diagnostic("answer", "full_report",
                    OverviewValidationError(PrivacyError("回答包含未验证数字。"), "modules"))
                record["validation"]["subreason"] = invalid
                payload = self.store._protector.encrypt(json.dumps(record).encode("utf-8"))
                with self.store._connection:
                    self.store._connection.execute("DELETE FROM diagnostics")
                    self.store._connection.execute("INSERT INTO diagnostics (payload) VALUES (?)", (payload,))
                with self.assertRaises(HistoryError):
                    self.store.read_diagnostics()

    def test_real_model_timeout_maps_to_fixed_reason(self):
        """模型适配异常经分析层映射后，只把固定超时类别加密入库。"""
        conversation = Conversation(analysis_tools(), self.store, strategy="analysis")
        error = APITimeoutError(request=httpx.Request("POST", "https://synthetic.invalid/PRIVATE_PATH"))
        answer = conversation.answer("分析报告中的指数", ScriptClient([error]), "synthetic-model")
        self.assertIn("AI分析未完成", answer)
        self.assertNotIn("模型响应超时", answer)
        record, = self.store.read_diagnostics()
        self.assertEqual((record["reason"], record["route"]), ("timeout", "routing"))
        self.assertIsNone(record["validation"])
        self.assertNotIn(b"PRIVATE_PATH", self.path.read_bytes())

    def test_distinct_protocol_failures_keep_fixed_internal_categories(self):
        """客户看到相同提示时，维护记录仍区分路由、工具、截断和回答拒绝。"""
        cases = (
            ("route", "routing", ScriptClient([model_response('{"route":"report"}')])),
            ("tool", "focused", ScriptClient([model_route(), model_call("read_report_facts", {"field_refs": ["f1"]})])),
            ("answer", "focused", report_client(text="指数为999")),
        )
        for reason, route, client in cases:
            with self.subTest(reason=reason):
                conversation = Conversation(analysis_tools(), self.store, strategy="analysis")
                answer = conversation.answer("分析报告中的指数", client, "synthetic-model")
                self.assertIn("AI分析未完成", answer)
                record = self.store.read_diagnostics()[0]
                self.assertEqual((record["reason"], record["route"]), (reason, route))

        truncated = model_response("PRIVATE_TRUNCATED_RESPONSE")
        truncated.choices[0].finish_reason = "length"
        conversation = Conversation(analysis_tools(), self.store, strategy="analysis")
        answer = conversation.answer("分析报告中的指数", ScriptClient([truncated]), "synthetic-model")
        self.assertIn("AI分析未完成", answer)
        self.assertEqual(self.store.read_diagnostics()[0]["reason"], "incomplete")
        self.assertNotIn(b"PRIVATE_TRUNCATED_RESPONSE", self.path.read_bytes())

    def test_connection_failure_is_separate_from_timeout(self):
        """连接异常不误记成超时或服务HTTP错误。"""
        request = httpx.Request("POST", "https://synthetic.invalid/PRIVATE_PATH")
        error = APIConnectionError(message="PRIVATE_CONNECTION_DETAIL", request=request)
        conversation = Conversation(analysis_tools(), self.store, strategy="analysis")
        conversation.answer("分析报告中的指数", ScriptClient([error]), "synthetic-model")
        record, = self.store.read_diagnostics()
        self.assertEqual((record["reason"], record["route"], record["status_code"]),
                         ("connection", "routing", None))
        self.assertNotIn(b"PRIVATE_CONNECTION_DETAIL", self.path.read_bytes())

    def test_semantic_overview_failure_records_actual_execution_route(self):
        """本地未判为整体问题时，模型选整体流程仍须按真实执行分支归档。"""
        routed = model_response(json.dumps({"route": "report", "use_previous": False, "scope": "overview"}))
        error = APITimeoutError(request=httpx.Request("POST", "https://synthetic.invalid/"))
        conversation = Conversation(analysis_tools(), self.store, strategy="analysis")
        conversation.answer("帮我看看这份资料有什么值得注意", ScriptClient([routed, error]), "synthetic-model")
        record, = self.store.read_diagnostics()
        self.assertEqual((record["reason"], record["route"]), ("timeout", "full_report"))

    def test_selected_preview_limit_and_projection_rejection_are_logged(self):
        """所选模块兜底的截断和本地投影拒绝均有独立固定原因。"""
        tools = overview_tools(count=10)
        conversation = Conversation(tools, self.store, strategy="analysis")
        with patch.object(conversation.analysis, "answer", side_effect=AnalysisFailure("timeout")), \
                patch.object(conversation.analysis.projection, "customer_answer",
                             side_effect=PrivacyError("PRIVATE_PROJECTION_DETAIL")):
            answer = conversation.answer("分析下前面十个模块", object(), "synthetic-model")
        self.assertIn("其余2个所选模块本次未展示", answer)
        self.assertIn("展示结果暂无法确认", answer)
        self.assertNotIn("PRIVATE_PROJECTION_DETAIL", answer)
        records = self.store.read_diagnostics()
        self.assertEqual({item["reason"] for item in records}, {
            "timeout", "fallback_projection_rejected", "fallback_preview_limit"})
        self.assertTrue(all(item["route"] == "selected_modules" for item in records))

    def test_structured_placeholder_reports_fixed_degradation(self):
        """“有相关记录”只需报告结构值降级，不保存对象内容或字段名称。"""
        tools = analysis_tools()
        projection = Conversation(tools, strategy="analysis").analysis.projection
        structured = None
        for item in projection.fields.values():
            fact = projection.read([item["public"]["field_ref"]])[0]
            if isinstance(fact.get("value"), (dict, list)):
                structured = item["local"]
                break
        self.assertIsNotNone(structured)
        seen = []
        answer = projection.customer_answer([structured], on_structured=lambda: seen.append("structured"))
        self.assertIn("有相关记录", answer)
        self.assertEqual(seen, ["structured"])

        selection = ModuleSelection((structured["module_id"],), True)
        original = projection.customer_answer
        def structured_answer(_fields, *, on_structured=None):
            return original([structured], on_structured=on_structured)
        with patch.object(projection, "customer_answer", side_effect=structured_answer):
            selected_module_fallback(tools, projection, selection,
                                     on_degradation=lambda reason: seen.append(reason))
        self.assertIn("fallback_structured_value", seen)

    def test_http_status_distinguishes_rate_limit_without_response_body(self):
        """只记429这个状态数字，不持久化供应商响应正文或请求地址。"""
        request = httpx.Request("POST", "https://synthetic.invalid/PRIVATE_PATH")
        response = httpx.Response(429, request=request, json={"error": "PRIVATE_RESPONSE"})
        error = APIStatusError("PRIVATE_RESPONSE", response=response)
        conversation = Conversation(analysis_tools(), self.store, strategy="analysis")
        answer = conversation.answer("分析报告中的指数", ScriptClient([error]), "synthetic-model")
        self.assertIn("AI分析未完成", answer)
        self.assertNotIn("429", answer)
        record, = self.store.read_diagnostics()
        self.assertEqual((record["reason"], record["status_code"]), ("service", 429))
        self.assertNotIn(b"PRIVATE_RESPONSE", self.path.read_bytes())
        self.assertNotIn(b"PRIVATE_PATH", self.path.read_bytes())

    def test_openai_adapter_429_is_persisted_without_provider_body(self):
        """当前 OpenAI Responses 适配器的实际内存HTTP链路也记录固定状态。"""
        def handler(_request):
            return httpx.Response(429, json={"error": {"message": "PRIVATE_PROVIDER_BODY"}})

        with ExitStack() as stack:
            transport = stack.enter_context(httpx.Client(
                transport=httpx.MockTransport(handler), trust_env=False, follow_redirects=False))
            client = stack.enter_context(OpenAIResponsesClient("SYNTHETIC_OPENAI_KEY", transport))
            conversation = Conversation(analysis_tools(), self.store, strategy="analysis")
            answer = conversation.answer("分析报告中的指数", client, "synthetic-model")
        self.assertIn("AI分析未完成", answer)
        record, = self.store.read_diagnostics()
        self.assertEqual((record["reason"], record["route"], record["status_code"]),
                         ("service", "routing", 429))
        self.assertNotIn(b"PRIVATE_PROVIDER_BODY", self.path.read_bytes())
        self.assertNotIn(b"SYNTHETIC_OPENAI_KEY", self.path.read_bytes())

    def test_timeout_and_offline_mode_have_distinct_fixed_reasons(self):
        conversation = Conversation(LocalReportTools.demo(), self.store, strategy="analysis")
        with patch.object(conversation.analysis, "answer", side_effect=AnalysisFailure("timeout")):
            answer = conversation.answer("帮我看下报告", object(), "synthetic-model")
        self.assertIn("AI分析未完成", answer)
        self.assertNotIn("模型响应超时", answer)
        conversation.answer("分析下我的报告", None, None)
        records = self.store.read_diagnostics()
        self.assertEqual([item["reason"] for item in records], ["model_disabled", "timeout"])

    def test_empty_strategy_result_is_not_silently_accepted(self):
        """意外空答有诊断且不写入空白客服回答。"""
        conversation = Conversation(LocalReportTools.demo(), self.store, strategy="analysis")
        with patch.object(conversation.analysis, "answer", return_value=(None, None)):
            answer = conversation.answer("分析下我的报告", object(), "synthetic-model")
        self.assertIn("整体分析暂未完成", answer)
        self.assertEqual(self.store.read_diagnostics()[0]["reason"], "incomplete")

    def test_local_fallback_exception_gets_diagnostic_without_raw_error(self):
        """模型失败后本地预览再失败，也需留下独立的本地处理类别。"""
        conversation = Conversation(overview_tools(count=2), self.store, strategy="analysis")
        with patch.object(conversation.analysis, "answer", side_effect=AnalysisFailure("timeout")), \
                patch("report_assistant.conversation.session.selected_module_fallback",
                      side_effect=ValueError("PRIVATE_LOCAL_ERROR")):
            with self.assertRaises(ValueError):
                conversation.answer("分析下前面两个模块", object(), "synthetic-model")
        self.assertEqual([item["reason"] for item in self.store.read_diagnostics()][:2],
                         ["local_processing_error", "timeout"])
        self.assertNotIn(b"PRIVATE_LOCAL_ERROR", self.path.read_bytes())

    def test_local_service_route_failure_is_marked_as_routing(self):
        """本地客服主题交叉核对失败不误标为报告具体问题。"""
        strategy = Conversation(analysis_tools(), strategy="analysis").analysis
        with self.assertRaises(AnalysisFailure) as raised:
            strategy._service_answers(["invalid_topic"])
        self.assertEqual((raised.exception.reason, raised.exception.route), ("route", "routing"))

    def test_unknown_validation_text_never_enters_diagnostic(self):
        validation = OverviewValidationError(PrivacyError("SYNTHETIC_PRIVATE_DRAFT"), "SYNTHETIC_STAGE")
        self.store.append_diagnostic("answer", "full_report", validation)
        record, = self.store.read_diagnostics()
        self.assertEqual(record["validation"]["detail"], "结构或正文未通过校验")
        self.assertEqual(record["validation"]["stage"], "prepare")
        self.assertNotIn(b"SYNTHETIC_PRIVATE_DRAFT", self.path.read_bytes())
        with self.assertRaises(HistoryError):
            self.store.append_diagnostic("SYNTHETIC_PRIVATE_DRAFT", "focused")

    def test_diagnostic_write_failure_stops_turn_before_answer_commit(self):
        conversation = Conversation(LocalReportTools.demo(), self.store, strategy="analysis")
        with patch.object(conversation.analysis, "answer", side_effect=AnalysisFailure("timeout")), \
                patch.object(self.store._protector, "encrypt", side_effect=HistoryError("SYNTHETIC_SECRET")):
            with self.assertRaises(HistoryError):
                conversation.answer("分析下我的报告", object(), "synthetic-model")
        self.assertEqual(conversation.local_history, [])
        self.assertEqual(self.store.read_diagnostics(), [])
        self.assertEqual(self.store.read(conversation.tools.history_scope), [])

    def test_readonly_inspection_does_not_create_or_change_tables(self):
        """维护读取使用 SQLite 只读连接，旧库没有诊断表时也不迁移。"""
        self.store.append_diagnostic("timeout", "focused")
        self.store.close()
        before = self.path.read_bytes()
        readonly = HistoryStore(self.path, readonly=True)
        try:
            self.assertEqual(readonly.read_diagnostics()[0]["reason"], "timeout")
            with self.assertRaises(HistoryError):
                readonly.append_diagnostic("timeout", "focused")
        finally:
            readonly.close()
        self.assertEqual(self.path.read_bytes(), before)

        legacy = Path(self.temporary.name) / "legacy.sqlite3"
        with sqlite3.connect(legacy) as connection:
            connection.execute("CREATE TABLE history (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
        before_legacy = legacy.read_bytes()
        readonly = HistoryStore(legacy, readonly=True)
        try:
            self.assertEqual(readonly.read_diagnostics(), [])
        finally:
            readonly.close()
        self.assertEqual(legacy.read_bytes(), before_legacy)

    def test_operator_entry_shows_fixed_reason_without_history_content(self):
        """正式查看入口从本机路径只读解密诊断，不展示已保存的问答。"""
        self.assertEqual(set(REASON_LABELS), DIAGNOSTIC_REASONS)
        self.assertEqual(set(ROUTE_LABELS), DIAGNOSTIC_ROUTES)
        self.store.append("SYNTHETIC_SCOPE", {
            "question": "PRIVATE_QUESTION", "answer": "PRIVATE_ANSWER"})
        self.store.append_diagnostic("service", "routing", status_code=429)
        output = io.StringIO()
        with patch("scripts.inspect_failure_diagnostics.default_history_path", return_value=self.path), \
                patch("sys.argv", ["inspect_failure_diagnostics.py", "--limit", "5"]), \
                redirect_stdout(output):
            self.assertEqual(inspect_diagnostics(), 0)
        self.assertIn("HTTP状态=429", output.getvalue())
        self.assertNotIn("PRIVATE_QUESTION", output.getvalue())
        self.assertNotIn("PRIVATE_ANSWER", output.getvalue())

        output = io.StringIO()
        with patch("scripts.inspect_failure_diagnostics.default_history_path", return_value=self.path), \
                patch("sys.argv", ["inspect_failure_diagnostics.py", "--summary-only"]), \
                redirect_stdout(output):
            self.assertEqual(inspect_diagnostics(), 0)
        self.assertIn("HTTP状态=429", output.getvalue())
        self.assertNotIn("逐条记录", output.getvalue())


if __name__ == "__main__":
    unittest.main()
