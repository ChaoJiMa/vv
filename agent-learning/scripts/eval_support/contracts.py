"""题目和预期的数据结构，独立于题目集合及报告构造。"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Step:
    """一轮问答的预期；词组每组命中一个，并独立检查事实引用与完整客服主题。"""

    question: str
    topic: str = ""
    required: tuple = ()
    forbidden: tuple = ()
    fields: tuple = ()
    kind: str = "report"
    max_chars: int = 500


@dataclass(frozen=True)
class Case:
    """独立会话及其连续问题；每个Case重建报告，避免跨题残留上下文。"""

    id: str
    category: str
    steps: tuple
    score: float = 69.5
    unconfirmed_education: bool = False
    with_report_date: bool = False
    display_rules: bool = False
