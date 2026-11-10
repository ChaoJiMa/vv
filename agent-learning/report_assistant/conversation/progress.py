"""终端等待反馈：仅输出固定状态，不访问问题、报告、模型或加密历史。"""

import sys
from threading import Event, Thread
from time import monotonic


class TurnProgress:
    """用独立提示线程显示等待时间，实际问答始终留在调用线程。"""

    def __init__(self, interval=10.0, stream=None):
        """interval为提示间隔秒数；stream用于终端输出或测试捕获。"""
        self.interval = interval
        self.stream = sys.stdout if stream is None else stream
        self._stop = Event()
        self._thread = None

    def __enter__(self):
        """先刷新接收提示再启动计时，让首次网络请求之前就有反馈。"""
        print("\n已收到，正在处理，请稍候……", file=self.stream, flush=True)
        self._started = monotonic()
        self._thread = Thread(target=self._notify, name="report-turn-progress", daemon=True)
        self._thread.start()
        return self

    def _notify(self):
        """每隔一段时间输出固定状态；计时不表示模型阶段或完成比例。"""
        while not self._stop.wait(self.interval):
            elapsed = int(monotonic() - self._started)
            try:
                print(f"仍在处理，已等待{elapsed}秒，请稍候……", file=self.stream, flush=True)
            except (OSError, ValueError):
                # 终端关闭不应让提示线程输出含调用栈的异常；主线程仍负责本轮收尾。
                self._stop.set()

    def __exit__(self, *_):
        """成功、异常和Ctrl+C均停止并回收提示线程，不吞掉原异常。

        Event唤醒避免退出额外等待一个提示周期；join保证答案或下一输入提示
        出现后不会再插入旧轮状态。SQLite及会话状态不跨线程操作。
        """
        self._stop.set()
        self._thread.join()
