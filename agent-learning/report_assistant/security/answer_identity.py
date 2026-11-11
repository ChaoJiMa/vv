"""回答身份、凭据标签及否定作用域校验；所有豁免仍要求原来源边界。"""

import re
from report_assistant.security.redaction import CREDENTIAL, PERSONAL_LABEL, PERSONAL_NUMBER
from report_assistant.security.text import normalized

IDENTITY = re.compile(PERSONAL_LABEL.pattern + "|" + CREDENTIAL.pattern, re.I)
# 这些完整指标短语描述业务结果，不包含号码；只豁免标签检查，实际个人值仍查原文。
PUBLIC_PHONE_METRIC = re.compile(r'手机(?:号码|号)在网(?:时长|时间|多久|运营商)')
# 回答中的中性手机业务语法；这些片段只处理标签/同指标时长，不授权号码取值。
_PHONE_NETWORK = r'(?:在网|入网|在(?:运营商)?网络(?:中|内))'
_PHONE_SERVICE_ITEM = r'(?:通信|通话|短信|上网|网络)'
_PHONE_SERVICE = (r'(?:为|给)(?:这个|该|此|您(?:的)?|你(?:的)?)?手机(?:号码|号)'
                  r'提供' + _PHONE_SERVICE_ITEM +
                  r'(?:(?:、|和|及|以及)' + _PHONE_SERVICE_ITEM + r')*服务')
# 先消费网络业务，再消费可选归属、使用和时间名词；每个词法单元均封闭，不跨未知实词。
_PHONE_TIME_MEASURE = r'(?:时长|时间|范围|区间)'
_PHONE_USAGE_TIME = r'使用(?:的)?' + _PHONE_TIME_MEASURE
_PHONE_NETWORK_TIME = (r'(?:(?:的)?(?:使用(?:的)?)?' + _PHONE_TIME_MEASURE +
                       r'(?:(?:的|给出的)?(?:结果|范围|区间))?)?')
# “手机号已使用/手机号的使用时长”指账户业务；没有“号/号码”的手机设备不属于此别名。
_PHONE_ACCOUNT_USAGE = (r'手机(?:号码|号)(?:的)?(?:' + _PHONE_USAGE_TIME + '|'
                        r'开通使用(?=(?:已经|已)?满|$)|'
                        r'(?=(?:目前|当前|现在)?(?:已经|已)?(?:使用|用)(?:了)?'
                        r'(?:至少|至多|不少于|不低于|最多|不超过|以上|[\d一二两三四五六七八九十半]|'
                        r'[，,。；;\s]|$)))')
_PHONE_DURATION_CONTEXT = (r'(?:' + _PHONE_NETWORK + _PHONE_NETWORK_TIME + '|'
                           + _PHONE_SERVICE + '|' + _PHONE_ACCOUNT_USAGE + ')')
INJECTION = re.compile(r"忽略.{0,8}(指令|规则)|系统提示|开发者消息|执行命令|system\s*:|assistant\s*:", re.I)
CONTACT = re.compile(PERSONAL_NUMBER.pattern + r"|(?:sk-|eyJ)[A-Za-z0-9_-]{12,}", re.I)
# 防止源感知泛称豁免掩盖中文逐位号码；仅匹配完整手机号形态，不把任意中文数量都当身份。
_SPOKEN_PHONE_DIGITS = r'0-9〇零洞一幺壹二两贰三叁四肆五伍六陆七柒八捌九玖'
_SPOKEN_PHONE = re.compile(r'(?<![' + _SPOKEN_PHONE_DIGITS + r'])'
                           r'[1一幺壹][\s·、，,\-]?[3-9三四五六七八九叁肆伍陆柒捌玖]'
                           r'(?:[\s·、，,\-]?[' + _SPOKEN_PHONE_DIGITS + r']){9}'
                           r'(?![' + _SPOKEN_PHONE_DIGITS + r'])')
_PHONE_LABEL = r'手机(?:号码|号)(?!码)'
_PHONE_VALUE = re.compile(_PHONE_LABEL + r'\s*(?:的?(?:原值|取值|值|号码))?\s*'
                          r'(?:就是|即为|等于|显示为|显示是|为|是|[:：=])|'
                          + _PHONE_LABEL + r'\s*(?=[+\-\d])|'
                          r'(?:就是|即为|等于|为|是)\s*(?:这个|该|此|您(?:的)?|你(?:的)?)?'
                          + _PHONE_LABEL + r'(?=\s*(?:[吗呢呀]?[，,。；;!?！？]|$))')
SAFE_LABEL = re.compile(r"[\u4e00-\u9fffA-Za-z0-9（）()，、 /+%·.\-]{1,80}")
STATISTIC = re.compile(r"分析指数|风险指数|次数|机构数|平台数|笔数|天数|金额|余额|额度|数量|比例|占比|总数|案件数|记录数")
NUMBER = re.compile(r"-?\d{1,10}(?:\.\d{1,6})?")
# 1至3位通常会与周期、状态、页码及不透明引用重合，不能靠序列化子串判定来源。
SHORT_IDENTIFIER = re.compile(r"\d{1,3}")


def has_identity_label(text, *, allow_phone_reference=False, phone_metric_context=False):
    """识别身份标签；回答泛称须由调用方按本段实际已读phone来源显式授权。

    默认/问题入口不变。仅allow_phone_reference与phone_metric_context同时为真时，
    可处理一般手机业务关系；无来源标记时仍只使用原闭合语法。号码取值、中文逐位
    号码及其他身份/凭据标签先拒绝，不能借泛称许可发送实际个人信息。
    已知私有字面量由调用方继续检查，不能用此标签函数替代实际值过滤。
    """
    text = normalized(text)
    spoken = any(re.search(r'[〇零洞一幺壹二两贰三叁四肆五伍六陆七柒八捌九玖]', match.group())
                 for match in _SPOKEN_PHONE.finditer(text))
    # 问题入口的公开指标标签例外也不能洗掉尾随的中文逐位真实号码。
    if spoken:
        return True
    if allow_phone_reference:
        if CONTACT.search(text) or _PHONE_VALUE.search(text):
            return True
        if phone_metric_context is True:
            text = re.sub(_PHONE_LABEL, '[手机业务泛称]', text)
        text = re.sub(r'手机(?:号码|号)(?=(?:的)?(?:已经|已)?' + _PHONE_NETWORK +
                      r'(?:时长|时间|的(?:使用)?(?:时长|时间)|目前|当前|现在|已经|已|有|使用|用|持续|达到|至少|至多|不足|超过|不满|为|是|'
                      r'[一二两三四五六七八九十\d]|[，,。；;\s]|$)|'
                      r'(?:的|所属的?|所用的?)?(?:运营商|通信服务商))', '', text)
        text = re.sub(_PHONE_SERVICE, '[手机业务说明]', text)
        text = re.sub(_PHONE_ACCOUNT_USAGE, '[手机业务说明]', text)
    return bool(IDENTITY.search(PUBLIC_PHONE_METRIC.sub('', text)))


def negative_zero_text(text):
    """将固定否定比较中的0改写成文字，仅供校验，不改写客户实际看到的回答。"""
    return re.sub(r'((?:不能|不可|不应)(?:直接)?(?:据此)?'
                  r'(?:按|当成|当作|视为|等同于|认定|判断|理解|断定|确定|说明|说)|不代表|不等于|不意味着|'
                  r'(?:不能|不可|不应)[把将](?:它|这项信息|这些信息|这里的空缺|这里的空白|'
                  r'空缺|空白|缺失|未提供(?:的信息)?)(?:理解为|当作|当成|视为|看作))'
                  r'\s*(?:申请次数|次数|条数|记录数|数量)?(?:一定|就)?(?:是|为|成)?0(?![\d.])',
                  r'\1零', normalized(text))


def assertion_text(text):
    """仅屏蔽明确否定无依据结论的短语，防止把风险提醒误当成保证。

    保留原回答用于所有其他检查；这里只服务于风险断言检查。后续独立的
    肯定句仍留在字符串中，例如“不等于无风险；这份报告无风险”仍会失败。
    """
    text = normalized(text)
    # “直接”只允许出现在紧邻判断动词的位置，不能用通配符越过分句屏蔽后续保证。
    conclusion = r'(?:没有逾期(?:记录)?|无逾期(?:记录)?|无风险|没有任何风险|没有申请(?:记录)?|从未申请过?|从未借贷)'
    # 同一否定动词可以支配“没有逾期或无风险”等并列宾语；仅允许封闭连接词，
    # 不跨逗号、句号、转折词或新增主语，后续独立保证仍须正常检查。
    coordinated = conclusion + r'(?:\s*(?:或|和|以及|及|、)\s*' + conclusion + r')*'

    def sole_evidence(match):
        """仅隐藏明确否定的结论，依据文字原样保留，不能夹带肯定保证或双重否定。"""
        if re.search(r'但|不过|然而|可是|而是|却|因此|所以|不|无法|无需|未能', match['evidence']):
            return match.group()
        return match['prefix'] + '[已否定的推断]'

    # “不能仅凭…判断整体无风险”的依据允许自然文字，但限同一短分句；
    # 依据中的风险词不删除，转折和额外否定也不放行，避免扩大否定的作用范围。
    text = re.sub(r'(?P<prefix>(?:不能|无法)仅凭(?P<evidence>[^，,。；;!?！？\r\n]{1,80}?)'
                  r'(?:就)?(?:直接)?(?:判断|认定|确定|确认|推断|说明)\s*(?:整体)?(?:为|是)?\s*)'
                  + coordinated, sole_evidence, text)
    return re.sub(r'(?<!不)(?<!不是)(?<!并非)(?<!不能)(?<!无法)'
                  r'(?:不代表|不等于|不意味着|(?:不能|无法)(?:据此)?(?:直接)?(?:判断|认定|认为|断言|说明|推断|确定|确认|等同于|等同为)|'
                  r'不能[把将](?:这里的)?(?:空缺|空白|缺失|未提供的信息)(?:理解为|当作|当成))'
                  r'\s*(?:您|你)?(?:此前|以往|以前|过去)?'
                  + coordinated, '[已否定的推断]', text)
