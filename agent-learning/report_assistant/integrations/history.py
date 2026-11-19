"""Windows 当前用户 DPAPI 加密历史；写入 SQLite 前加密，不落盘明文。"""

import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3

from report_assistant.security.module_diagnostics import valid_module_availability


# 诊断内容只允许封闭类别；不接受问题、答案、报告号或异常字符串作为字段。
DIAGNOSTIC_REASONS = frozenset({
    "timeout", "connection", "service", "incomplete", "budget", "answer",
    "payload", "route", "tool", "facts", "request_guard", "privacy_guard",
    "unexpected", "model_disabled", "template_error", "local_projection",
    "fallback_no_fields", "fallback_structured_value", "fallback_projection_rejected",
    "fallback_preview_limit", "local_privacy", "local_processing_error", "local_unexpected",
})
DIAGNOSTIC_ROUTES = frozenset({
    "template", "routing", "selected_modules", "full_report", "focused", "local_processing",
})
VALIDATION_CODES = frozenset({
    "json", "coverage", "structure", "module", "sources", "length", "scope",
    "numbers", "claim", "technical", "text", "tool", "validation",
})
VALIDATION_STAGES = frozenset({"prepare", "modules", "summary"})


class HistoryError(RuntimeError):
    """本地历史无法安全读写时抛出，调用方应停止保存或处理本轮问答。"""

    pass


class _Blob(ctypes.Structure):
    """对应 Windows DATA_BLOB：记录字节长度及缓冲区指针，供 DPAPI 读写。"""

    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]


class WindowsProtector:
    """使用当前 Windows 用户的 DPAPI 加解密；密钥管理交给操作系统。"""

    def __init__(self):
        """加载系统 DLL 并声明 C 函数签名，保证指针在当前进程位数下正确传递。"""
        if os.name != "nt":
            raise HistoryError("当前加密历史仅支持 Windows；不会改用明文保存。")
        self._crypt = ctypes.WinDLL("crypt32", use_last_error=True)
        self._kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self._crypt.CryptProtectData.argtypes = [ctypes.POINTER(_Blob), wintypes.LPCWSTR, ctypes.POINTER(_Blob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(_Blob)]
        self._crypt.CryptProtectData.restype = wintypes.BOOL
        self._crypt.CryptUnprotectData.argtypes = [ctypes.POINTER(_Blob), ctypes.c_void_p, ctypes.POINTER(_Blob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(_Blob)]
        self._crypt.CryptUnprotectData.restype = wintypes.BOOL
        self._kernel.LocalFree.argtypes = [ctypes.c_void_p]
        self._kernel.LocalFree.restype = ctypes.c_void_p

    def _transform(self, value, decrypt):
        """对非空字节串执行加密或解密，并清理 Windows 分配的输出缓冲区。"""
        if not isinstance(value, bytes) or not value or len(value) > 8_000_000:
            raise HistoryError("历史密文或内容格式错误。")
        buffer = ctypes.create_string_buffer(value)
        source = _Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
        # 固定 entropy 是本应用用途标记，不是密码或替代 Windows 用户密钥。
        # 解密时必须使用相同标记；更改它需要考虑旧历史的迁移兼容。
        purpose = b"agent-learning/local-history/v1"
        entropy_buffer = ctypes.create_string_buffer(purpose)
        entropy = _Blob(len(purpose), ctypes.cast(entropy_buffer, ctypes.POINTER(ctypes.c_ubyte)))
        output = _Blob()
        function = self._crypt.CryptUnprotectData if decrypt else self._crypt.CryptProtectData
        # 0x1 = CRYPTPROTECT_UI_FORBIDDEN；不使用 LOCAL_MACHINE 标志。
        ok = function(ctypes.byref(source), None, ctypes.byref(entropy), None, None, 0x1, ctypes.byref(output))
        try:
            if not ok:
                raise HistoryError("本地历史加密或解密失败；不会回显原始错误或改用明文。")
            return ctypes.string_at(output.data, output.size)
        finally:
            if output.data:
                # 输出内存由 Windows 分配，先清零再 LocalFree；不能交给 Python
                # 的普通缓冲区释放方式。返回的 bytes 已复制为 Python 对象。
                ctypes.memset(output.data, 0, output.size)
                self._kernel.LocalFree(ctypes.cast(output.data, ctypes.c_void_p))

    def encrypt(self, value):
        """加密序列化后的历史字节，返回可存入 SQLite BLOB 的密文。"""
        return self._transform(value, False)

    def decrypt(self, value):
        """在当前 Windows 用户下解密历史；密文被破坏或上下文不符时拒绝读取。"""
        return self._transform(value, True)


class HistoryStore:
    """SQLite 只存密文；问答历史与固定类别诊断分别存表且不在客户界面混用。"""

    def __init__(self, path, protector=None, *, readonly=False):
        """建立或只读打开历史库；正式运行默认使用 Windows DPAPI。"""
        self._protector = protector if protector is not None else WindowsProtector()
        self._connection = None
        self._has_diagnostics = False
        try:
            path = Path(path)
            if readonly:
                # SQLite mode=ro 不创建文件或表，维护脚本不会改变旧用户数据库。
                self._connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
                self._has_diagnostics = self._connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='diagnostics'").fetchone() is not None
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                self._connection = sqlite3.connect(path)
                self._connection.execute("CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
                self._connection.execute("CREATE TABLE IF NOT EXISTS diagnostics (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
                self._connection.commit()
                self._has_diagnostics = True
        except (OSError, sqlite3.Error):
            self.close()
            raise HistoryError("无法打开本地加密历史。") from None

    def append(self, scope, entry):
        """将版本号、报告绑定值与完整问答一起加密后，在事务内写入数据库。"""
        try:
            encoded = json.dumps({"version": 1, "scope": scope, "entry": entry}, ensure_ascii=False).encode("utf-8")
            encrypted = self._protector.encrypt(encoded)
            with self._connection:
                self._connection.execute("INSERT INTO history (payload) VALUES (?)", (encrypted,))
        except (OSError, sqlite3.Error, TypeError, ValueError):
            raise HistoryError("本轮本地历史保存失败。") from None

    @staticmethod
    def _validated_diagnostic(reason, route, validation=None, status_code=None):
        """只接受程序封闭的诊断元数据；返回不含问答及报告绑定值的记录。"""
        if (not isinstance(reason, str) or reason not in DIAGNOSTIC_REASONS
                or not isinstance(route, str) or route not in DIAGNOSTIC_ROUTES):
            raise HistoryError("诊断类别无效。")
        if status_code is not None and (reason != "service" or type(status_code) is not int
                                        or not 100 <= status_code <= 599):
            raise HistoryError("诊断服务状态无效。")
        detail = None
        if validation is not None:
            # 此处使用固定映射的输出标签；未知原始错误只能得到通用标签。
            from report_assistant.conversation.overview import OverviewValidationError
            allowed = set(OverviewValidationError.REASONS.values())
            allowed.add(("validation", "结构或正文未通过校验"))
            subreason = validation.diagnostic_subreason if isinstance(validation, OverviewValidationError) else None
            needs_subreason = (validation.code, validation.diagnostic_detail) == (
                "numbers", "时长或范围与对应指标来源不一致") if isinstance(validation, OverviewValidationError) else False
            if (reason != "answer" or not isinstance(validation, OverviewValidationError)
                    or not isinstance(validation.code, str) or validation.code not in VALIDATION_CODES
                    or not isinstance(validation.stage, str) or validation.stage not in VALIDATION_STAGES
                    or not isinstance(validation.diagnostic_detail, str)
                    or (validation.code, validation.diagnostic_detail) not in allowed
                    or (not isinstance(subreason, str)
                        or subreason not in OverviewValidationError.DURATION_SUBREASONS.values()
                        if needs_subreason else subreason is not None)
                    or type(validation.batch) is not int or not 0 <= validation.batch <= 1000
                    or type(validation.position) is not int or not 0 <= validation.position <= 12):
                raise HistoryError("诊断校验信息无效。")
            detail = {
                "code": validation.code, "detail": validation.diagnostic_detail,
                "stage": validation.stage, "batch": validation.batch, "position": validation.position,
                "subreason": subreason,
            }
            if validation.diagnostic_evidence is not None:
                from report_assistant.security.validation_diagnostics import valid_evidence
                if not valid_evidence(validation.diagnostic_evidence, VALIDATION_CODES,
                                      OverviewValidationError.DURATION_SUBREASONS.values()):
                    raise HistoryError("诊断证据格式无效。")
                detail['evidence'] = validation.diagnostic_evidence
        return {
            "version": 3 if detail is not None and 'evidence' in detail else 2,
            "time": datetime.now(timezone.utc).isoformat(),
            "reason": reason, "route": route, "validation": detail, "status_code": status_code,
        }

    def append_diagnostic(self, reason, route, validation=None, *, status_code=None):
        """在独立事务中先加密并持久化失败原因；失败时停止本轮，绝不写明文备用。"""
        record = self._validated_diagnostic(reason, route, validation, status_code)
        self._append_diagnostic_record(record)

    def append_module_diagnostic(self, route, availability):
        """在展示回答前记录模块数据缺口；与失败诊断使用相同的独立加密表。"""
        if route not in ("full_report", "selected_modules") or not valid_module_availability(availability):
            raise HistoryError("模块取值诊断内容无效。")
        modules = availability["modules"]
        if any("restriction_dates" in module for module in modules):
            version = 6
        else:
            version = 5 if any("performance" in module for module in modules) else 4
        self._append_diagnostic_record({
            "version": version, "time": datetime.now(timezone.utc).isoformat(),
            "reason": "module_availability", "route": route, "validation": None,
            "status_code": None, "availability": availability,
        })

    def _append_diagnostic_record(self, record):
        """把已完成白名单校验的记录加密后写入诊断表。"""
        try:
            encoded = json.dumps(record, ensure_ascii=False).encode("utf-8")
            encrypted = self._protector.encrypt(encoded)
            with self._connection:
                self._connection.execute("INSERT INTO diagnostics (payload) VALUES (?)", (encrypted,))
        except (OSError, sqlite3.Error, HistoryError, TypeError, ValueError):
            raise HistoryError("本轮诊断记录保存失败。") from None

    def read_diagnostics(self, limit=50):
        """仅供维护脚本读取最近的固定诊断字段；不解密或返回客户问答历史。"""
        if type(limit) is not int or not 1 <= limit <= 100000:
            raise HistoryError("诊断读取数量无效。")
        if not self._has_diagnostics:
            return []
        records = []
        try:
            rows = self._connection.execute(
                "SELECT payload FROM diagnostics ORDER BY id DESC LIMIT ?", (limit,))
            for (payload,) in rows:
                item = json.loads(self._protector.decrypt(payload).decode("utf-8"))
                availability_event = isinstance(item, dict) and item.get("version") in (4, 5, 6)
                keys = {"version", "time", "reason", "route", "validation", "status_code"}
                if availability_event:
                    keys.add("availability")
                if (not isinstance(item, dict) or set(item) != keys
                        or type(item["version"]) is not int or item["version"] not in (1, 2, 3, 4, 5, 6)
                        or not isinstance(item["time"], str)
                        or len(item["time"]) > 40 or not isinstance(item["reason"], str)
                        or not isinstance(item["route"], str) or item["route"] not in DIAGNOSTIC_ROUTES):
                    raise HistoryError("诊断内容格式错误，已停止读取。")
                timestamp = datetime.fromisoformat(item["time"])
                if timestamp.isoformat() != item["time"] or timestamp.utcoffset() != timezone.utc.utcoffset(None):
                    raise HistoryError("诊断内容格式错误，已停止读取。")
                validation = item["validation"]
                status_code = item["status_code"]
                if availability_event:
                    if (item["reason"] != "module_availability" or item["route"] not in ("full_report", "selected_modules")
                            or validation is not None or status_code is not None
                            or not valid_module_availability(item["availability"], version=item["version"])):
                        raise HistoryError("模块取值诊断内容无效，已停止读取。")
                    records.append(item)
                    continue
                if (item["reason"] not in DIAGNOSTIC_REASONS
                        or status_code is not None and (item["reason"] != "service" or type(status_code) is not int
                                                        or not 100 <= status_code <= 599)):
                    raise HistoryError("诊断内容格式错误，已停止读取。")
                if validation is not None:
                    from report_assistant.conversation.overview import OverviewValidationError
                    allowed = set(OverviewValidationError.REASONS.values())
                    allowed.add(("validation", "结构或正文未通过校验"))
                    keys = {"code", "detail", "stage", "batch", "position"}
                    if item["version"] >= 2:
                        keys.add("subreason")
                    if item['version'] == 3:
                        keys.add('evidence')
                    if (not isinstance(validation, dict)
                            or set(validation) != keys
                            or item["reason"] != "answer" or not isinstance(validation["code"], str)
                            or validation["code"] not in VALIDATION_CODES
                            or not isinstance(validation["detail"], str)
                            or (validation["code"], validation["detail"]) not in allowed
                            or not isinstance(validation["stage"], str)
                            or validation["stage"] not in VALIDATION_STAGES
                            or type(validation["batch"]) is not int or not 0 <= validation["batch"] <= 1000
                            or type(validation["position"]) is not int or not 0 <= validation["position"] <= 12):
                        raise HistoryError("诊断内容格式错误，已停止读取。")
                    if item["version"] >= 2:
                        # 新版本必须为时长类提供固定子码；旧版无此字段，原样兼容读取。
                        subreason = validation["subreason"]
                        needs_subreason = (validation["code"], validation["detail"]) == (
                            "numbers", "时长或范围与对应指标来源不一致")
                        if (not isinstance(subreason, str)
                                or subreason not in OverviewValidationError.DURATION_SUBREASONS.values()
                                if needs_subreason else subreason is not None):
                            raise HistoryError("诊断内容格式错误，已停止读取。")
                    if item['version'] == 3:
                        from report_assistant.security.validation_diagnostics import valid_evidence
                        if not valid_evidence(validation['evidence'], VALIDATION_CODES,
                                              OverviewValidationError.DURATION_SUBREASONS.values()):
                            raise HistoryError("诊断证据格式无效，已停止读取。")
                elif item['version'] == 3:
                    raise HistoryError("诊断证据缺失，已停止读取。")
                records.append(item)
        except (OSError, sqlite3.Error, TypeError, ValueError, UnicodeError):
            raise HistoryError("本地诊断读取失败。") from None
        return records

    def read(self, scope, limit=50):
        """返回指定报告最近的 limit 条问答，结果按时间从早到晚排列。

        报告绑定值也在密文中，因此按最新记录逐条解密、筛选，凑够数量后停止。
        发现损坏记录时终止读取，不能忽略异常后展示可能不完整的历史。
        """
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise HistoryError("历史分页参数错误。")
        entries = []
        try:
            # 报告绑定信息在密文里，不保存报告号、问题、答案等明文索引。
            for (payload,) in self._connection.execute("SELECT payload FROM history ORDER BY id DESC"):
                item = json.loads(self._protector.decrypt(payload).decode("utf-8"))
                if not isinstance(item, dict) or item.get("version") != 1 or not isinstance(item.get("entry"), dict):
                    raise HistoryError("历史内容格式错误，已停止读取。")
                if item.get("scope") == scope:
                    entries.append(item["entry"])
                    if len(entries) >= limit:
                        break
        except (OSError, sqlite3.Error, TypeError, ValueError, UnicodeError):
            raise HistoryError("本地历史读取失败；不会回显原始内容。") from None
        return entries[::-1]

    def close(self):
        """关闭已打开的数据库连接；允许初始化失败或退出清理时重复调用。"""
        if self._connection is not None:
            self._connection.close()
            self._connection = None


def default_history_path():
    """返回当前系统用户的本地应用目录，不在代码工作区保存个人问答。"""
    # 放在当前 Windows 用户的本地应用目录，避免进入代码仓库或漫游目录。
    base = os.getenv("LOCALAPPDATA")
    if not base or os.name != "nt":
        raise HistoryError("缺少 Windows 本地应用目录；不会改用工作区保存历史。")
    return Path(base) / "ReportAssistant" / "history.sqlite3"
