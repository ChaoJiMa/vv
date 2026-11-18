"""回答校验统一入口：协调身份、滚动周期、时长及实际来源数字，不读取配置。"""

from datetime import date
import json
import re
from report_assistant.security.privacy import PrivacyError
from report_assistant.security.text import normalized
from report_assistant.security.answer_identity import (
    IDENTITY, PUBLIC_PHONE_METRIC, INJECTION, CONTACT, SAFE_LABEL, STATISTIC, NUMBER, SHORT_IDENTIFIER, has_identity_label, negative_zero_text, assertion_text,
)
from report_assistant.security.answer_periods import answer_window_content, _without_list_markers, _without_denied_window_repeat
from report_assistant.security.answer_durations import duration_source_roles, _without_verified_duration, _normalize_duration_bound


def answer_numeric_content(value):
    """提取数值、百分比及完整日期；只等价化书写格式，不放宽来源授权。

    仅在完整且有效的年月日中将短横线视为分隔符，其他负号保持原义。
    日期另按整组核对，防止用来源已有的月份、日期拼出另一日期。
    """
    value = normalized(value)
    dates = set()

    def canonical_date(match):
        year = int(match['year'])
        month = int(match['month'] or match['cn_month'])
        day = int(match['day'] or match['cn_day'])
        try:
            dates.add(date(year, month, day))
        except ValueError:
            # 无效日期不做格式等价化，仅允许来源原样出现的字面内容。
            dates.add(match.group())
            return match.group()
        return f'{year} {month} {day}'

    value = re.sub(r'(?<![\d.\-])(?P<year>\d{4})\s*'
                   r'(?:(?P<sep>[-/.])\s*(?P<month>\d{1,2})\s*(?P=sep)\s*(?P<day>\d{1,2})'
                   r'|年\s*(?P<cn_month>\d{1,2})\s*月\s*(?P<cn_day>\d{1,2})\s*日)(?!\d)',
                   canonical_date, value)
    # 千分位仅接受完整三位分组，错误分隔和独立数字列表不能拼成新数。
    value = re.sub(r'(?<![\d,.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])',
                   lambda match: match.group().replace(',', ''), value)
    return (set(re.findall(r'-?\d+(?:\.\d+)?', value)),
            set(re.findall(r'(-?\d+(?:\.\d+)?)\s*[%％]', value)), dates)


def check_answer_numbers(text, facts, *, duration_roles=None):
    """核对回答数字；缺失来源允许明确否定的零比较，不给零值陈述放行。

    “未提供，不能按0次理解”中的0是解释缺失的对照值，不是报告事实。
    只移除紧随固定否定短语的单独0，其余金额、次数和比例仍按实际来源核验。
    duration_roles可按field_ref给出同一已核验小结原来源角色组；它只限制已展示值的
    指标/时长/边界，不把原字段值、原数字或未展示指标追加到事实集合。
    """
    text = normalized(text)
    if any(fact.get('status') in {'missing', 'null', 'empty', 'withheld'} for fact in facts):
        text = negative_zero_text(text)
    source = json.dumps([{k: v for k, v in fact.items() if k in {'value', 'window', 'name', 'presentation'}}
                         for fact in facts], ensure_ascii=False, allow_nan=False)
    source, source_windows = answer_window_content(source)
    text = _without_list_markers(text)
    text = _without_denied_window_repeat(text, source_windows)
    text, text_windows = answer_window_content(text)
    text = _without_verified_duration(_normalize_duration_bound(text), facts, duration_roles=duration_roles)
    text_numbers, text_percentages, text_dates = answer_numeric_content(text)
    source_numbers, source_percentages, source_dates = answer_numeric_content(source)
    # 页面已经展示的还款成功率等百分比属于报告事实；不能一律禁止百分号。
    # 必须在所引来源中存在相同的百分比，普通数字0不能授权回答0%或任意换算。
    if (not text_numbers <= source_numbers
            or not text_percentages <= source_percentages
            or not text_dates <= source_dates or not text_windows <= source_windows):
        raise PrivacyError('回答包含未验证数字。')
