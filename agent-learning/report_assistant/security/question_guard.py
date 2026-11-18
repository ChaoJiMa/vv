"""自然问题与外发载荷的个人信息守卫，不提供报告数值读取能力。"""

import json
import re

from report_assistant.security.privacy import PrivacyError
from report_assistant.security.redaction import NAME_LIST, REDACTED, protected_key, redact_text, CREDENTIAL, LABELED_CREDENTIAL
from report_assistant.security.text import normalized
from report_assistant.security.answer_validation import (CONTACT, IDENTITY, INJECTION, NUMBER, SAFE_LABEL, SHORT_IDENTIFIER, has_identity_label)


class QuestionGuard:
    """检查本会话禁止发送的数据；个人资料可授权开放，凭据始终禁止。"""

    def __init__(self, tools, *, allow_personal=False):
        """按本会话授权决定是否过滤个人资料；凭据识别始终启用。"""
        self.allow_personal = allow_personal
        self._private = tools.private_literals(allow_personal=True) if allow_personal else tools.private_literals()
        short = {literal for literal in self._private if SHORT_IDENTIFIER.fullmatch(literal)}
        self._private_text = self._private - short
        self._private_numbers = tuple(literal for literal in self._private if len(literal) > 3 and NUMBER.fullmatch(literal))
        # 预先分类和编译，避免每个消息叶子重复扫描、编译全部私有字面量的规则。
        self._short_pattern = re.compile(r"(?<![\w.])(?:" + "|".join(re.escape(s) for s in sorted(short)) + r")(?![\w.])") if short else None

    def question(self, text):
        """返回可发送的规范化自然问题；不通过时拒绝，不使用模型协助脱敏。"""
        text = normalized(text).strip()
        if not text or len(text) > 2000 or self.contains_private(text) or self.blocked_label(text) or self.blocked_contact(text):
            raise PrivacyError("问题包含可能的身份或凭据，请去掉个人信息后重新提问。")
        return text

    def blocked_label(self, text, **kwargs):
        """开放个人资料后只拒绝凭据标签；旧模式保留来源感知的身份泛称规则。"""
        return bool(CREDENTIAL.search(normalized(text))) if self.allow_personal else has_identity_label(text, **kwargs)

    def blocked_contact(self, text):
        """真实个人号码可按授权外发，密钥/JWT样式仍不允许进入动态内容。"""
        return bool(re.search(r'(?:sk-|eyJ)[A-Za-z0-9_-]{12,}', normalized(text), re.I)) if self.allow_personal else bool(CONTACT.search(text))

    def contains_private(self, text):
        text = normalized(text).casefold()
        return any(literal in text for literal in self._private)

    def _contains_payload_private(self, text):
        """检查已重建协议中的字符串；短编号须独立成词，不能与f1、近1个月等通用标签混淆。

        问题仍用严格子串检查；报告文字和明细须先经过本地递归过滤。
        """
        text = normalized(text).casefold()
        return (any(literal in text for literal in self._private_text)
                or bool(self._short_pattern and self._short_pattern.search(text))
                or self.blocked_contact(text) or bool(LABELED_CREDENTIAL.search(text)))

    def contains_analysis_private(self, text):
        """正文保留身份文本/较长标识检查；短数字交给来源与数字核验，避免把统计值当身份。

        这里只用于需要有效事实引用的分析段落，不能代替自然问题检查。
        """
        text = normalized(text).casefold()
        return any(literal in text for literal in self._private_text)

    def statistic_is_private(self, number):
        """禁止个人号码混入统计值；其他业务编号不因长度或重复出现被排除。"""
        text = str(number)
        return any(literal in text for literal in self._private_numbers) or self.blocked_contact(text)

    def redact(self, value, parent=""):
        """返回脱敏副本，递归保留其他字段；不修改本地报告或借模型执行过滤。

        数组读取包装中的 present/value 保留原语义，候选路径包装的 path 去掉，
        防止工具接口暴露真实路径。非有限数值由调用方标记为 withheld。
        """
        if isinstance(value, dict):
            wrapper = "present" in value and set(value) <= {"path", "present", "value"}
            return {redact_text(str(key), self._private, allow_personal=self.allow_personal): self.redact(child, f"{parent}.{key}")
                    for key, child in value.items()
                    if not (wrapper and key == "path") and not protected_key(key, parent, allow_personal=self.allow_personal)}
        if isinstance(value, list):
            names = not self.allow_personal and NAME_LIST.fullmatch(parent.rsplit(".", 1)[-1])
            return [REDACTED if names and not isinstance(child, (dict, list)) else self.redact(child, parent) for child in value]
        if isinstance(value, str):
            if value.lstrip().startswith(("{", "[")):
                try:
                    nested = json.loads(value)
                except (ValueError, TypeError):
                    pass
                else:
                    return json.dumps(self.redact(nested, parent), ensure_ascii=False, allow_nan=False)
            return redact_text(value, self._private, allow_personal=self.allow_personal)
        if type(value) in (int, float) and self.statistic_is_private(value):
            return REDACTED
        return value

    def check_payload(self, value, *, trusted_strings=()):
        """按结构检查固定协议和已投影事实，不把协议数字或统计值当作身份编号。

        自由问题先由question严格检查，事实先经路径/标签/数值投影。这里只检查
        字符串叶子及键；trusted_strings仅接收程序固定协议和生成引用的完整字符串，
        不按子串豁免，也不能用于问题检查。工具参数和回执内的JSON对象/数组递归检查，不能扫描其
        序列化数字后把页码、工具预算、统计零值误认为身份。普通业务编号允许通过。
        """
        # 保留非有限数字及不可序列化值的拒绝语义。
        json.dumps(value, ensure_ascii=False, allow_nan=False)
        trusted = frozenset(normalized(text) for text in trusted_strings)

        def is_private(text):
            return normalized(text) not in trusted and self._contains_payload_private(text)

        def checked_pairs(items):
            result = {}
            for key, child in items:
                if key in result:
                    raise PrivacyError("请求JSON含重复键。")
                result[key] = child
            return result

        def invalid_constant(_):
            raise PrivacyError("请求JSON含非有限数值。")

        def check(item):
            if isinstance(item, dict):
                for key, child in item.items():
                    if is_private(str(key)):
                        raise PrivacyError("请求包含本地私有信息。")
                    check(child)
            elif isinstance(item, (list, tuple)):
                for child in item:
                    check(child)
            elif isinstance(item, str):
                text = normalized(item)
                # 模型参数及工具回执由程序encode生成；只解析容器，不把裸编号字符串转成数字。
                if text.lstrip().startswith(("{", "[")):
                    try:
                        nested = json.loads(text, object_pairs_hook=checked_pairs, parse_constant=invalid_constant)
                    except json.JSONDecodeError:
                        pass
                    else:
                        if isinstance(nested, (dict, list)):
                            check(nested)
                            return
                if is_private(text):
                    raise PrivacyError("请求包含本地私有信息。")

        check(value)

    def label(self, text):
        """仅接收通用目录的短标签；不转发后端自由文案或路径。"""
        if not isinstance(text, str):
            return None
        text = normalized(text)
        identity = CREDENTIAL.search(text) if self.allow_personal else IDENTITY.search(text)
        if not SAFE_LABEL.fullmatch(text) or self._contains_payload_private(text) or identity or self.blocked_contact(text) or INJECTION.search(text):
            return None
        return text
