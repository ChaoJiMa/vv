"""失败校验的受限证据：只保留类型、序号和时长角色，不保存问答或报告原文。"""

import re


STATUSES = {'provided', 'missing', 'null', 'empty', 'withheld', 'unknown'}
TYPES = {'string', 'number', 'boolean', 'object', 'array', 'null', 'other'}
BOUNDS = {'exact', 'lower', 'upper', 'strict_upper', 'unsupported'}


def duration_observation(text, facts, duration_roles=None):
    """把当前被拒段落与实际所引来源变成有界角色对照；指标原名只在内存用于匹配。"""
    from report_assistant.security.answer_durations import (
        _DURATION, _duration_key, _matches_named_duration, _structured_duration_matches,
        _raw_duration_entries, _displayed_duration_roles, _normalize_duration_bound)
    from report_assistant.security.answer_periods import answer_window_content
    from report_assistant.security.privacy import PrivacyError
    from report_assistant.security.text import normalized
    from report_assistant.reports.tools import time_windows

    def quantity(match):
        key = _duration_key(match)
        return {'months': key[0] if key else None, 'bound': key[1] if key else 'unsupported',
                'unit': 'year' if match['unit'] == '年' else 'month',
                'form': 'arabic' if match['number'].isdecimal() else 'chinese'}

    rows, roles = [], []
    for fact in facts:
        value = fact.get('value')
        kind = ('null' if value is None else 'boolean' if type(value) is bool else
                'number' if type(value) in (int, float) else 'string' if isinstance(value, str) else
                'object' if isinstance(value, dict) else 'array' if isinstance(value, list) else 'other')
        normalized_value = _normalize_duration_bound(normalized(value)) if isinstance(value, str) else ''
        matches = (list(_DURATION.finditer(normalized_value)) if isinstance(value, str) else
                   [match for _, match in _structured_duration_matches(fact)])
        ref = fact.get('field_ref')
        rows.append({'ref': ref if isinstance(ref, str) and re.fullmatch(r'f\d{1,6}', ref) else None,
                     'status': fact.get('status') if fact.get('status') in STATUSES else 'unknown',
                     'type': kind, 'has_window': bool(fact.get('window')),
                     'windows': [window for window in time_windows(fact.get('window', ''))
                                 if re.fullmatch(r'[DM]\d{1,4}', window)][:12],
                     'durations': [quantity(match) for match in matches[:12]]})
        if fact.get('status') in {'missing', 'null', 'empty', 'withheld'}:
            continue
        if duration_roles is not None:
            entries = _displayed_duration_roles(normalized_value, duration_roles.get(ref, ()))
        else:
            entries = _raw_duration_entries(fact)
        roles.extend(entries)
    text_length = min(len(text), 100000)
    try:
        # 与校验入口一致：已识别统计周期单列，不能误标成个人持续时长。
        text, answer_windows = answer_window_content(text)
    except PrivacyError:
        answer_windows = set()
    text = _normalize_duration_bound(text)
    claims, matches = [], list(_DURATION.finditer(text))
    for match in matches[:12]:
        key = _duration_key(match)
        scoped = False
        for _, name, strict in roles:
            try:
                if name and _matches_named_duration(text[:match.start()], name, strict):
                    scoped = True
            except PrivacyError:
                pass
        claims.append({**quantity(match), 'same_metric_source': scoped,
                       'same_value_source': key is not None and any(key == source_key for source_key, _, _ in roles)})
    return {'text_length': text_length, 'source_count': min(len(facts), 4096),
            'answer_windows': sorted(window for window in answer_windows if re.fullmatch(r'[DM]\d{1,4}', window))[:12],
            'sources': rows[:12], 'claims': claims,
            'truncated': len(rows) > 12 or len(matches) > 12
                         or any(len(row['durations']) == 12 for row in rows)}


def valid_evidence(value, codes, subreasons):
    """读写共用严格白名单；拒绝额外键、自由文本、布尔伪整数及超量嵌套。"""
    def integer(x, maximum):
        return type(x) is int and 0 <= x <= maximum

    def keys(x, names):
        return isinstance(x, dict) and set(x) == set(names.split())

    def quantity(x, claim=False):
        return (keys(x, 'months bound unit form' + (' same_metric_source same_value_source' if claim else ''))
                and (x['months'] is None or type(x['months']) in (int, float) and 0 < x['months'] <= 1200)
                and isinstance(x['bound'], str) and x['bound'] in BOUNDS
                and x['unit'] in ('year', 'month') and x['form'] in ('arabic', 'chinese')
                and (not claim or type(x['same_metric_source']) is bool and type(x['same_value_source']) is bool))

    def observation(x):
        if x is None:
            return True
        if (not keys(x, 'text_length source_count answer_windows sources claims truncated')
                or not integer(x['text_length'], 100000) or not integer(x['source_count'], 4096)
                or not isinstance(x['answer_windows'], list) or len(x['answer_windows']) > 12
                or not all(isinstance(window, str) and re.fullmatch(r'[DM]\d{1,4}', window)
                           for window in x['answer_windows'])
                or type(x['truncated']) is not bool or not isinstance(x['sources'], list)
                or len(x['sources']) > 12 or not isinstance(x['claims'], list) or len(x['claims']) > 12):
            return False
        for source in x['sources']:
            if (not keys(source, 'ref status type has_window windows durations')
                    or not (source['ref'] is None or isinstance(source['ref'], str)
                            and re.fullmatch(r'f\d{1,6}', source['ref']))
                    or not isinstance(source['status'], str) or source['status'] not in STATUSES
                    or not isinstance(source['type'], str) or source['type'] not in TYPES
                    or type(source['has_window']) is not bool
                    or not isinstance(source['windows'], list) or len(source['windows']) > 12
                    or not all(isinstance(window, str) and re.fullmatch(r'[DM]\d{1,4}', window)
                               for window in source['windows'])
                    or not isinstance(source['durations'], list) or len(source['durations']) > 12
                    or not all(quantity(q) for q in source['durations'])):
                return False
        return all(quantity(q, True) for q in x['claims'])

    if (not keys(value, 'request_count elapsed_ms retry_used attempts')
            or not integer(value['request_count'], 100) or not integer(value['elapsed_ms'], 86400000)
            or type(value['retry_used']) is not bool or not isinstance(value['attempts'], list)
            or not 1 <= len(value['attempts']) <= 2):
        return False
    for attempt in value['attempts']:
        if (not keys(attempt, 'stage batch position code subreason observation')
                or attempt['stage'] not in ('prepare', 'modules', 'summary')
                or not integer(attempt['batch'], 32) or not integer(attempt['position'], 8)
                or not isinstance(attempt['code'], str) or attempt['code'] not in codes
                or not (attempt['subreason'] is None or isinstance(attempt['subreason'], str)
                        and attempt['subreason'] in subreasons)
                or not observation(attempt['observation'])):
            return False
    return True
