"""同指标时长、范围边界与已展示来源角色校验；不扩展任何数字授权。"""

import re
from report_assistant.security.privacy import PrivacyError
from report_assistant.security.text import normalized, string_leaves
from report_assistant.security.answer_identity import _PHONE_DURATION_CONTEXT

_DURATION_NUMBERS = {'一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6,
                     '七': 7, '八': 8, '九': 9, '十': 10, '十二': 12, '二十四': 24, '半': 0.5}
_DURATION = re.compile(r'(?<![\d.至到~～\-零〇一二两三四五六七八九十百千万半])'
                       r'(?P<verb>达到(?:了)?)?'
                       r'(?P<prefix>至少|不少于|不低于|至多|最多|不超过|尚未满|未满|不满|(?:已经|已)?满)?'
                       r'(?P<number>\d+|[零〇一二两三四五六七八九十百千万半]{1,6})'
                       r'\s*(?P<unit>个月(?!份)|年(?!级|度|份|代))'
                       r'(?P<suffix>及以上|以上|或更久|或更长|及以下|以下)?')
# phone页面有限区间保留有序双端点；不把两个数字当独立精确时长，也不处理复合单位。
_PHONE_INTERVAL = re.compile(r'(?<![\d.])(?P<lo>\d+)\s*[-–—~～至到]\s*(?P<hi>\d+)\s*'
                             r'(?P<unit>个月(?!份)|年(?!级|度|份|代))(?![\d.])')
# 谓语按“时间副词 + 时态 + 系词/动作 + 动态助词”组合，不按模型整句设白名单。
# 动词只负责绑定同一指标，不能把裸“两年”自动解释成“至少两年”。
_DURATION_PREDICATE = (r'(?:目前|当前|现在)?(?:已经|已)?'
                       r'(?:(?:显示|展示)(?:为|是)?|为|是|(?:有|使用|用|持续|达到)(?:了)?)?'
                       r'\s*(?:[:：]\s*)?[“"「]?$')
_DURATION_DISCOURSE = (r'(?:也就是(?:说)?|也即|即|相当于|换句话说|(?:这)?(?:表示|意味着|说明)|可(?:以)?理解为|'
                       r'(?:通俗|简单)(?:地)?(?:说|来说)(?:就是)?)')
# 只消费已知功能词和phone业务词，不用任意文字通配。每个字词都须成功消费到时长量之前。
_PHONE_RELATION_WORD = re.compile(
    r'已经|目前|当前|现在|运营商|在网|入网|网络|使用|开通|时长|时间|显示|展示|持续|达到|方面|之间|所用|'
    r'这|那|其|该|此|个|家|里|边|处|的|在|从|自|与|中|内|已|为|是|有|用|了|[:：]')
_PHONE_DURATION_NAMES = frozenset({
    '手机在网时长', '手机在网时间', '手机号在网时长', '手机号在网时间',
    '手机号码在网时长', '手机号码在网时间', '在网时长', '在网时间', '入网时长', '入网时间',
})
# 受限phone声明帧只允许业务名词与功能词；电脑/贷款/其他实质词不能作为可忽略噪声。
_PHONE_FRAME_WORD = re.compile(
    r'手机号码|手机号|运营商|在网|入网|网络|使用|开通|时长|时间|范围|区间|结果|下限|上限|多久|'
    r'报告|当前|目前|现在|所示|给出|看到|显示|展示|对应|就是|表示|意味着|说明|已经|所用|'
    r'提供|通信|通话|短信|上网|服务|之间|方面|来说|相当于|手机|号码|'
    r'您|你|这|那|其|该|此|它|个|项|份|里|中|边|处|家|的|从|自|在|对|与|和|及|'
    r'已|有|用|了|是|为|指|说|即')


def _phone_frame_words(text, current):
    """提取同句phone封闭词法；时长量仅在此证明视图移除，数值和边界另行严格核对。"""
    separators = '。；;!?！？\n'
    start = max(text.rfind(mark, 0, current.start()) for mark in separators) + 1
    ends = [text.find(mark, current.end()) for mark in separators]
    end = min((position for position in ends if position >= 0), default=len(text))
    frame = text[start:end]
    # 仅移除无数字、无新主体的闭合精度说明，不能把任意否定或其他指标当作噪声。
    frame = re.sub(r'[，,]\s*(?:(?:具体|精确)(?:时长|时间)(?:目前)?无法确认|'
                   r'无法确认(?:具体|精确)(?:时长|时间))\s*$', '', frame)
    quantities = sorted([*_DURATION.finditer(frame), *_PHONE_INTERVAL.finditer(frame)], key=lambda row: row.start())
    parts, offset = [], 0
    for quantity in quantities:
        if quantity.start() < offset:
            continue
        parts.append(frame[offset:quantity.start()])
        offset = quantity.end()
    parts.append(frame[offset:])
    remainder, offset, words = ' '.join(parts), 0, []
    while offset < len(remainder):
        if remainder[offset].isspace() or remainder[offset] in '，,、:：.\"“”「」（）()':
            offset += 1
            continue
        word = _PHONE_FRAME_WORD.match(remainder, offset)
        if word is None:
            return None
        words.append(word.group())
        offset = word.end()
    vocabulary = set(words)
    implicit = bool(re.fullmatch(r'[\s，,、:：.\"“”「」（）()]*(?:(?:下限|上限)(?:为|是|[:：])?'
                                 r'[\s，,、:：.\"“”「」（）()]*)*', remainder))
    return vocabulary, implicit


def _phone_frame_context(frame, *, allow_implicit=False):
    """封闭词法中须有phone业务锚点，裸量仅在唯一有效phone角色时由调用方授权。"""
    if frame is None:
        return False
    vocabulary, implicit = frame
    network = bool(vocabulary & {'在网', '入网'})
    account_usage = bool(vocabulary & {'手机号', '手机号码'}) and '使用' in vocabulary
    return network or account_usage or allow_implicit and implicit


def _phone_frame_key(text, current, phone_keys, *, allow_implicit=False):
    """证明同句phone单量的完整来源；上下限仅表示边界元角色，不是精确已用时长。"""
    frame = _phone_frame_words(text, current)
    if not _phone_frame_context(frame, allow_implicit=allow_implicit):
        return None
    if not phone_keys:
        raise PrivacyError('回答包含未验证数字。')
    key = _declared_duration_key(text, current, phone=True)
    if frame[0] & {'下限', '上限'} and key == _duration_key(current):
        return None
    if key not in phone_keys:
        raise PrivacyError('回答包含未验证数字。')
    return key


def _phone_interval_value(match):
    """有限区间使用有序月数三元key；拒绝反向、超长和零端点。"""
    if len(match['lo']) > 4 or len(match['hi']) > 4:
        return None
    factor = 12 if match['unit'] == '年' else 1
    lo, hi = int(match['lo']) * factor, int(match['hi']) * factor
    return (lo, hi, 'interval') if 0 < lo < hi <= 1200 else None


def _interval_roles(key):
    """完整区间可展示端点的下限/上限角色，但不能提供精确已用端点值。"""
    return {key, (key[0], 'lower'), (key[1], 'upper')}


def _phone_interval_key(text, match, keys, *, allow_implicit=False):
    """只核验phone同域区间；其他指标保留原验证路径，不借phone区间作依据。"""
    proven = _phone_frame_context(_phone_frame_words(text, match), allow_implicit=allow_implicit)
    if not proven:
        proven = _duration_context_matches(text[:match.start()], _PHONE_DURATION_CONTEXT)
    if not proven:
        return None
    key = _phone_interval_value(match)
    if key is None or key not in keys:
        raise PrivacyError('回答包含未验证数字。')
    return key


def _phone_relation_context(prefix):
    """显式phone主体后正向消费功能/业务词；设备手机须有明确在网/入网，不借给其他主体。"""
    clause = re.split(r'[，,。；;!?！？\n]', prefix)[-1]
    subjects = list(re.finditer(r'手机(?:号码|号)?|(?:这个|该|此)号码', clause))
    if not subjects:
        return False
    subject = subjects[-1]
    tail, offset, words = clause[subject.end():], 0, []
    while offset < len(tail):
        if tail[offset].isspace():
            offset += 1
            continue
        word = _PHONE_RELATION_WORD.match(tail, offset)
        if word is None or len(words) >= 24:
            raise PrivacyError('手机时长关系含未知实质词或其他主体。')
        words.append(word.group())
        offset = word.end()
    network = bool(set(words) & {'在网', '入网', '网络', '运营商'})
    if subject.group() == '手机' and not set(words) & {'在网', '入网'}:
        raise PrivacyError('手机设备使用时间不能冒充账户在网时长。')
    if subject.group().endswith('号码') and not subject.group().startswith('手机') and not network:
        raise PrivacyError('未确认的号码指代不能绑定手机时长。')
    return bool(set(words) & {'在网', '入网', '网络', '运营商', '使用', '时长', '时间'})


def _duration_key(match):
    """整月/整年换成月数并保留上下界；不处理小数、模糊区间或天月换算。"""
    raw = match['number']
    # 词法消费完整数字，支持范围仍有限；超长phone时长须进入同指标拒绝，不能漏给
    # 后续普通数字子集检查，再借银行大额/大计数作依据。长度先判定也避免巨整数转换。
    if raw.isdecimal() and len(raw) > 4:
        return None
    number = int(raw) if raw.isdecimal() else _DURATION_NUMBERS.get(raw)
    if number is None:
        return None
    months = number * (12 if match['unit'] == '年' else 1)
    prefix, suffix = match['prefix'], match['suffix']
    lower = prefix in {'至少', '不少于', '不低于', '满', '已满', '已经满'} or suffix in {'以上', '及以上', '或更久', '或更长'}
    upper = prefix in {'至多', '最多', '不超过'} or suffix in {'以下', '及以下'}
    strict_upper = prefix in {'尚未满', '未满', '不满'}
    if not 0 < months <= 1200 or lower and upper or strict_upper and (lower or upper):
        return None
    return months, 'strict_upper' if strict_upper else 'lower' if lower else 'upper' if upper else 'exact'


def _normalize_duration_bound(text):
    """只归一化校验视图中“至少已在网两年”的前置边界，客户正文保持原样。

    边界只能跨闭合的已/已经+在网/入网，且随后必须紧接年/月量；不跨主体或分句。
    """
    quantity = (r'(?:\d{1,4}|[零〇一二两三四五六七八九十百千万半]{1,6})'
                r'\s*(?:个月(?!份)|年(?!级|度|份|代))')
    return re.sub(r'至少(?P<network>(?:已经|已)?(?:在网|入网))(?=' + quantity + ')',
                  lambda match: match['network'] + '至少', text)


def _duration_context_matches(prefix, context):
    """绑定指标及谓语；手机时长允许省略主语，但不能跨给电脑、贷款等明确其他主体。"""
    match = re.search(context + _DURATION_PREDICATE, prefix)
    if not match:
        return context == _PHONE_DURATION_CONTEXT and _phone_relation_context(prefix)
    if context != _PHONE_DURATION_CONTEXT or re.match(r'为|给|手机(?:号码|号)', match.group()):
        return True
    lead = re.split(r'[，,。；;!?！？\n]', prefix[:match.start()])[-1].strip()
    # 显式手机主体后的关系词必须全部消费；无任意通配，不越过贷款、电脑、未知公司等实词。
    relation = r'(?:的|在|从|自|这|那|其|该|此|个|家|里|边|处|方面|之间|与|当前|所用|运营商|网络|中|内|已经|已|使用|时长|时间)'
    if not lead or re.search(r'手机(?:号码|号)?' + relation + r'{0,12}$', lead):
        return True
    if re.fullmatch(r'(?:(?:您的|你的|您|你|它|其|这|那|该|此|份|该项|这一项|这项|报告中|报告显示|当前报告|结果显示|页面显示|'
                    r'报告给出|目前|当前|现在|' + _DURATION_DISCOURSE + r')(?:的)?){0,3}(?:已经|已)?', lead):
        return True
    if _phone_relation_context(prefix):
        return True
    raise PrivacyError('回答将手机时长来源用于其他明确主体。')


def _declared_duration_key(text, match, *, phone=False):
    """识别phone显式上下限元角色；裸精确时长与其他指标保持原完整key。"""
    key = _duration_key(match)
    if phone and key and key[1] == 'exact':
        role = re.search(r'(下限|上限)(?:为|是|[:：])?\s*[“\"「]?$', text[:match.start()])
        if role:
            return key[0], 'lower' if role[1] == '下限' else 'upper'
    return key


def duration_source_roles(facts):
    """导出原字段的时长角色，供已展示小结收紧来源；不提供额外的展示数字。

    返回ref到{name, keys}，单量key为[月数, 边界]，有限区间为[下端, 上端, interval]，
    并保留端点的lower/upper元角色。运营商等非时长字段保留空keys，
    调用方可按同一已核验小结的sources组装角色组，不能合并未引用的其他小结。
    """
    rows = facts.items() if isinstance(facts, dict) else ((fact.get('field_ref'), fact) for fact in facts)
    result = {}
    for ref, fact in rows:
        if not ref:
            continue
        name, value = str(fact.get('name', '')), fact.get('value')
        keys = set()
        if isinstance(value, str) and fact.get('status') not in {'missing', 'null', 'empty', 'withheld'}:
            value = _normalize_duration_bound(normalized(value))
            keys = {key for match in _DURATION.finditer(value)
                    if (key := _declared_duration_key(value, match, phone=name in _PHONE_DURATION_NAMES))}
            if name in _PHONE_DURATION_NAMES:
                for match in _PHONE_INTERVAL.finditer(value):
                    if key := _phone_interval_value(match):
                        keys.update(_interval_roles(key))
        result[ref] = {'name': name, 'keys': [list(key) for key in sorted(keys, key=str)]}
    return result


def _displayed_duration_roles(value, roles):
    """将小结中实际展示的时长绑定原指标，再与原key相交；同数值不能跨指标借用。"""
    if isinstance(roles, dict):
        roles = [roles]
    candidates = []
    for role in roles if isinstance(roles, (list, tuple)) else ():
        if not isinstance(role, dict) or not isinstance(role.get('name'), str):
            continue
        keys = {tuple(key) for key in role.get('keys', ())
                if isinstance(key, (list, tuple)) and len(key) in {2, 3}
                and isinstance(key[0], (int, float)) and not isinstance(key[0], bool)
                and 0 < key[0] <= 1200
                and (len(key) == 2 and key[1] in {'exact', 'lower', 'upper', 'strict_upper'}
                     or len(key) == 3 and isinstance(key[1], (int, float))
                     and key[0] < key[1] <= 1200 and key[2] == 'interval')}
        candidate = role['name'], keys
        if keys and role['name'] and candidate not in candidates:
            candidates.append(candidate)
    entries = []
    for match in _PHONE_INTERVAL.finditer(value):
        for name, keys in candidates:
            if name not in _PHONE_DURATION_NAMES:
                continue
            try:
                key = _phone_interval_key(value, match, keys, allow_implicit=len(candidates) == 1)
            except PrivacyError:
                continue
            if key:
                entries.extend((role, name) for role in _interval_roles(key))
    for match in _DURATION.finditer(value):
        for name, keys in candidates:
            phone = name in _PHONE_DURATION_NAMES
            key = _declared_duration_key(value, match, phone=phone)
            try:
                frame = (_phone_frame_key(value, match, keys, allow_implicit=len(candidates) == 1)
                         if phone else None)
                context = _PHONE_DURATION_CONTEXT if phone else re.escape(name)
                prefix = value[:match.start()]
                if phone and key != _duration_key(match):
                    prefix = re.sub(r'(?:下限|上限)(?:为|是|[:：])?\s*[“\"「]?$', '', prefix)
                proven = frame is not None or _duration_context_matches(prefix, context)
            except PrivacyError:
                # 当前量可以属于同小结的另一指标；候选失败不能给其他角色添加授权。
                continue
            if proven and (frame or key) in keys:
                entries.append((frame or key, name))
    for name, keys in candidates:
        displayed = {key for key, role_name in entries if role_name == name}
        for key in keys:
            # 两端均已展示且原角色本来就是同一完整区间，才可复述完整区间；不能仅借同值。
            if len(key) == 3 and {(key[0], 'lower'), (key[1], 'upper')} <= displayed:
                entries.append((key, name))
    return entries


def _without_verified_duration(text, facts, *, duration_roles=None):
    """只在同一指标的封闭表述中换算时长，不把在网月数借给贷款期限或其他数量。"""
    for span in re.finditer(r'(?:\d+|[零〇一二两三四五六七八九十百千万半]+)(?:年|个月)?'
                            r'(?:以上|以下)?[至到~～—–\-](?:\d+|[零〇一二两三四五六七八九十百千万半]+)'
                            r'(?:年(?!级|度|份|代)|个月(?!份))', text):
        if (re.search(r'[零〇一二两三四五六七八九十百千万半]', span.group())
                or re.search(r'(?:年|个月)(?:以上|以下)?[至到~～—–\-]', span.group())):
            # “2年到3年”不能只核验前半段，再借另一字段的3为后半段背书。
            # 标准单单位展示区间“3到5年”仍沿原来源验证；复合单位写法暂不放行。
            raise PrivacyError('回答包含尚未支持的复合时长区间。')
    sources, metric_roles = {}, set()
    for fact in facts:
        value = fact.get('value')
        name = str(fact.get('name', ''))
        if isinstance(value, str):
            value = _normalize_duration_bound(normalized(value))
            if duration_roles is not None:
                entries = _displayed_duration_roles(value, duration_roles.get(fact.get('field_ref'), ()))
            else:
                entries = [(key, name) for match in _DURATION.finditer(value)
                           if (key := _declared_duration_key(value, match, phone=name in _PHONE_DURATION_NAMES))]
                if name in _PHONE_DURATION_NAMES:
                    for match in _PHONE_INTERVAL.finditer(value):
                        if key := _phone_interval_value(match):
                            entries.extend((role, name) for role in _interval_roles(key))
            for key, role_name in entries:
                context = _PHONE_DURATION_CONTEXT if role_name in _PHONE_DURATION_NAMES else re.escape(role_name)
                source = sources.setdefault(key, {'contexts': set(), 'phone_metric': False})
                if context:
                    source['contexts'].add(context)
                    metric_roles.add(role_name)
                if role_name in _PHONE_DURATION_NAMES:
                    source['phone_metric'] = True
    phone_keys = {key for key, source in sources.items() if source['phone_metric']}
    implicit_phone = len(metric_roles) == 1 and next(iter(metric_roles), None) in _PHONE_DURATION_NAMES

    def replace_interval(match):
        key = _phone_interval_key(text, match, phone_keys, allow_implicit=implicit_phone)
        return '[已核验phone有限区间]' if key else match.group()

    # 整体匹配、验证和移除区间，避免数字集合把12-24反转或把端点当精确时长。
    text = _PHONE_INTERVAL.sub(replace_interval, text)
    previous = None

    def replace(match):
        nonlocal previous
        key = _duration_key(match)
        if re.match(r'半|(?:\d+|[一二两三四五六七八九十]+)个月', text[match.end():]):
            # 当前只核验一个完整年/月量，不把“两年半”的“两年”单独匹配后放过剩余部分。
            raise PrivacyError('回答包含尚未支持的复合时长。')
        # 未登记的中文数量不靠截取末位数字“猜”时长；例如二十五年不能被当成五年。
        if not match['number'].isdecimal() and match['number'] not in _DURATION_NUMBERS:
            raise PrivacyError('回答包含无法核验的中文时长。')
        frame_key = _phone_frame_key(text, match, phone_keys, allow_implicit=implicit_phone)
        if frame_key is not None:
            previous = match.end(), frame_key, True
            return '[已核验phone时长]'
        # 完整检查同指标来源，不因其他字段恰有3而放过“在网至少三年”。
        scoped = {source_key for source_key, source in sources.items()
                  if any(_duration_context_matches(text[:match.start()], context) for context in source['contexts'])}
        equivalent = previous is not None and re.fullmatch(
            r'[”"」]*[，,、]?\s*' + _DURATION_DISCOURSE + r'\s*',
            text[previous[0]:match.start()])
        range_repeat = False
        if previous is not None and previous[2]:
            between = text[previous[0]:match.start()]
            range_ref = r'(?:这个|那个|该|此|其)(?:范围|区间)'
            range_repeat = bool(re.fullmatch(
                r'[”"」]*[，,、]\s*' + range_ref + r'(?:显示为|为|是|表示|意味着|说明)?\s*', between))
            if re.fullmatch(r'[”"」]*[，,、]\s*', between):
                range_repeat = range_repeat or bool(re.match(
                    r'(?:就是|即为|是)' + range_ref + r'(?=[，,。；;!?！？]|$)', text[match.end():]))
        if scoped or equivalent or range_repeat:
            allowed = scoped if scoped else {previous[1]}
            if key not in allowed:
                raise PrivacyError('回答改变了同指标时长来源的数值或范围边界。')
            phone_bound = bool(key in sources and sources[key]['phone_metric'] and scoped
                               and _duration_context_matches(text[:match.start()], _PHONE_DURATION_CONTEXT))
            if (equivalent or range_repeat) and previous is not None:
                phone_bound = phone_bound or previous[2]
            previous = match.end(), key, phone_bound
            return '[已核验时长]'
        # 小结二次总结必须证明已经展示的同角色时长；不能退回普通数字子集借同值数量。
        # 完整日期中的年份不属于当前可换算时长key，继续交给后面的整组日期检查。
        if duration_roles is not None and key is not None:
            raise PrivacyError('回答包含未验证数字。')
        # 中文数量不进入后续Arabic数字集合，必须在这里明确证明来源和指标，不能原样逃逸。
        if not match['number'].isdecimal():
            standalone = not text[:match.start()].strip() and not text[match.end():].strip('。.!！?？ \t\r\n')
            if key not in sources or not standalone:
                raise PrivacyError('回答中的中文时长没有同指标来源。')
        # 相同月数也必须保留原范围边界，不能把“至少24个月”说成恰好2年。
        if key and any(key[0] == source[0] for source in sources):
            raise PrivacyError('回答改变了时长来源的范围边界。')
        previous = None
        return match.group()

    return _DURATION.sub(replace, text)
