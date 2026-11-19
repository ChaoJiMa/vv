"""来源约束的客服表达：只规范无数字的缺失解释，不改写实际数值或业务结论。"""

import re

from report_assistant.reports.tools import time_windows
from report_assistant.reports.projection import normalize_performance_state


_COUNT_GAP = re.compile(r'未提供|未显示|未给出|无法确认|无法确定|暂无|为空|缺失')
_APPLICATION_TOTAL = re.compile(r'(?:非银行|银行)?(?:全部机构)?申请(?:总)?(次数|机构数)')
_COUNT_WORDS = re.compile(r'(?:最近|过去|近)?\d{1,4}(?:天|个月|月|年)|'
                         r'具体次数|申请总次数|申请机构数|申请次数|机构数|次数|'
                         r'暂未提供|暂未显示|均未提供|未提供|未显示|未给出|无法确认|无法确定|暂时|尚未|暂无|为空|缺失|'
                         r'银行|非银行|报告|页面|当前|统计|结果|数据|记录|数值|具体|总计|以上|各项|这些|多个|各个|'
                         r'各类别|各类|各|窗口|周期|均|都|仍|尚|仅|有|'
                         r'至|到|与|和|及|以及|的|内|[\s，,、：:]')
_COUNT_PERIOD_REFERENCE = re.compile(r'(?:这些|上述|前述)(?:统计)?(?:周期|窗口)')
_WINDOW_SIZE = r'\s*(?:\d{1,4}|十二|十五|一个|[一二两三六七])\s*(?:个月|天|周|月|年)'
_ROLLING_WINDOW = r'(?:最近|过去|近)' + _WINDOW_SIZE
_INSTITUTION_WINDOW_LIST = re.compile(
    r'(?<![^。；;！？!?，,\n])\s*' + _ROLLING_WINDOW
    + r'(?:\s*(?:、|[，,]|和|与|以及|及)\s*(?:最近|过去|近)?' + _WINDOW_SIZE + r')+'
    r'(?:的|[，,]\s*)?(?:非银行|银行)?申请(?:总)?机构数(?:均|都|各|分别)?(?:为|是)\s*'
    r'\d{1,10}\s*(?:家|档)(?:\s*(?:、|和|与|以及|及)\s*\d{1,10}\s*(?:家|档))*$')
_REFERENCED_COUNT_GAP = re.compile(
    r'(?<![^。；;！？!?，,\n])\s*' + _COUNT_PERIOD_REFERENCE.pattern
    + r'(?:内)?的?(?:非银行|银行)?(?:具体)?申请(?:总)?次数(?:目前|仍|暂时|暂|尚)?(?:无法确认|无法确定|未提供)'
    r'(?=\s*(?:[。；;！？!?，,]|$))')
_SINGLE_WINDOW_COUNT = re.compile(
    r'(?<![^。；;！？!?，,\n])\s*(?P<window>' + _ROLLING_WINDOW + r')的?'
    r'(?:非银行|银行)?申请(?:总)?次数(?:为|是)\s*(?P<count>\d{1,10})\s*次'
    r'(?=\s*(?:[。；;！？!?，,]|$))')
SOCIAL_RISK_TAG_PATH = 'report.xhyFraudModel[].tagName'
SOCIAL_RISK_LEVEL_PATH = 'report.xhyFraudModel[].riskLevel'
SOCIAL_RISK_HUMAN_REVIEW = '风险标签的状态请联系人工客服核实。'
_SOCIAL_REVIEW_ASIDE = r'(?:建议|请)(?:联系)?人工(?:客服)?(?:进一步)?(?:核实|确认)'
_SOCIAL_RISK_QUALIFICATION = re.compile(
    r'(?:[，,；;。]\s*|^)(?:(?:以上|上述|这些|所列)?(?:风险)?标签)?'
    r'(?:均|都|全部)(?:为|是|属于)疑似(?:风险)?标签'
    rf'(?:[，,]\s*{_SOCIAL_REVIEW_ASIDE})?(?=\s*(?:[，,；;。！？!?]|$))')
_PHONE_GAP = re.compile(r'(?:手机号检测(?:结果)?|运营商核验结果)'
                        r'(?:目前|当前|暂时|暂)?(?:无法确认|无法核实|未提供|未显示)')
_PERFORMANCE_GAP = re.compile(r'(?:具体|实际)?(?:履行情况|履行状态)(?:字段|信息|为空|空白|未填写)*[，,]?'
                              r'(?:暂时|暂|仍|目前|尚)?(?:无法确认|无法判断|未提供|未展示|为空)'
                              r'(?:其|该|具体|实际)*(?:履行情况|履行状态)?'
                              r'|(?:暂时|暂|仍|目前|尚)?(?:无法确认|无法判断|未提供)'
                              r'(?:其|该|具体|实际)*(?:履行情况|履行状态)')
_PERFORMANCE_REVIEW = re.compile(
    r'(?<![^。；;！？!?，,\n])\s*(?:履行(?:情况|状态)虽然?(?:已经|已)?(?:填写|填报|有内容)'
    r'[，,]?(?:但|不过)(?:其)?(?:内容|文字|表述)?(?:暂时|暂)?(?:无法|不能)(?:明确)?'
    r'(?:说明|判断|对应|确认)(?:具体|实际)?履行(?:情况|状态)|' + _PERFORMANCE_GAP.pattern + r')'
    r'(?:[，,。；;]\s*(?:建议|请)?联系人工客服(?:进一步)?(?:核实|确认))?'
    r'(?=\s*(?:[。；;！？!?，,]|$))')
_PERFORMANCE_REVIEW_WITH_PUNCTUATION = re.compile(_PERFORMANCE_REVIEW.pattern + r'\s*[，,。；;！？!?]?')
# 原因套话须匹配完整分句；不删除含已知事实或具体业务原因的正文。
_REASON_PREFACE = r'(?:(?:目前|当前|现有|已|本次)?(?:所)?提供的信息|(?:目前|当前|这份|本份|该)?报告|现有信息|(?:这些|上述)信息)?'
_REASON_ABSENCE = r'(?:暂未|尚未|未|没有)(?:说明|列明|注明|提供|给出|显示|披露|记录)|(?:暂时|目前|仍|暂)?(?:无法|不能)(?:确认|判断|确定|核实|得知)'
_REASON_TARGET = (r'(?:具体|实际|详细)?(?:(?:是哪一项|是哪项|哪一项|哪项|哪方面)(?:信息)?(?:不一致|不匹配)'
                  r'|(?:不一致|不匹配|不相符|核验未通过)(?:的)?(?:具体|实际|详细)?(?:原因|缘由|原因说明))')
_REASON_ASIDE = re.compile(rf'{_REASON_PREFACE}(?:中|里)?\s*(?:{_REASON_ABSENCE})\s*{_REASON_TARGET}')
_FOLLOWING_CAUSE_ASIDE = re.compile(rf'{_REASON_PREFACE}(?:中|里)?\s*(?:{_REASON_ABSENCE})\s*(?:其|具体|详细)?(?:原因|缘由)')
_ASIDE_CONNECTOR = re.compile(r'^(?:但(?:是)?|不过|然而|而|也|并(?:且)?|且)\s*')
_ASK_MISMATCH_FIELD = re.compile(r'(?:哪项|哪一项|哪里|哪方面|什么信息).{0,8}(?:不一致|不匹配)')
_EXPLICIT_REASON = re.compile(r'为什么|为何|缘由|原因|由什么导致|是什么导致|怎么(?:会|导致)')
_BARE_PHONE_RESULT = re.compile(r'(?:您的|该)?(?:手机号检测(?:结果)?|运营商核验结果)(?:为|是|显示为?)?'
                               r'\s*[“"「『‘]?(?:不一致)[”"」』’]?[。！？!?]?')
HUMAN_REVIEW_REPLY = '具体情况请联系人工客服核实。'


def clear_unasked_reason(text, question, facts=(), *, suggest_human=True):
    """去掉核验原因套话，明确追问且只有核验结果可用时提供人工核实入口。"""
    parts = re.split(r'([，,。；;！？!?])', text)
    remaining, found, adjacent = [], False, False
    for index in range(0, len(parts), 2):
        clause, punctuation = parts[index], ''.join(parts[index + 1:index + 2])
        wording = _ASIDE_CONNECTOR.sub('', clause.strip(), count=1)
        after_result = remaining and _BARE_PHONE_RESULT.fullmatch(remaining[-1].strip().rstrip('，,；;'))
        if not (_REASON_ASIDE.fullmatch(wording)
                or (adjacent or after_result) and _FOLLOWING_CAUSE_ASIDE.fullmatch(wording)):
            remaining.append(clause + punctuation)
            adjacent = False
            continue
        found = adjacent = True
        if punctuation and punctuation in '。！？!?；;' and remaining and remaining[-1].endswith(('，', ',')):
            remaining[-1] = remaining[-1][:-1] + punctuation

    result = ''.join(remaining).strip('，,；; ') if found else text
    # 只有当前段明确引用了同一个检测结论，且正文没有可复述的具体原因时才引导人工。
    phone_value = None
    if facts and all(fact.get('status') == 'provided' and fact.get('name', '').startswith('手机号检测结果')
                     and fact.get('value') in ('一致', '不一致') for fact in facts):
        values = {fact['value'] for fact in facts}
        if len(values) == 1:
            phone_value = values.pop()
    if not result and phone_value:
        result = f'手机号检测结果为{phone_value}。'
    asks_detail = _ASK_MISMATCH_FIELD.search(question) or _EXPLICIT_REASON.search(question)
    if suggest_human and phone_value == '不一致' and asks_detail and _BARE_PHONE_RESULT.fullmatch(result.strip()):
        result = result.rstrip('。！？!?') + '。' + HUMAN_REVIEW_REPLY
    return result


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


def _application_examples(facts, statement, *, referenced_windows=()):
    """选择同一模块已展示的总次数和机构数，按窗口独立呈现，避免从分项推算总数。"""
    windows = referenced_windows or time_windows(statement)
    # “近X到近Y”指范围内的已登记窗口，而非两个可跨期相加的数字。
    in_range = len(windows) == 2 and bool(re.search(r'(?:天|月|年)\s*(?:至|到)', statement))
    window_days = lambda code: int(code[1:]) * (30 if code.startswith('M') else 1)
    relevant = {'机构数'} if '机构数' in statement else set()
    if '次数' in statement:
        relevant.add('次数')
    grouped = {}
    for fact in facts:
        if fact.get('status') != 'provided':
            continue
        name = re.sub(r'[（(](?:柱状图[，,]按窗口|按窗口)[）)]$', '', fact.get('name', ''))
        label = _APPLICATION_TOTAL.fullmatch(name.removesuffix('档位'))
        window = fact.get('window')
        if not label or label[1] not in relevant or not isinstance(window, str):
            continue
        if not re.fullmatch(r'近\d{1,4}(?:天|个月|月|年)', window):
            continue
        code, = time_windows(window)
        if windows and code not in windows and not (in_range and min(map(window_days, windows))
                                                     <= window_days(code) <= max(map(window_days, windows))):
            continue
        value = str(fact.get('value')).strip()
        unit = '次' if label[1] == '次数' else '家'
        if re.fullmatch(r'\d{1,10}', value) and not name.endswith('档位'):
            value += unit
        if not re.fullmatch(r'\d{1,10}(?:' + unit + '|档)', value):
            continue
        by_type = grouped.setdefault(code, {}).setdefault((label[1], value.endswith('档')), {})
        by_type[value] = (window, fact['field_ref'])
    if referenced_windows:
        # “这些周期”只承接前文明确列出的窗口；缺少某周期时只报有唯一次数来源的部分。
        all_counts = [grouped.get(code, {}).get(('次数', False), {}) for code in windows]
        values = [next(iter(count.items())) for count in all_counts if len(count) == 1]
        if not values:
            return '这些周期的申请次数请联系人工客服核实', []
        refs = [ref for _, (_, ref) in values]
        if len(values) == len(windows) and len({value for value, _ in values}) == 1:
            return '这些周期的申请次数均为' + values[0][0], refs
        periods_by_count = {}
        for value, (window, _) in values:
            periods_by_count.setdefault(value, []).append(window)
        statement = '；'.join('、'.join(periods) + '的申请次数为' + value
                             for value, periods in periods_by_count.items())
        return statement + ('，其余周期请联系人工客服核实' if len(values) < len(windows) else ''), refs
    result, used = [], []
    for code in sorted(grouped, key=window_days):
        metrics = []
        for metric in ('次数', '机构数'):
            choices = grouped[code].get((metric, False), {}) or grouped[code].get((metric, True), {})
            if len(choices) != 1:
                continue
            value, (window, ref) = next(iter(choices.items()))
            label = '申请' + metric + ('档位' if value.endswith('档') else '')
            metrics.append(window + label + '为' + value)
            used.append(ref)
        if metrics:
            result.append('，'.join(metrics))
        if len(result) == 2:
            break
    return '；'.join(result), used


def remove_social_risk_qualification(text):
    """删除汇总额外添加的统一定性，保留正式名称内的“疑似”。"""
    result = _SOCIAL_RISK_QUALIFICATION.sub('', text).lstrip('，,；;。！？!? ').rstrip('，,；; ')
    return result if result.strip('。.!！?？ ') else ''


def remove_repeated_social_risk_claims(text, tags):
    """汇总只保留其他结论，逐条标签和命中状态由模块小结承载。"""
    names = set()
    for fact in tags:
        for row in fact.get('value', []) if isinstance(fact.get('value'), list) else ():
            name = row.get('value') if isinstance(row, dict) and row.get('present') is True else None
            if isinstance(name, str) and len(name.removeprefix('疑似')) >= 2:
                names.update((name, name.removeprefix('疑似')))
    parts = re.split(r'([，,。；;！？!?])', text)
    remaining, linked_review = [], False
    for index in range(0, len(parts), 2):
        clause = parts[index].strip()
        punctuation = ''.join(parts[index + 1:index + 2])
        marked = re.search(r'命中|疑似(?:风险)?标签', clause)
        social = '社交风险' in clause or '风险标签' in clause or any(name in clause for name in names)
        drop_risk_claim = marked and (social or not remove_social_risk_qualification(clause))
        if drop_risk_claim or linked_review and re.fullmatch(_SOCIAL_REVIEW_ASIDE, clause):
            linked_review = bool(drop_risk_claim and punctuation in ('，', ','))
            if remaining and punctuation in '。！？!?' and punctuation and remaining[-1].endswith(('，', ',', '；', ';')):
                remaining[-1] = remaining[-1][:-1] + punctuation
            continue
        linked_review = False
        if clause:
            remaining.append(clause + punctuation)
    return ''.join(remaining).strip('，,；; ')


def has_application_count_details(text):
    """判断相应模块小结是否已展示需按周期绑定的次数。"""
    return '这些周期的申请次数均为' in text or bool(_SINGLE_WINDOW_COUNT.search(text))


def remove_repeated_application_counts(text):
    """汇总不再复述小结已核对的单周期次数或这些周期的缺失结论。"""
    for pattern in (_REFERENCED_COUNT_GAP, _SINGLE_WINDOW_COUNT):
        text = re.sub(pattern.pattern + r'\s*[，,。；;！？!?]?', '', text)
    return text.strip('，,；; ')


def correct_social_risk_summary(text, facts, field_paths, safe_label):
    """同源数组按行配对标签与状态，优先用报告原名和已确认结果渲染。"""
    refs = {field_paths[ref]: ref for ref in facts if ref in field_paths}
    tag_ref, level_ref = refs.get(SOCIAL_RISK_TAG_PATH), refs.get(SOCIAL_RISK_LEVEL_PATH)
    if not tag_ref and not level_ref:
        return text, []
    known_refs = [ref for ref in (tag_ref, level_ref) if ref]
    fallback = SOCIAL_RISK_HUMAN_REVIEW
    if not tag_ref or not level_ref:
        return fallback, known_refs
    tags, levels = (facts[ref].get('value') if facts[ref].get('status') == 'provided' else None
                    for ref in (tag_ref, level_ref))
    if isinstance(tags, list) and isinstance(levels, list) and not tags and not levels:
        return '这份报告未列出社交风险标签。', known_refs
    if not isinstance(tags, list) or not isinstance(levels, list) or len(tags) != len(levels):
        return fallback, known_refs
    by_status = {'命中': [], '未命中': []}
    incomplete = False
    uncertain_names = set()
    for tag, level in zip(tags, levels):
        name = safe_label(tag.get('value')) if isinstance(tag, dict) and tag.get('present') is True else None
        if not name:
            incomplete = True
            continue
        state = level.get('value') if isinstance(level, dict) and level.get('present') is True else None
        if not isinstance(state, str) or state not in by_status:
            uncertain_names.add(name)
            continue
        by_status[state].append(name)
    # 同一名称若出现冲突状态，不将其中一个状态推广到全部记录。
    conflicts = (set(by_status['命中']) & set(by_status['未命中'])) | uncertain_names
    sentences = []
    for state, names in by_status.items():
        confirmed = [name for name in dict.fromkeys(names) if name not in conflicts]
        if confirmed:
            sentences.append(f'报告标记为“{state}”的标签有' + '、'.join(confirmed) + '。')
    if not sentences:
        return fallback, known_refs
    if incomplete or conflicts:
        sentences.append('其他标签的状态请联系人工客服核实。')
    result = ''.join(sentences)
    return (result if len(result) <= 450 else fallback), known_refs


def performance_text(fact):
    """独立归纳已识别的状态，对其余含糊内容给人工核实入口。"""
    coverage = fact.get('detail_coverage')
    if coverage == 'no_records':
        return '这份报告的失信案件列表为空'
    if coverage == 'unreported':
        return '这份报告列有失信案件，履行情况未填写'
    if coverage not in {'partial', 'complete'}:
        return ''
    states = [normalize_performance_state(row.get('value')) if isinstance(row, dict) and row.get('present') is True else ''
              for row in fact.get('value', [])]
    values = list(dict.fromkeys(state for state in states if state))
    if not values:
        return '履行状态请联系人工客服核实'
    text = '报告列出的履行状态包括' + '、'.join(values)
    return text + ('，其余记录请联系人工客服核实' if '' in states else '')


def correct_module_gaps(text, facts, module_name):
    """用该模块独立核实的事实替换笼统缺失描述，并把确切来源交还正常校验。"""
    used = []
    if module_name in {'银行申请', '非银行申请'}:
        def different_provider(statement):
            return any(provider != module_name.removesuffix('申请')
                       for provider in re.findall(r'非银行|银行', statement))

        def referenced_counts(match):
            # 只承接紧邻的机构数分句，不能从更早的无关数字推断本次周期。
            before = text[:match.start()].rstrip('，,；;。！？!? \n')
            context = _INSTITUTION_WINDOW_LIST.search(before)
            if context is None or different_provider(context[0] + match[0]):
                return match[0]
            windows = time_windows(context[0])
            if len(windows) < 2:
                return match[0]
            replacement, refs = _application_examples(facts, match[0], referenced_windows=windows)
            used.extend(refs)
            return replacement or match[0]

        def single_window_count(match):
            # 数值虽然出现在同一模块内，也必须核对它属于声明的同一个周期。
            if different_provider(match[0]):
                return match[0]
            replacement, refs = _application_examples(facts, match[0])
            verified = re.search(r'为(\d{1,10})次$', replacement)
            if not verified:
                return match['window'].strip() + '的申请次数请联系人工客服核实'
            used.extend(refs)
            return match[0] if int(match['count']) == int(verified[1]) else replacement

        text = _SINGLE_WINDOW_COUNT.sub(single_window_count, text)
        text = _REFERENCED_COUNT_GAP.sub(referenced_counts, text)

        def counts(match):
            statement = match[0]
            if not ('次数' in statement or '机构数' in statement) or not _COUNT_GAP.search(statement):
                return statement
            if different_provider(statement) or _COUNT_PERIOD_REFERENCE.search(statement) or _COUNT_WORDS.sub('', statement):
                return statement
            replacement, refs = _application_examples(facts, statement)
            used.extend(refs)
            return replacement or statement
        text = re.sub(r'[^。；;！？!?]+', counts, text)

    phone = [fact for fact in facts if fact.get('name', '').startswith('手机号检测结果')
             and fact.get('status') == 'provided' and fact.get('value') in ('一致', '不一致')]
    if phone and len({fact['value'] for fact in phone}) == 1 and _PHONE_GAP.search(text):
        text = _PHONE_GAP.sub('手机号检测结果为' + phone[0]['value'], text)
        used.append(phone[0]['field_ref'])

    # 只在原小结否认或笼统描述履行信息时修正，不能用某个列表推断另一来源。
    details = [fact for fact in facts if performance_text(fact)]
    if len(details) == 1:
        text, count = _PERFORMANCE_REVIEW.subn(lambda _: performance_text(details[0]), text, count=1)
        if count:
            used.append(details[0]['field_ref'])
    return text, list(dict.fromkeys(used))


def remove_repeated_performance_gap(text):
    """整体总结只移除独立重复的履行缺失分句，保留同句的其他结论。"""
    return _PERFORMANCE_REVIEW_WITH_PUNCTUATION.sub('', text).strip('，,；; ')
