"""终端慢请求、异常及加密历史的回归；不读取真实配置或业务报告。"""

from contextlib import redirect_stdout
import io
import os
from pathlib import Path
import tempfile
from threading import Event, get_ident
from types import SimpleNamespace
from unittest.mock import patch

import main
from local_history import HistoryError, HistoryStore
from report_progress import TurnProgress
from report_session import Conversation
import test_analysis as analysis
import test_privacy as privacy


class ProgressOutput(io.StringIO):
    """提示刷新时通知测试，避免依赖固定sleep或真实模型延迟。"""

    def __init__(self):
        super().__init__()
        self.waiting = Event()
        self.flushed = 0

    def flush(self):
        self.flushed += 1
        if "仍在处理" in self.getvalue():
            self.waiting.set()
        super().flush()


class ProgressTests(privacy.NoExternalIO):
    """确认反馈先于处理、不会泄露正文，并在所有退出路径回收线程。"""

    def test_slow_turn_receives_flushed_feedback_without_moving_work(self):
        output, owner = ProgressOutput(), get_ident()
        progress = TurnProgress(interval=0.005, stream=output)

        def answer(question, client, model):
            self.assertEqual(get_ident(), owner)
            self.assertIn("已收到", output.getvalue())
            self.assertGreaterEqual(output.flushed, 1)
            self.assertTrue(output.waiting.wait(2), "慢请求期间未刷新等待提示")
            return "SYNTHETIC_PRIVATE_ANSWER"

        conversation = SimpleNamespace(answer=answer)
        with patch.object(main, "TurnProgress", return_value=progress):
            updated, result = main.run_turn(None, None, conversation, "SYNTHETIC_PRIVATE_QUESTION")
        self.assertIs(updated, conversation)
        self.assertEqual(result, "SYNTHETIC_PRIVATE_ANSWER")
        self.assertNotIn("SYNTHETIC_PRIVATE", output.getvalue())
        self.assertFalse(progress._thread.is_alive())
        self.assertTrue(progress._stop.is_set())

    def test_fast_turn_does_not_wait_for_next_notification(self):
        progress = TurnProgress(interval=3600, stream=io.StringIO())
        with progress:
            pass
        self.assertFalse(progress._thread.is_alive())
        self.assertNotIn("仍在处理", progress.stream.getvalue())

    def test_failure_and_keyboard_interrupt_propagate_after_thread_cleanup(self):
        for error in (HistoryError("SYNTHETIC_PRIVATE_ERROR"), ValueError("SYNTHETIC_PRIVATE_ERROR"), KeyboardInterrupt()):
            with self.subTest(error=type(error).__name__):
                progress = TurnProgress(stream=io.StringIO())
                conversation = SimpleNamespace(answer=lambda *_: (_ for _ in ()).throw(error))
                with patch.object(main, "TurnProgress", return_value=progress):
                    with self.assertRaises(type(error)):
                        main.run_turn(None, None, conversation, "虚构问题")
                self.assertFalse(progress._thread.is_alive())
                self.assertNotIn("SYNTHETIC_PRIVATE_ERROR", progress.stream.getvalue())

    def test_output_closed_during_wait_does_not_leave_notifier_running(self):
        progress = TurnProgress(interval=0.005, stream=io.StringIO())
        with progress:
            progress.stream.close()
            self.assertTrue(progress._stop.wait(2))
        self.assertFalse(progress._thread.is_alive())

    def test_history_failure_does_not_commit_answer_or_progress(self):
        history = SimpleNamespace(read=lambda *_: [], append=lambda *_: (_ for _ in ()).throw(HistoryError("synthetic failure")))
        conversation = Conversation(analysis.analysis_tools(), history, strategy="analysis")
        output = io.StringIO()
        with redirect_stdout(output), self.assertRaises(HistoryError):
            main.run_turn(None, None, conversation, "你好")
        self.assertEqual(conversation.local_history, [])
        self.assertIsNone(conversation.analysis_context)
        self.assertNotIn("助手：", output.getvalue())

    def test_terminal_answer_is_explicitly_flushed(self):
        output = ProgressOutput()
        with patch.dict(os.environ, {"REPORT_DATA_SOURCE": "demo", "REPORT_EXTERNAL_MODEL": "off"}, clear=True), \
                patch.object(main, "load_dotenv"), patch.object(main, "HistoryStore"), \
                patch.object(main, "default_history_path", return_value=Path("synthetic-history")), \
                patch.object(main.LocalReportTools, "demo", return_value=analysis.analysis_tools()), \
                patch("builtins.input", side_effect=["你好", "exit"]), \
                redirect_stdout(output):
            self.assertEqual(main.main(), 0)
        self.assertIn("助手：", output.getvalue())
        self.assertGreaterEqual(output.flushed, 2)

    @privacy.unittest.skipUnless(os.name == "nt", "Windows DPAPI required")
    def test_real_sqlite_stays_on_owner_thread_and_stores_only_answer(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = HistoryStore(Path(tmp) / "history.sqlite3")
            try:
                conversation = Conversation(analysis.analysis_tools(), store, strategy="analysis")
                with redirect_stdout(io.StringIO()):
                    _, answer = main.run_turn(None, None, conversation, "你好")
                records = store.read(conversation.tools.history_scope)
                self.assertEqual(len(records), 1)
                self.assertEqual(records[0]["answer"], answer)
                self.assertNotIn("已收到", records[0]["answer"])
                self.assertNotIn("仍在处理", records[0]["answer"])
            finally:
                store.close()
