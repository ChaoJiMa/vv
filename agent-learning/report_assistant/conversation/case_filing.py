"""限高案件小结的立案日期纠正，独立校验记录来源和字段含义。"""

import re

from report_assistant.conversation.wording import HUMAN_REVIEW_REPLY
from report_assistant.reports.projection import parse_restriction_date


_ORDINARY_CASE = 'report.LIMITED_CONSUMPTION_00001[].'
_FILING_PATH = _ORDINARY_CASE + 'fileTime'
_PUBLICATION_PATH = _ORDINARY_CASE + 'issueTime'
_CLAUSE_SEPARATORS = '，,；;。！？!?'
_FILING_LABEL = r'(?:本案的?|该案的?|该案件的?)?(?:具体)?立案(?:时间|日期)(?:信息)?'
_UNAVAILABLE = r'(?:目前|当前|暂时|暂)?(?:未提供|未给出|未显示|未列出|无法确认|无法核实|无法确定)'
_DATE_VALUE = r'\d{4}\s*(?:[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}|年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)'
_CLAUSE_END = r'\s*(?=[，,；;。！!]|$)'
_FILING_GAP = re.compile(
    rf'(?P<before>^|[{_CLAUSE_SEPARATORS}])\s*'
    rf'(?:{_FILING_LABEL}[：:]?\s*(?:{_UNAVAILABLE}|暂无|不详|缺失)|{_UNAVAILABLE}\s*{_FILING_LABEL})'
    r'(?:[，,；;。]\s*(?:建议|请)?联系人工客服(?:进一步)?(?:核实|确认))?'
    + _CLAUSE_END
)
_FILING_CLAIM = re.compile(
    rf'(?P<before>^|[{_CLAUSE_SEPARATORS}])\s*{_FILING_LABEL}(?:为|是|[：:])\s*(?P<date>{_DATE_VALUE})'
    + _CLAUSE_END)
_PUBLICATION_CLAIM = re.compile(
    rf'(?P<before>^|[{_CLAUSE_SEPARATORS}])\s*(?:本案的?|该案的?|该案件的?)?发布(?:时间|日期)'
    rf'(?:为|是|[：:])\s*(?P<date>{_DATE_VALUE})' + _CLAUSE_END)


def _single_case_row(fact):
    """明细数组保留原记录的位置，只有单条且包装完整时才能直接归属日期。"""
    values = fact.get('value')
    if fact.get('status') != 'provided' or not isinstance(values, list) or len(values) != 1:
        return None
    row = values[0]
    if not isinstance(row, dict) or type(row.get('present')) is not bool:
        return None
    return row


def _replace_clause(text, match, replacement, *, human_if_empty=True):
    """只改命中的日期分句，保持其它已核实结论和原标点。"""
    before, after = text[:match.start()], text[match.end():]
    separator = match['before']
    if replacement:
        return before + separator + replacement + after
    if not before and not after.strip(_CLAUSE_SEPARATORS + ' '):
        return HUMAN_REVIEW_REPLY if human_if_empty else ''
    if before and after:
        connector = separator if separator in '。！？!?' or after[0] in '，,；;' else after[0]
        return before + connector + after[1:]
    return before or after.lstrip(_CLAUSE_SEPARATORS + ' ')


def correct_filing_gap(text, facts, field_paths, *, sources):
    """核对单条普通限高记录的两类日期，返回改写与新增引用。

    facts 和 field_paths 均按当前模块的字段引用索引。引用含其他实际记录组或多条案件时，
    无法判断小结指向哪条记录，保留原文。立案与发布分别只取各自字段。
    """
    roles = (
        (_FILING_CLAIM, _FILING_PATH, '立案时间'),
        (_FILING_GAP, _FILING_PATH, '立案时间'),
        (_PUBLICATION_CLAIM, _PUBLICATION_PATH, '发布时间'),
    )
    if not any(pattern.search(text) for pattern, _, _ in roles):
        return text, []

    same_group = False
    for ref in sources:
        fact = facts.get(ref, {})
        if fact.get('status') != 'provided':
            continue
        # 案号可来自同一数组的多个字段候选，仍须确保每个路径都属于这一组。
        paths = field_paths.get(ref, '').split('|')
        if not all(path.strip().startswith(_ORDINARY_CASE) for path in paths) or _single_case_row(fact) is None:
            return text, []
        same_group = True
    if not same_group:
        return text, []

    used = []
    for pattern, path, label in roles:
        matches = list(pattern.finditer(text))
        refs = [ref for ref in facts if field_paths.get(ref) == path]
        if not matches or len(refs) != 1:
            continue
        ref, = refs
        row = _single_case_row(facts[ref])
        if row is None:
            continue
        value = parse_restriction_date(row.get('value')) if row['present'] else None
        for match in reversed(matches):
            claimed = parse_restriction_date(match.groupdict().get('date'))
            if value is not None and value == claimed and ref in sources:
                continue
            text = _replace_clause(text, match, f'{label}为{value.isoformat()}' if value else '')
            if value and ref not in sources:
                used.append(ref)
    return text, list(dict.fromkeys(used))


def remove_repeated_restriction_dates(text):
    """汇总中的独立日期细项由已核验的案件小结承载。"""
    for pattern in (_FILING_CLAIM, _FILING_GAP, _PUBLICATION_CLAIM):
        for match in reversed(list(pattern.finditer(text))):
            text = _replace_clause(text, match, '', human_if_empty=False)
    return text
