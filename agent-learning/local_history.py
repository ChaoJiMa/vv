"""Windows 当前用户 DPAPI 加密历史；写入 SQLite 前加密，不落盘明文。"""

import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import sqlite3


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
    """SQLite 只存密文；报告标识、问题、答案都包含在加密 payload 内。"""

    def __init__(self, path, protector=None):
        """建立历史库；protector 可由测试注入，正式运行默认使用 Windows DPAPI。"""
        self._protector = protector if protector is not None else WindowsProtector()
        self._connection = None
        try:
            path = Path(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            self._connection = sqlite3.connect(path)
            self._connection.execute("CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
            self._connection.commit()
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
