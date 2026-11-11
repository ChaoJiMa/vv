"""按已核实的报告页面规则计算分数展示与等级，生成面向客户的简短说明。"""

from decimal import Decimal, InvalidOperation, ROUND_FLOOR
import json
import re


# 来源：字段资料同一提交的 Risk/Gauge.vue、risk adapter 和 pro/Analysis。
# 版本与路径同时匹配，不能把另一版本或社交扫描的分数当作报告总评分。
GAUGE_THEMES = frozenset({1, 2, 3, 4, 6, 50, 52})


def score_family(field, theme):
    """仅识别已核实的报告主评分，未知版本/路径返回None。"""
    if theme in GAUGE_THEMES and field.get("module_id") == 5 and field.get("path") == "report.BRS_RS_00001":
        return "gauge"
    if theme == 40 and field.get("module_id") == 152 and field.get("path") == "report[152].riskScore":
        return "pro"
    return None


def _number(value):
    """接收有限数值及数值字符串；缺失、空白、布尔和对象不伪装成零分。"""
    if type(value) not in (int, float, str) or not str(value).strip():
        return None
    try:
        number = Decimal(str(value).strip())
        return number if number.is_finite() and abs(number) <= 1000000000 else None
    except InvalidOperation:
        return None


def _shown(number):
    """用普通十进制说明区间，避免把实现中的科学记数法展示给客户。"""
    return format(number, "f").rstrip("0").rstrip(".") if number % 1 else str(int(number))


def _gauge_band(number, config, safe_label):
    """复现当前模板区间：空配置默认，1至5档自定义，6档起回到默认。

    自定义重叠区间以后匹配为准，只有100可命中上界；非法配置不猜等级。
    只返回经个人信息和标签检查的等级，不外发原始模板配置。
    """
    if config in (None, ""):
        bands = []
    elif isinstance(config, str):
        try:
            bands = json.loads(config)
        except (ValueError, TypeError):
            return None, None
    else:
        return None, None
    if not isinstance(bands, list):
        return None, None
    if not bands:
        if number < 50:
            return "待提高", "低于50分"
        if number < 70:
            return "一般", "50分至不足70分"
        if number <= 100:
            return "较好", "70分至100分（含100分）"
        return None, None
    if len(bands) >= 6:
        bands = [{"scores": "0,50", "rank": "待提高"}, {"scores": "50,70", "rank": "一般"},
                 {"scores": "70,100", "rank": "较好"}]
    rank, interval = None, None
    for band in bands:
        if not isinstance(band, dict) or not isinstance(band.get("scores"), str):
            return None, None
        bounds = band["scores"].split(",")
        if len(bounds) != 2:
            return None, None
        low, high = map(_number, bounds)
        label = safe_label(band.get("rank"))
        # 模板文案也属于输入数据，不能借等级标签绕过客服正文的承诺与技术信息限制。
        if label and (len(label) > 24 or re.search(r"审批|授信|贷款|下款|无风险|没有任何风险|非常(?:干净|健康)|(?:信用|征信)(?:状况|情况)?良好|申请频率|不良影响|超越|无逾期|field_ref|module_ref|report|BRS_|读取|原始|(?<![a-zA-Z0-9_])[fm]\d+(?![a-zA-Z0-9_])", label, re.I)):
            label = None
        if low is None or high is None or low >= high or not label:
            return None, None
        if low <= number and (number < high or number == high == 100):
            rank = label
            interval = (f"{_shown(low)}分至{_shown(high)}分（含100分）" if high == 100
                        else f"{_shown(low)}分至不足{_shown(high)}分")
    return rank, interval


def describe_score(field, value, template, safe_label):
    """返回核验后的展示分数、等级、区间和客服说明；不返回字段路径或模板原文。

    参数value必须先经过事实出口过滤，safe_label由当前会话的个人信息检查提供。
    未知评分组件返回None；有效评分但规则缺失时只说明分数，绝不套用默认等级。
    """
    family = score_family(field, template["theme"])
    if family is None:
        return None
    number = _number(value)
    if number is None:
        return {"answer": "这份报告暂时没有有效分数，还不能判断属于哪个等级。"}
    # Math.round 的半分向正方向取整，不能使用Python默认的银行家舍入。
    displayed = int((number + Decimal("0.5")).to_integral_value(rounding=ROUND_FLOOR))
    if family == "pro":
        displayed = displayed if number > 0 else 0
        rank, interval = next((rank, interval) for threshold, rank, interval in (
            (90, "A/极高", "90分及以上"), (80, "A/高", "80分至不足90分"),
            (70, "B/较高", "70分至不足80分"), (60, "C/中等", "60分至不足70分"),
            (50, "D/低", "50分至不足60分"), (0, "E/待提高", "低于50分"),
        ) if displayed >= threshold)
    else:
        rank, interval = _gauge_band(number, template.get("config"), safe_label)
    answer = f"您的报告分数是{displayed}分"
    answer += f"，属于“{rank}”。" if rank else "。当前没有可确认的等级说明。"
    # 取整前值、计算过程和后端默认值解释只供本地计算，客服只说页面结果。
    return {"display_value": displayed, "rank": rank, "interval": interval, "answer": answer}
