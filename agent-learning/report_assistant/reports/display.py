"""把已核实的页面显示规则落实在本地；客服出口不携带转换前的值或实现说明。

规则来自字段目录同一固定源码版本。只识别明确的显示器，不执行目录表达式；
组合字段和条件组件只执行已核实的固定依赖；其余规则返回未确认，禁止以原值兜底冒充页面结果。
"""

import math
import re
from decimal import Decimal, ROUND_HALF_UP


UNCONFIRMED = object()
MISSING = object()
HIDDEN = object()
GEAR_BOUNDS = {
    "D7": (0, 2, 3, 5, 7), "D15": (0, 2, 4, 6, 9), "M1": (0, 3, 6, 9, 15),
    "M3": (0, 5, 10, 17, 24), "M6": (0, 5, 10, 17, 24), "M12": (0, 5, 10, 17, 24),
}


def js_truthy(value):
    """页面采用JavaScript真值：字符串0、空数组和空对象都是真，缺失是假。"""
    if value is MISSING or value is None or value is False:
        return False
    if type(value) in (int, float):
        return value != 0 and math.isfinite(value)
    return value != "" if isinstance(value, str) else True


def js_number(value):
    """只实现显示器用到的标量Number转换；容器不猜隐式转换。"""
    if value is MISSING:
        return None
    if value is None or value is False:
        return 0
    if value is True:
        return 1
    if not isinstance(value, (int, float, str)):
        return None
    try:
        number = float(value.strip() or "0") if isinstance(value, str) else float(value)
        return number if math.isfinite(number) else None
    except (ValueError, OverflowError):
        return None


def js_string(value):
    """仅对标量复现String，避免Python布尔和null文案与页面不同。"""
    if value is MISSING:
        return "undefined"
    if value is None:
        return "null"
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) is float and math.isfinite(value) and value.is_integer():
        return str(int(value))
    return str(value)


def _enum(field):
    """只接受逐行的整数编码到展示文本，不解析自由叙述或执行源码。"""
    rows = str(field.get("enum_mapping", "")).splitlines()
    pairs = [re.fullmatch(r'\s*([0-9]+)\s*→\s*([^\n]+?)\s*', row) for row in rows]
    if not pairs or not all(pairs):
        return None
    return {int(m[1]): m[2] for m in pairs}


def _formatter(field):
    """将白名单规则编译为叶子显示函数；未支持的组合规则整项关闭。"""
    rule = str(field.get("frontend_processing", ""))
    enum = str(field.get("enum_mapping", ""))
    path = str(field.get("path", ""))
    # 多候选、拼接与条件显示要核对全部依赖，单个叶子不能代表最终页面内容。
    if "|" in path or rule.startswith(("QT 与", "仅 abnormalBehavior", "仅 scenarios", "仅scenarios")):
        return None
    if path == 'report.BRS_BASIC_00002' and '男' in enum and '女' in enum:
        return lambda v: '男' if v is not MISSING and v is not None and js_number(v) == 1 else '女' if v is not MISSING and v is not None and js_number(v) == 0 else ''
    if rule.startswith(('页面 A() 宽松相等映射后展示', '页面 C() 宽松相等映射后展示', '页面 D() 宽松相等映射后展示')):
        mapping = ({0: '无', 5: '无', 1: '近3年内', 2: '3到5年', 3: '5到10年', 4: '10年前'} if rule.startswith('页面 A()')
                   else {0: '无', 3: '无', 1: '近3年内', 2: '3年以上'} if rule.startswith('页面 C()')
                   else {0: '无', 4: '无', 1: '近1个月内', 2: '1-3个月', 3: '3个月以上'})
        return lambda v: mapping.get(js_number(v), '') if v is not MISSING and v is not None else ''
    if rule.startswith('严谨版onMounted按==') and path in {
            'report.BRS_LS_XYP_CPL0001', 'report.BRS_LS_XYP_CPL0007', 'report.BRS_LS_XYP_CPL0008'}:
        # 图片顶部文案来自固定版本的字段资料；未知编码不展示原始值。
        # 实际目录既有一行多项的中文分号，也有换行；只接受纯展示文字，
        # 不把同一行后续编码和说明拼成0档的显示值。
        mapping = {int(m[1]): m[2].removesuffix('。') for row in re.split(r'[；\n]', enum)
                   if (m := re.fullmatch(r'\s*([0-9]+) → ([^→]+?)\s*', row))}
        return lambda v: mapping.get(js_number(v), UNCONFIRMED) if v is not MISSING and v is not None else ''
    if rule.startswith('null/undefined/空串 → ——；其余Number(值)===0显示不存在'):
        return lambda v: '——' if v is MISSING or v is None or v == '' else '不存在' if js_number(v) == 0 else '存在'
    if rule.startswith('null/undefined/空串 → ——；保留数字0和字符串0。'):
        # 这是已经过Java响应转换的显示值，不能按enum_mapping再解码一次。
        return lambda v: '——' if v is MISSING or v is None or v == '' else js_string(v)
    if rule.startswith('先以parseInt(值)-1取zz元区间，再formatRangeWan'):
        return _amount_range_wan
    if rule.startswith('有值时拼成「(ID:值)」'):
        return lambda v: f'(ID:{js_string(v)})' if js_truthy(v) else ''
    if rule.startswith('输出为「共涉及 N 项内容」'):
        return lambda v: '' if v is MISSING or v is None else f'共涉及{js_string(v)}项内容'
    if rule.startswith('按字段JavaScript真值决定收入图文是否显示'):
        return lambda v: v if js_truthy(v) and not isinstance(v, (dict, list)) else HIDDEN
    if rule.startswith('字段文字直出，另用于已结案／未结案筛选'):
        return lambda v: v if js_truthy(v) else '——'
    if rule.startswith('原值 || "-"。') and not enum:
        return lambda v: v if js_truthy(v) else '-'
    if path == 'report.BRS_MR_00001' and '未查到登记记录' in enum:
        # 固定版本marriage adapter对数字字符串做宽松比较，不向模型提供婚姻编码。
        return lambda v: '未查到登记记录' if v is MISSING or v is None or v == '' or js_number(v) in (0, 3) else '已婚' if js_number(v) == 1 else '离异'
    if rule.startswith("档位模块：经 getGear"):
        match = re.search(r'_(D7|D15|M1|M3|M6|M12)_', path.upper())
        if not match:
            return None
        bounds = GEAR_BOUNDS[match[1]]

        def gear(value):
            number = js_number(value)
            if number is None or number < 0:
                return ""
            return f"{sum(number >= low for low in bounds)}档"

        return gear
    if rule.startswith("null/undefined/严格空串 → 空串；parseInt(值)-1"):
        mapping = _enum(field)
        if not mapping:
            return None

        def integer_enum(value):
            if value is MISSING or value is None or value == "":
                return ""
            text = js_string(value)
            prefix = re.match(r'\s*([+-]?[0-9]+)', text)
            return mapping.get(int(prefix[1]), text) if prefix else text

        return integer_enum
    if rule.startswith('函数switch严格匹配字符串编码'):
        # 学历、学习形式、办学性质各有独立字典，不能按相同编码混用。
        lines = enum.splitlines()
        pairs = [re.fullmatch(r'"([0-9]+)" → (.+)', row) for row in lines[:-1]]
        if not pairs or not all(pairs) or lines[-1] != '严格字符串匹配；其他／空值 → -。':
            return None
        mapping = {m[1]: m[2] for m in pairs}
        return lambda v: mapping.get(v, "-") if isinstance(v, str) else "-"
    if rule.startswith('情侣/来查贝等主题：真值显示「命中」'):
        return lambda v: "命中" if js_truthy(v) else "未命中"
    if rule.startswith('Tabs 等主题直接展示命中次数原值'):
        # 此条目录跨主题叙述，只在Tabs组件确为当前来源时直出。
        if not any('/Tabs/Anomalous/' in source for source in field.get('source_files', [])):
            return None
        return lambda v: v
    if ' ? "是" : "否"' in rule or " ? '是' : '否'" in rule:
        # 只处理直接真值判断；带==、其他运算或条件依赖的表达式不可套用。
        expression = rule.split("表达式：", 1)[-1].split("；", 1)[0]
        if re.fullmatch(r'[\w.\[\]"? ]+\? [\'\"]是[\'\"] : [\'\"]否[\'\"]', expression):
            return lambda v: "是" if js_truthy(v) else "否"
    if rule.startswith("原值按 ||") or rule.startswith(("按 JavaScript 真值判断：真值显示原值", "假值显示——", "使用 || 占位")):
        placeholder = "——" if "——" in rule else "-"
        # 这些规则中的enum若不为空，仍可能另有转换，不能忽略。
        if enum:
            return None
        return lambda v: v if js_truthy(v) else placeholder
    if rule.startswith("null/undefined/空串/数字0/字符串0 → ——"):
        # 此接口副本中的区间已由Java转换，Python只复现前端displayOrDash，不能二次解码。
        return lambda v: "——" if v is MISSING or v is None or v == "" or type(v) in (int, float) and v == 0 or v == "0" else js_string(v)
    if rule.startswith("接口响应副本将数值1/0转是/否"):
        # 输入是Java接口已装配的响应，仅重现前端yesNo；不重复跑后端trim等转换。
        def yes_no(value):
            if value is MISSING or value is None or value == "":
                return "——"
            number = js_number(value)
            return "是" if number == 1 else "否" if number == 0 else js_string(value)

        return yes_no
    if rule.startswith("接口响应副本先将可解析整数≤0或空值转为——"):
        def days(value):
            if value is MISSING or value is None or value == "" or value == "0" or type(value) in (int, float) and value == 0:
                return "——"
            text = js_string(value).strip()
            return text if text == "——" or text.endswith("天") else text + "天"

        return days
    if rule.startswith("接口副本：仅已有KEY转换；空→0%"):
        def rate(value):
            text = js_string(value).strip()
            if text.endswith('%'):
                prefix = re.match(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)', text[:-1])
                number = float(prefix[0]) if prefix else 0
            else:
                number = js_number(value) or 0
                if 0 < number <= 1:
                    number = math.floor(number * 100 + 0.5)
            return f"{math.floor(number + 0.5)}%"

        return rate
    if rule.startswith(("null/undefined/空串 → ——", "undefined/null/严格空串→——")) and not enum:
        return lambda v: "——" if v is MISSING or v is None or v == "" else js_string(v)
    if rule.startswith("原始数值直接展示，不做枚举或分档转换。"):
        return lambda v: v
    if rule.startswith(("直接输出原值", "原值显示。", "原值显示（个）", "原值直接插值，后跟固定单位")) and not enum:
        return lambda v: v
    if rule.startswith("原值传给页面或子组件；此表达式未添加占位或数值转换。") and not enum:
        return lambda v: v if not isinstance(v, (dict, list)) else UNCONFIRMED
    if rule.startswith("页面无标签，直接输出文本") or rule.startswith("原样输出，前缀「报告生成时间：」"):
        return lambda v: v
    if rule.startswith("仅此字段为JavaScript真值时显示该行并输出原值"):
        return lambda v: v if js_truthy(v) else ""
    return None


def _amount_range_wan(value):
    """复现固定zz区间和formatRangeWan，保留1元下界及未知文本的页面行为。"""
    if value is MISSING or value is None or value == '':
        return ''
    text = js_string(value)
    prefix = re.match(r'\s*([+-]?[0-9]+)', text)
    index = int(prefix[1]) if prefix else None
    text = {1: '1~45000', 2: '45000~115000', 3: '115000~ ∞'}.get(index, text)
    if '万' in text:
        return text

    def replace(match):
        number = float(match[0])
        if not math.isfinite(number):
            return match[0]
        if number == 0:
            return '0'
        wan = number / 10000
        if wan < 0.01:
            return format(number, 'g')
        # 页面小于10万用toFixed(1)，按实际二进制浮点取最近十进制、平局向上；
        # 不能统一用Math.round，否则1.15.toFixed(1)的1.1会错误变成1.2。
        rounded = (math.floor(wan * 10 + 0.5) / 10 if wan >= 10 else
                   float(Decimal.from_float(wan).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)))
        return js_string(rounded)

    return re.sub(r'\s+', '', re.sub(r'\d+(?:\.\d+)?', replace, text)) + '万'


def display_dependencies(field):
    """只声明固定组件已核实的本地依赖；不执行目录表达式或接受模型路径。"""
    path, mid = field.get('path', ''), field.get('module_id')
    match = re.fullmatch(r'report.NONE_BANK_APPLY_(D7|D15|M1|M3|M6|M12)_APPLY_(?:QT|P2P)_(COUNT|ORG_COUNT)', path)
    if match and str(field.get('frontend_processing', '')).startswith('QT 与 P2P'):
        return tuple(f'report.NONE_BANK_APPLY_{match[1]}_APPLY_{kind}_{match[2]}' for kind in ('QT', 'P2P'))
    if mid == 145 and path == 'report.taizhouMarriageData.data.state':
        return ('report.taizhouMarriageData.code',)
    if mid == 169 and path in {'report.gxOnlineDurationModel.isp', 'report.gxOnlineDurationModel.min'}:
        return tuple('report.gxOnlineDurationModel.' + key for key in ('code', 'queryResult', 'min', 'max'))
    if mid == 11 and re.fullmatch(r'report.ABNORMAL_LIST_[A-Z0-9_]+_(?:COUNT|DURATION)', path):
        return ('report.abnormalBehavior', path.removesuffix('DURATION') + 'COUNT') if path.endswith('DURATION') else ('report.abnormalBehavior',)
    return ()


def internal_display_field(field):
    """查询码和时长上界只在本地组装可见结果，不作为独立客服指标。"""
    return (field.get('module_id') == 145 and field.get('path') == 'report.taizhouMarriageData.code'
            or field.get('module_id') == 169 and field.get('path') in {
                'report.gxOnlineDurationModel.code', 'report.gxOnlineDurationModel.queryResult', 'report.gxOnlineDurationModel.max'})


def _case_numbers(field, value):
    """按同一记录的位置做null合并；首个空串停止回退，不错配不同记录。"""
    paths = [path.strip() for path in field.get('path', '').split('|')]
    if len(paths) != 3 or [path.rsplit('.', 1)[-1] for path in paths] != ['caseNo', 'c_ah', 'ah']:
        return UNCONFIRMED
    if len({path.rsplit('.', 1)[0] for path in paths}) != 1 or not isinstance(value, list) or len(value) != 3:
        return UNCONFIRMED
    arrays = [item.get('value') if isinstance(item, dict) and item.get('present') else None for item in value]
    lengths = {len(item) for item in arrays if isinstance(item, list)}
    if len(lengths) != 1 or any(item is not None and not isinstance(item, list) for item in arrays):
        return UNCONFIRMED
    result = []
    for index in range(next(iter(lengths))):
        selected = MISSING
        for items in arrays:
            item = items[index] if items is not None else {}
            if not isinstance(item, dict):
                return UNCONFIRMED
            if item.get('present') and item.get('value') is not None:
                selected = item['value']
                break
        if isinstance(selected, (dict, list)):
            return UNCONFIRMED
        text = '' if selected is MISSING else js_string(selected).strip()
        result.append({'present': True, 'value': '——' if text in ('', 'undefined', 'null') else text})
    return result


def display_field(field, value, present=True, *, dependencies=None, modules=(), theme=None):
    """返回页面可见值，未知规则返回哨兵；数组逐项转换且不携带候选路径。

    数组读取器的present/value包装保留位置，避免某条缺失与下一条错位。
    不支持对象直接传子组件的未知后续变换，也不把未知编码反推成精确统计。
    """
    path, mid = field.get('path', ''), field.get('module_id')
    rule = str(field.get('frontend_processing', ''))
    deps = {} if dependencies is None else dependencies
    required = display_dependencies(field)
    if required and not all(key in deps for key in required):
        return UNCONFIRMED
    if required and rule.startswith('QT 与 P2P'):
        # 同提交noneBankApply adapter实际先Number再相加，目录旧文案仍写直接+。
        # 两侧都缺失时保留缺失语义；已有一侧时按组件的Number||0处理。
        if all(deps[key] is MISSING for key in required):
            return MISSING
        total = sum(js_number(deps[key]) or 0 for key in required)
        if '档位展示经 getGear' in rule:
            period = re.search(r'_(D7|D15|M1|M3|M6|M12)_', path)[1]
            return f'{sum(total >= low for low in GEAR_BOUNDS[period])}档' if total >= 0 else ''
        return total
    if mid == 145 and path == 'report.taizhouMarriageData.data.state':
        code = deps[required[0]]
        # tzMarriage adapter同时接受数字和字符串1/3；失败查询不读取state作结论。
        if code is MISSING or code is None or js_number(code) != 0:
            return '未查到登记记录'
        return '已婚' if value == '1' or type(value) in (int, float) and value == 1 else '离异' if value == '3' or type(value) in (int, float) and value == 3 else '未查到登记记录'
    if mid == 169 and required:
        base = 'report.gxOnlineDurationModel.'
        if js_string(deps[base + 'code']) != '200' or js_string(deps[base + 'queryResult']) != '1':
            return HIDDEN
        if path.endswith('.isp'):
            return js_string(value) if js_truthy(value) else '-'
        lower, upper = deps[base + 'min'], deps[base + 'max']
        if js_string(lower) == '24' and upper is None:
            return '24个月以上'
        return {('0', '3'): '1-3个月', ('3', '6'): '3-6个月', ('6', '12'): '6-12个月',
                ('12', '24'): '12-24个月'}.get((js_string(lower), js_string(upper)), '——')
    if mid == 11 and required:
        nested = deps['report.abnormalBehavior']
        # 固定adapter以非null判定嵌套数据；空对象也会遮盖旧字段。企业主题仍展示旧表。
        if theme != 6 and nested is not MISSING and nested is not None:
            return HIDDEN
        if path.endswith('_DURATION'):
            if not js_truthy(deps[required[1]]):
                return '-'
            if value is MISSING or not present:
                return UNCONFIRMED
            adjusted = js_string(value) + '1' if isinstance(value, str) else (js_number(value) or 0) + 1
            return f'近{js_string(adjusted)}年内'
    if mid == 4 and path == 'report.BRS_SUMMARY_00004':
        if not isinstance(value, list):
            return UNCONFIRMED
        # 以当前模板匹配模块名称，不能把原始moduleId作为报告内容外发。
        return [module['name'] for module in modules if any(
            item is not None and js_number(item) == module['module_id'] for item in value)]
    if rule.startswith('caseNo ?? c_ah ?? ah'):
        return _case_numbers(field, value)
    formatter = _formatter(field)
    if formatter is None:
        return UNCONFIRMED

    def convert(child):
        if isinstance(child, list) and '[]' in field.get('path', ''):
            return [convert(item) for item in child]
        if isinstance(child, dict) and set(child) <= {'present', 'value'} and 'present' in child:
            result = formatter(child.get('value') if child['present'] else MISSING)
            return {'present': child['present'], 'value': None if result is MISSING else result}
        return formatter(child)

    result = convert(value if present else MISSING)
    # 未确认子项不能混进JSON；整字段不外发，不能退回原数组。
    def unknown(child):
        if child is UNCONFIRMED:
            return True
        if isinstance(child, dict):
            return any(unknown(v) for v in child.values())
        return isinstance(child, list) and any(unknown(v) for v in child)

    return UNCONFIRMED if unknown(result) else None if result is MISSING else result
