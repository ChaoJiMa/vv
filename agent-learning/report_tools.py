"""仅在本地使用的报告工具；这里的返回值不得传入模型请求。"""

from copy import deepcopy
import json
from pathlib import Path
import re
import unicodedata

from report_redaction import collect_literals, protected_path, PERSONAL_LABEL
from report_score import describe_score
from report_display import MISSING, UNCONFIRMED, display_dependencies, display_field

DATA_DIR = Path(__file__).with_name("data")

# 本地时间匹配允许目录中实际存在的周期；不扩大模型出口的时间枚举。
_NUMBERS = {"一": 1, "一个": 1, "七": 7, "两": 2, "二": 2, "三": 3,
            "六": 6, "十二": 12, "十五": 15, "半": 0.5}
_TIME_PATTERN = re.compile(r"(?:最近|过去|近)?(\d+|十二|十五|一个|[一二两三六七半])(个月|天|周|月|年)")


def time_windows(text):
    """提取本地统计周期，返回去重窗口；不把上个月等自然月转换成滚动周期。"""
    text = unicodedata.normalize("NFKC", str(text)).replace(" ", "")
    windows = []
    for match in _TIME_PATTERN.finditer(text):
        number, unit = match.groups()
        count = _NUMBERS[number] if number in _NUMBERS else int(number)
        if unit == "周":
            count, unit = count * 7, "天"
        if unit == "年":
            count, unit = count * 12, "月"
        if count != int(count):
            continue
        code = ("D" if unit == "天" else "M") + str(int(count))
        code = {"D30": "M1", "D90": "M3", "D180": "M6", "D365": "M12"}.get(code, code)
        if code not in windows:
            windows.append(code)
    return windows


def field_matches_window(field, window):
    """同时核对窗口标签、名称和路径编码，兼容小写 d15、month12，避免串期。"""
    if window == "unspecified":
        return True
    labels = str(field.get("window", "")) + " " + str(field.get("name", ""))
    if window in time_windows(labels):
        return True
    codes = [window.casefold()]
    if window.startswith("M"):
        codes.append("month" + window[1:])
        days = {"M1": "d30", "M3": "d90", "M6": "d180", "M12": "d365"}
        if window in days:
            codes.append(days[window])
    path = str(field.get("path", "")).casefold()
    return any(re.search(r"(?:^|_)" + re.escape(code) + r"(?:_|$)", path) for code in codes)


def is_application_total(field):
    """只认登记名称中的申请总次数，不把机构数或夜间等分项冒充总次数。"""
    name = str(field.get("name", ""))
    return bool(re.match(r"(?:非银行|非银|银行)?申请次数", name)
                or name.startswith("全部机构申请次数"))


def field_window_label(field):
    """优先显示登记周期；资料只在路径编码中记录周期时，补充可辨识的候选标签。"""
    if field.get("window"):
        return str(field["window"])
    matches = re.findall(r"_(d|month|m)(\d+)(?=_|$)", str(field.get("path", "")).casefold())
    labels = list(dict.fromkeys(f"近{number}{'天' if unit == 'd' else '个月'}" for unit, number in matches))
    return "、".join(labels)


class UnsupportedReportTheme(ValueError):
    """所选报告主题没有独立字段资料；调用方应允许重选，不能回退到其他主题。"""


def select_theme_catalog(catalog, theme):
    """按真实主题编号选择目录，兼容显式注入的旧单主题资料，不应用外观别名。"""
    if type(theme) is not int or not isinstance(catalog, dict):
        raise ValueError("报告主题或字段资料格式错误。")
    if "themes" in catalog:
        if catalog.get("schema_version") != 2 or not isinstance(catalog["themes"], dict):
            raise ValueError("多主题字段资料格式错误。")
        if str(theme) not in catalog["themes"]:
            raise UnsupportedReportTheme("当前字段资料尚未登记此报告版本。")
        selected = catalog["themes"][str(theme)]
    else:
        selected = catalog
        if type(selected.get("theme")) is int and selected["theme"] != theme:
            raise UnsupportedReportTheme("当前字段资料尚未登记此报告版本。")
    if not isinstance(selected, dict) or type(selected.get("theme")) is not int or selected["theme"] != theme:
        raise ValueError("字段资料中的主题编号不一致。")
    return selected


def split_report_paths(path):
    """校验并拆分登记的候选路径，只接受层级、数组、数字键和动态对象键语法。

    竖线表示资料列出的多个候选依赖；只拆分各自读取，不执行表达式或推测取值优先级。
    """
    if not isinstance(path, str) or not path:
        raise ValueError("字段路径格式错误。")
    paths = tuple(part.strip() for part in path.split("|"))
    pattern = r"[A-Za-z_][A-Za-z_0-9]*(?:\.(?:[A-Za-z_][A-Za-z_0-9]*|\*)|\[\d*\])*"
    if not all(re.fullmatch(pattern, part) for part in paths):
        raise ValueError("字段路径包含不支持的语法。")
    return paths


def read_report_path(data, path):
    """按已批准的字段路径读取 JSON，返回 present 标记以及存在时的 value。

    支持字典层级、[数字] 数组下标/数字键、[] 数组遍历和 .* 动态对象键。
    候选路径分别返回 path/present/value，不推断网页的回退优先级。字段不存在时仅返回
    present=False；存在但值为 None、空字符串或 0 时仍保留原值，不能混为缺失。
    调用方负责先验证路径属于已登记字段，本函数不执行表达式、Python 或 SQL。
    """
    paths = split_report_paths(path)

    def read(node, remaining):
        if not remaining:
            return {"present": True, "value": node}
        token, rest = remaining[0], remaining[1:]
        if token == "*":
            if not isinstance(node, dict):
                return {"present": False}
            return {"present": True, "value": {key: read(value, rest) for key, value in node.items()}}
        if token == "[]":
            if not isinstance(node, list):
                return {"present": False}
            return {"present": True, "value": [read(item, rest) for item in node]}
        key = token[1:-1] if token.startswith("[") else token
        if isinstance(node, dict) and key in node:
            return read(node[key], rest)
        if isinstance(node, list) and token.startswith("[") and key.isdigit() and int(key) < len(node):
            return read(node[int(key)], rest)
        return {"present": False}

    if len(paths) == 1:
        return read(data, re.findall(r"[^.\[\]]+|\[\d*\]", paths[0]))
    results = [{"path": candidate, **read_report_path(data, candidate)} for candidate in paths]
    return {"present": any(result["present"] for result in results), "value": results}


class LocalReportTools:
    """每个会话独立持有报告快照，不通过全局变量共享个人报告。"""

    def __init__(self, order, catalog=None):
        """校验报告与字段资料的主题及模块，只保留当前模板已启用模块的字段。

        order 是 API 适配器或演示文件提供的统一快照；catalog 默认从本地读取。
        根据实际 template.theme 选择独立字段目录；未知主题不套用其他版本口径。
        """
        if not isinstance(order, dict):
            raise ValueError("报告或字段资料格式错误。")
        report_data = order.get("report_data")
        template = report_data.get("template") if isinstance(report_data, dict) else None
        if not isinstance(template, dict) or type(template.get("theme")) is not int:
            raise ValueError("报告缺少有效主题编号。")
        if catalog is None:
            catalog = json.loads((DATA_DIR / "report_fields.json").read_text(encoding="utf-8"))
        catalog = select_theme_catalog(catalog, template["theme"])
        modules = template.get("modules")
        if not isinstance(modules, list) or not all(
            isinstance(m, dict) and type(m.get("moduleId")) is int
            and isinstance(m.get("moduleName"), str) for m in modules
        ):
            raise ValueError("报告模板缺少有效模块列表。")
        if not isinstance(catalog.get("fields"), list):
            raise ValueError("字段资料缺少有效字段列表。")
        for field in catalog["fields"]:
            if not isinstance(field, dict) or type(field.get("module_id")) is not int or not isinstance(field.get("path"), str):
                raise ValueError("字段资料包含无效字段。")
            if field["path"] and not all(
                path.startswith(("report.", "report[")) for path in split_report_paths(field["path"])
            ):
                raise ValueError("字段资料包含报告范围以外的路径。")
        if not isinstance(report_data.get("report"), dict):
            raise ValueError("报告正文格式错误。")
        if not isinstance(order.get("is_demo"), bool) or not (
            isinstance(order.get("report_id"), str) and order["report_id"]
            or isinstance(order.get("order_id"), str) and order["order_id"]
        ):
            raise ValueError("报告缺少有效绑定标识。")
        # 复制输入，避免调用方修改共享字典时改变已绑定报告或可查询字段。
        self._order = deepcopy(order)
        self._catalog = deepcopy(catalog)
        active = {m["moduleId"] for m in modules}
        self._fields = [f for f in self._catalog["fields"] if f.get("module_id") in active]

    @classmethod
    def demo(cls):
        """读取明确标记为演示的数据文件，避免将未标记数据误当作虚构样例。"""
        order = json.loads((DATA_DIR / "current_order.json").read_text(encoding="utf-8"))
        if order.get("is_demo") is not True:
            raise ValueError("演示文件必须明确标记 is_demo=true。")
        return cls(order)

    @property
    def theme(self):
        """返回当前报告的实际主题编号，仅用于本地识别，不发送给模型。"""
        return self._catalog["theme"]

    @property
    def theme_name(self):
        """使用本地目录中的报告版本名称，不信任后端返回的自由文本作为规则来源。"""
        return self._catalog.get("theme_name") or f"报告版本 {self.theme}"

    @property
    def is_demo(self):
        """提供回答前缀所需的演示标记，不据此改变字段权限或缺失值语义。"""
        return self._order["is_demo"]

    @property
    def history_scope(self):
        """构造本地历史的报告绑定值；这是筛选依据，不代替业务用户访问控制。"""
        # 只用于本地加密历史绑定，从不放进模型消息或文件名。
        return json.dumps([
            self.is_demo, self._order.get("report_id"), self._order.get("order_id"),
        ], ensure_ascii=False)

    def current_fields(self):
        """返回可用字段副本，避免外部修改本工具的字段白名单。"""
        return deepcopy(self._fields)

    def score_presentation(self, field, value, safe_label):
        """仅在当前报告内计算已登记评分的展示规则，模板原文始终留在本地。"""
        return describe_score(field, value, self._order["report_data"]["template"], safe_label)

    def display_value(self, field, value, present, redact):
        """在已绑定报告内补齐固定显示依赖，先过滤个人信息，只返回页面可见结果。

        只有当前模板已登记字段可发起转换；依赖路径由本地已核实组件声明，
        不接受模型传入额外路径，也不把原始依赖或模板配置交给模型。
        """
        if field not in self._fields:
            raise ValueError("只能转换当前报告模板已登记的字段。")
        dependencies = {}
        for path in display_dependencies(field):
            raw = read_report_path(self._order['report_data'], path)
            if not raw['present']:
                dependencies[path] = MISSING
                continue
            value_before = raw.get('value')
            safe = redact(value_before, path)
            # 被过滤的标量不能再经Number转换成0；复合对象只用于存在性分支判断。
            if not isinstance(value_before, (dict, list)) and safe != value_before:
                return UNCONFIRMED
            dependencies[path] = safe
        return display_field(field, value, present, dependencies=dependencies,
                             modules=self.current_modules(), theme=self.theme)

    def current_modules(self):
        """按当前报告模板的数组顺序返回模块；名称优先使用本地字段资料。

        字段目录的模块顺序不一定等于报告顺序，且无可读字段的模块也应保留位置。
        返回副本仅供流程编排；送给模型或显示前仍须经过标签与个人信息检查。
        """
        names = {field["module_id"]: field.get("module_name", "") for field in self._fields}
        result, seen = [], set()
        for module in self._order["report_data"]["template"]["modules"]:
            key = module["moduleId"]
            if key not in seen:
                result.append({"module_id": key, "name": names.get(key) or module["moduleName"]})
                seen.add(key)
        return result

    def private_literals(self):
        """本地收集四类个人信息及凭据，供出站过滤；其他报告文字不再一律禁发。

        目录标签可识别业务缩写路径中的姓名、证件等字段，补足仅凭 JSON 键
        无法识别的情况。结果仅在内存使用，不能写入日志或模型消息。
        """
        literals = collect_literals(self._order["report_data"]["report"])
        literals.update(collect_literals({key: value for key, value in self._order.items() if key != "report_data"}))
        for field in self._catalog["fields"]:
            path = field.get("path")
            if path and (protected_path(path) or PERSONAL_LABEL.search(field.get("name", ""))):
                # 只收集实际原值，不将读取包装中的 path/present 当作个人信息。
                raw = read_report_path(self._order["report_data"], path)
                if raw["present"]:
                    literals.update(collect_literals(raw.get("value"), protected=True))
        return frozenset(literals)

    def search_report_fields(self, query, module_id=None):
        """按关键词在当前模板字段资料中检索，最多返回 6 个候选供终端选择。

        关键词按空白或逗号拆分，要求每个词都在字段描述中出现；不访问远端。
        """
        if not isinstance(query, str) or not query.strip() or len(query) > 2000:
            raise ValueError("请输入长度不超过2000字的本地检索关键词。")
        if module_id is not None and type(module_id) is not int:
            raise ValueError("模块编号必须是整数。")
        terms = re.split(r"[\s,，]+", query.strip().casefold())
        matches = []
        for field in self._fields:
            if module_id is not None and field["module_id"] != module_id:
                continue
            text = " ".join(str(field.get(k, "")) for k in ("name", "path", "module_name", "window")).casefold()
            if all(term in text for term in terms):
                matches.append(deepcopy(field))
        return matches[:6]

    def mentioned_fields(self, question):
        """从原问题本地匹配字段名或路径，优先保留名称更完整的候选。

        例如长字段名包含短字段名时，优先长名称，降低混用两个指标的可能。
        多个同名字段仍交由用户选择，不凭问题中的数值推测目标字段。
        """
        candidates = [f for f in self._fields if any(
            isinstance(f.get(key), str) and len(f[key]) >= 2 and f[key] in question
            for key in ("name", "path")
        )]
        if candidates:
            longest = max(len(f.get("name", "")) for f in candidates)
            candidates = [f for f in candidates if len(f.get("name", "")) == longest]
        return deepcopy(candidates[:6])

    def topic_fields(self, topic, window):
        """将已批准的主题和时间枚举映射为本地总指标，去重后最多返回 6 项。

        银行主题排除名称含“非银行”的项；时间窗口同时核对路径编码和资料标签，
        避免近 7 天、近 1 月等不同统计口径混用。
        """
        candidates = []
        for field in self._fields:
            name = str(field.get("name", ""))
            text = name + " " + str(field.get("module_name", ""))
            if topic == "analysis_index":
                matched = "分析指数" in text
            elif topic == "nonbank_applications":
                matched = any(w in text for w in ("非银行", "非银")) and "申请" in text
            elif topic == "bank_applications":
                matched = "银行" in text and "非银" not in text and "申请" in text
            else:
                matched = False
            if not matched:
                continue
            # 模块里还包含机构数、夜间、细分类别。查询总次数时不能取这些项代替。
            if topic != "analysis_index" and not is_application_total(field):
                continue
            if not field_matches_window(field, window):
                continue
            candidates.append(deepcopy(field))
        unique = {(f["module_id"], f.get("path"), f.get("name")): f for f in candidates}
        return list(unique.values())[:6]

    def get_current_order_data(self, field_paths):
        """一次读取 1 到 10 个已登记路径，返回原值及是否提供的标记。

        白名单来自当前报告实际启用的模板模块，不允许手工指定其他模块路径。
        """
        if not isinstance(field_paths, list) or not 1 <= len(field_paths) <= 10:
            raise ValueError("一次只能读取1到10个已登记字段。")
        allowed = {f.get("path") for f in self._fields if f.get("path")}
        if not all(isinstance(path, str) and path in allowed for path in field_paths):
            raise ValueError("只能读取当前报告模板已登记的字段路径。")
        return [{"path": path, **read_report_path(self._order["report_data"], path)} for path in field_paths]

    def render(self, fields, operation="both"):
        """在本地生成字段值与规则说明；多个候选时只列出选项，等待 /pick。

        value 展示原始值，definition 展示本地记录的规则，both 展示两者。
        规则缺失时明确说明，不能用模型补写计算公式或据报告数值推断审批结果。
        """
        if not fields:
            return "当前模板的本地字段资料中未找到对应字段；不能据此断言该项为0。"
        parts = ["【演示数据】" if self.is_demo else "【当前报告·本地结果】"]
        if len(fields) > 1:
            parts.append("找到多个字段或展示模块，请用 /pick 序号选择后再读取，避免混用口径：")
            labels = [f"{f.get('name', '字段')}｜{field_window_label(f)}｜{f.get('module_name', '')}" for f in fields]
            for i, f in enumerate(fields, 1):
                label = labels[i - 1]
                # 同名、同周期候选可能属于不同模块或备选路径，不能给出无法区分的编号。
                if labels.count(label) > 1:
                    label += f"｜模块{f['module_id']}｜{f.get('path', '固定文案')}"
                parts.append(f"{i}. {label}")
            return "\n".join(parts)
        field = fields[0]
        window_label = field_window_label(field)
        parts.append(str(field.get("name", "字段")) + (f"（{window_label}）" if window_label else ""))
        if operation in {"value", "both"} and field.get("path"):
            result = self.get_current_order_data([field["path"]])[0]
            if "|" in field["path"]:
                parts.append("资料列出多个候选路径，分别展示原始值与提供状态，不推断取值优先级。")
            if not result["present"]:
                parts.append("当前值未提供，不能当成0。")
            elif result["value"] is None:
                parts.append("当前原始值为 null（空值），不能当成0。")
            else:
                parts.append("当前原始值：" + json.dumps(result["value"], ensure_ascii=False))
                if type(result["value"]) in (int, float) and result["value"] == 0:
                    parts.append("0可能是统计结果或初始化默认值；仅凭此值不能判断生成原因。")
        if operation in {"definition", "both"}:
            for key, label in (("frontend_processing", "展示规则"), ("enum_mapping", "枚举说明"), ("backend_processing", "资料记录的通用口径")):
                if field.get(key):
                    value = field[key]
                    parts.append(label + "：" + (value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)))
            if not any(field.get(k) for k in ("frontend_processing", "enum_mapping", "backend_processing")):
                parts.append("本地资料未提供该字段的具体计算或展示规则。")
        return "\n".join(parts)
