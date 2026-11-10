"""无业务依赖的文本归一化及固定协议字符串收集。"""

import unicodedata


def string_leaves(value):
    """收集程序固定结构中的完整字符串及键，供按来源授权；不能传入原始报告或模型回包。"""
    if isinstance(value, dict):
        return set(value) | set().union(*(string_leaves(child) for child in value.values()))
    if isinstance(value, (list, tuple)):
        return set().union(*(string_leaves(child) for child in value))
    return {value} if isinstance(value, str) else set()


def normalized(text):
    """统一全角和不可见字符，避免分隔符绕过本地检查。"""
    return "".join(c for c in unicodedata.normalize("NFKC", text) if unicodedata.category(c) != "Cf")
