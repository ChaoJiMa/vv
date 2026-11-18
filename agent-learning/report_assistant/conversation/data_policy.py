"""为用户已授权的个人资料解读生成固定协议变体，不改写动态问题或报告内容。"""

import re


_PERSONAL_FIELD = r'(?:姓名|名字|身份证(?:号码|号)?|证件(?:号码|号)?|护照(?:号码|号)?|手机号|手机号码|电话号码|住址|地址)'
_PERSONAL_LIST = _PERSONAL_FIELD + r'(?:(?:和|与|及|、|以及)' + _PERSONAL_FIELD + r')*'
_NEGATIVE = r'(?:不需要|不用|不要|无需|不必|别|不)'
_ACTION = r'(?:再|继续)?(?:看|查看|解释|解读|分析|说|显示|展示|回答|提及|管)(?:一下|下)?'
_EXCLUDED_PERSONAL = re.compile(r'(?:请|我的|报告中的|报告里的)*(?:'
                                + _PERSONAL_LIST + r'(?:这些|信息|部分)?' + _NEGATIVE + r'(?:' + _ACTION + r')?|'
                                + _NEGATIVE + _ACTION + _PERSONAL_LIST + r')(?:了|啦|吧)?')
_PERSONAL_DECLARATION = re.compile(r'(?:我的|本人|报告中的|报告里的)?' + _PERSONAL_FIELD + r'(?:是|为|[:：=]).+')
_QUERY = re.compile(r'吗|么|呢|什么|多少|核对|确认|查询|查看|查一下|看一下|分析|解释|解读|告诉|显示|是否|是不是|正确|对不对')
# 消费完整手机业务关系，不能只删除“手机号”，否则独立的号码查询会被一起忽略。
_PHONE_BUSINESS = re.compile(r'手机(?:号码|号)(?:的)?(?:在网|入网|开通|使用)(?:的)?(?:时长|时间|多久)|'
                             r'手机(?:号码|号)(?:的|所属的?|所用的?)?(?:运营商|通信服务商)')


def excluded_personal_clause(text):
    """仅识别完整的个人资料排除分句，避免程序补读用户明确不要的资料。"""
    return bool(_EXCLUDED_PERSONAL.fullmatch(text))


def declared_personal_clause(text):
    """已提供资料的陈述句不自动补读；核对、询问或同句含其他问题时继续原路由。"""
    return bool(_PERSONAL_DECLARATION.fullmatch(text) and not _QUERY.search(text))


def personal_target_text(text):
    """仅用于个人资料目标推断，手机在网和运营商指标仍由原指标解析器识别。"""
    return _PHONE_BUSINESS.sub('', text)


_REPLACEMENTS = (
    ('identity查看姓名证件', 'identity身份核对方式（查询当前报告的姓名证件必须选report）'),
    ('姓名、证件、手机号和地址留在本地；不要求用户在对话中提交这些信息。',
     '当前报告中的姓名、证件、手机号和地址已获用户授权，可按需查询和回答；不主动索取额外个人资料。只答本次所问，整体总结不主动罗列个人资料。'),
    ('需要被过滤的四类个人信息时说明本地查询。', '姓名、证件等查询与其他报告指标一样，必须读取当前报告事实后回答，不能以隐私为由拒绝整轮问题。'),
    ('不列举被过滤的个人信息。', '不重复用户未问的个人资料。'),
    ('不请求身份、路径、SQL、其他用户或报告。', '不请求登录凭据、任意路径、SQL、其他用户或报告。'),
    ('过滤四类个人信息后的值、明细、说明和空值状态', '过滤登录凭据后的值、明细、说明和空值状态，包含已授权的个人资料'),
)


def personal_protocol(value, trusted_strings):
    """仅替换程序已登记的完整固定字符串；动态用户/报告文本保持原样。"""
    if isinstance(value, dict):
        return {key: personal_protocol(child, trusted_strings) for key, child in value.items()}
    if isinstance(value, list):
        return [personal_protocol(child, trusted_strings) for child in value]
    if isinstance(value, str) and value in trusted_strings:
        for old, new in _REPLACEMENTS:
            value = value.replace(old, new)
    return value
