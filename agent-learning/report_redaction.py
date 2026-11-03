"""报告出站过滤：仅移除姓名、证件、手机号、地址，以及运行所需凭据。"""

import json
import re
import unicodedata


PERSONAL_LABEL = re.compile(r"姓名|身份证|证件|护照|手机号|手机号码|电话号码|住址|地址|我叫|名字叫|名叫", re.I)
CREDENTIAL = re.compile(r"验证码|密码|密钥|token|authorization|cookie|secret|password|api[_ -]?key", re.I)
# 只匹配手机号与证件格式；案件编号、日期、金额等长数字不因长度被排除。
PERSONAL_NUMBER = re.compile(r"(?<!\d)(?:\+?86[ -]?)?1[3-9](?:[ -]?\d){9}(?!\d)|(?<!\d)\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)|(?<!\d)\d{8}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}(?!\d)")
LABELED_VALUE = re.compile(r"(?:姓名|名字|我叫|名叫|住址|地址|证件(?:号码|号)?|身份证(?:号码|号)?|护照(?:号码|号)?|手机(?:号码|号)?|电话号码)\s*[:：=]?\s*[^\s，,；;。\n]+")
REDACTED = "【已隐藏个人信息】"
NAME_LIST = re.compile(r"^(?:personList|pnameList)$", re.I)
PERSON_CONTEXT = re.compile(r"person|owner|representative|contact|borrower|applicant|customer|member|个人|人员|联系人|法人", re.I)
ORGANIZATION_CONTEXT = re.compile(r"company|enterprise|organization|institution|court|bank|platform|公司|企业|机构|法院|银行|平台", re.I)
LABELED_CREDENTIAL = re.compile(r"(?:验证码|密码|密钥|token|authorization|cookie|secret|password|api[_ -]?key)\s*[:：=]\s*[^\s，,；;。\n]+", re.I)


def normalize(text):
    """规范全角及不可见字符，供字段别名识别和已知值匹配共用。"""
    return "".join(c for c in unicodedata.normalize("NFKC", str(text)) if unicodedata.category(c) != "Cf")


def protected_key(key, parent=""):
    """识别四类字段和凭据；机构、法院等实体的名称仍可用于报告分析。

    parent 用于区分 company.name 与 person.name；不把 report_id、案件 code
    或婚姻学历等其他报告字段当作个人信息。
    """
    text = normalize(key)
    compact = re.sub(r"[^a-z0-9]", "", text.casefold())
    if PERSONAL_LABEL.search(text) or CREDENTIAL.search(text):
        return True
    if re.search(r"mobile|phone|cellphone|idcard|identity|passport|address|residence", compact):
        return True
    if compact in {"name", "names", "namelist"}:
        # 取最近的实体语境；company.owner.name 仍是个人姓名。
        for part in reversed(re.findall(r"[\w]+", parent)):
            if PERSON_CONTEXT.search(part):
                return True
            if ORGANIZATION_CONTEXT.search(part):
                return False
        return True
    return compact in {"pname", "personname", "fullname", "realname", "username", "customername", "applicantname", "borrowername", "contactname", "legalpersonname", "legalperson", "idnumber", "certno", "certnum", "certnumber", "certificate", "certificateid", "certificateno", "certificatenumber", "credentialno", "idno", "tel", "cell", "province", "city", "county", "district", "street", "village", "postcode", "zipcode"}


def protected_path(path):
    """按路径片段识别受保护字段，同时兼容数组和候选路径。"""
    parts = re.findall(r"[\w]+", path)
    return any(protected_key(part, ".".join(parts[:index])) for index, part in enumerate(parts))


def collect_literals(value, *, parent="", protected=False):
    """只收集受保护字段的原值；普通文字、业务编号与统计数值不再加入禁发集合。"""
    result = set()
    if isinstance(value, dict):
        for key, child in value.items():
            result.update(collect_literals(child, parent=f"{parent}.{key}", protected=protected or protected_key(key, parent)))
    elif isinstance(value, list):
        for child in value:
            result.update(collect_literals(child, parent=parent, protected=protected or bool(NAME_LIST.fullmatch(parent.rsplit(".", 1)[-1]) and not isinstance(child, (dict, list)))))
    elif isinstance(value, str) and not protected and value.lstrip().startswith(("{", "[")):
        # 某些接口把 JSON 明细存成字符串；解析后同样收集姓名等已知原值。
        try:
            nested = json.loads(value)
        except (ValueError, TypeError):
            pass
        else:
            result.update(collect_literals(nested, parent=parent))
    elif protected and value is not None and type(value) is not bool:
        text = normalize(value).casefold().strip()
        if text:
            result.add(text)
    return result


def redact_text(text, literals):
    """本地替换已知个人值及常见带标签信息，不请求模型协助脱敏。"""
    text = normalize(text)
    for literal in sorted(literals, key=len, reverse=True):
        # 短数字仅替换独立值，避免姓名为数字时破坏日期或普通金额。
        pattern = r"(?<![\w.])" + re.escape(literal) + r"(?![\w.])" if re.fullmatch(r"\d{1,3}", literal) else re.escape(literal)
        text = re.sub(pattern, REDACTED, text, flags=re.I)
    text = PERSONAL_NUMBER.sub(REDACTED, text)
    text = LABELED_VALUE.sub(REDACTED, text)
    return LABELED_CREDENTIAL.sub(REDACTED, text)
