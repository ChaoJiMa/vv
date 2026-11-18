"""来源约束的客服表达：只规范无数字的缺失解释，不改写实际数值或业务结论。"""

import re


def metric_unit(fact):
    """按已登记指标名选择量词，未知指标不猜；记录数优先于一般次数。"""
    name = fact.get('name', '')
    for marker, unit in (('记录数', '条'), ('机构数', '家'), ('次数', '次'), ('档位', '档')):
        if marker in name:
            return unit
    return ''


def natural_missing_text(text, facts):
    """单一已引用且确为缺失的计数指标才规范尾句；多来源、实际数字及开放判断原样保留。"""
    if not isinstance(text, str):
        # 畸形模型正文交回既有协议校验拒绝，不让表达修饰抢先抛出未分类的类型异常。
        return text
    if len(facts) != 1 or facts[0].get('status') not in {'missing', 'null', 'empty'}:
        return text
    noun = {'条': '条数', '家': '机构数', '次': '次数'}.get(metric_unit(facts[0]))
    if noun:
        return re.sub(r'无法确认具体(?:次数|条数|机构数)', '无法确认具体' + noun, text)
    return text
