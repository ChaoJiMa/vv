"""回答滚动周期与列表标号的核验；周期数字不能借作事实数量。"""

import re
from report_assistant.security.privacy import PrivacyError
from report_assistant.security.text import normalized
from report_assistant.reports.tools import time_windows

def answer_window_content(text):
    """把明确滚动周期单独核验，复用项目的周/年/天别名，不转换自然月。

    周期中的数字不再充当次数或金额的依据；只有完整同义周期才能通过，
    来源近1年可支持近12个月，但不能因此支持12条记录或任意其他周期。
    """
    windows = set()

    def replace(match):
        values = time_windows(match['window'])
        if not values:
            return match.group()
        # 括号只能复述同一周期，不能用“近一周（8天）”拼接不同范围。
        if match['restated'] and time_windows(match['restated']) != values:
            raise PrivacyError('回答包含不一致的周期复述。')
        windows.update(values)
        return '[滚动周期]'

    # “这一周期”中的“周”属于词语“周期”，并不是额外的近7天窗口。
    period = (r'(?:\d+|十二|十五|一个|[一二两三六七半])\s*'
              r'(?:个月(?!份)|天(?!数)|周(?!期|数)|月(?!份|度)|年(?!级|度|份|代))')
    text = re.sub(r'(?P<window>(?:最近|过去|近|这|该)\s*' + period + r')'
                  r'(?:\s*[(（](?P<restated>(?:最近|过去|近)?\s*' + period + r')[)）])?',
                  replace, normalized(text))
    return text, windows


def _without_list_markers(text):
    """只忽略至少两项、从1连续递增的行首编号；小数、单独数字及正文数量照常核验。"""
    marker = re.compile(r'(?m)^[ \t]*(\d{1,2})[.)、][ \t]+(?=\S)')
    matches = list(marker.finditer(text))
    # “1. 次 / 2. 次”可能把数量写在标点前，不能当作编号删除后绕过来源校验。
    # “次数”“档位”等明确指标名仍可作为列表正文开头。
    unit_start = re.compile(r'(?!(?:次数|条数|档位|分数|年份|年收入|月收入))'
                            r'(?:次|家|条|档|万元|亿元|元|分|天|周|个月|月|年|[%％])')
    if any(unit_start.match(text[match.end():]) for match in matches):
        return text
    if len(matches) >= 2 and [int(match[1]) for match in matches] == list(range(1, len(matches) + 1)):
        return marker.sub('', text)
    return text


def _without_denied_window_repeat(text, allowed_windows):
    """同一短句已明确否认某周期数据时，只移除随后重复的周期，不豁免事实数值。"""
    pattern = (r'(?P<prefix>未(?:单独)?提供(?:最近|过去|近)\s*'
               r'(?P<period>\d{1,3}\s*(?:个月|天|周|月|年))(?:的)?(?:数据|结果)[，,；;]\s*'
               r'(?:不能|不可|不应)(?:直接)?按)(?P=period)(?P<suffix>(?:来)?确认)')

    def replace(match):
        values = set(time_windows(match['period']))
        if not values or not values <= allowed_windows:
            return match.group()
        return match['prefix'] + '该周期' + match['suffix']

    return re.sub(pattern, replace, text)
