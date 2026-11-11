"""仅在本地解析口语、字段关键词和追问；结果绝不作为模型出口的批准依据。"""

from dataclasses import dataclass, field
import re
import unicodedata

from report_assistant.reports.tools import field_matches_window, is_application_total, time_windows


def normalize(text):
    """归一化本地匹配文字，保留原问题供加密历史使用。"""
    text = unicodedata.normalize("NFKC", str(text)).casefold()
    text = re.sub(r"[\s，,。.!！?？、：:（）()]", "", text)
    return re.sub(r"非银(?!行)", "非银行", text)


def is_report_overview(question):
    """完整匹配整份报告解读，不把“分析报告中的指数”等具体字段问题泛化。"""
    text = normalize(question)
    text = re.sub(r"^(?:你好|您好)(?:小贝)?", "", text)
    base = (r"(?:请|麻烦)?(?:帮我|给我)?(?:整体|全面|综合|按模块)?"
            r"(?:分析|解读|总结|概括|看看|看一看|看)(?:一下|下)?"
            r"(?:我的|这份|这个|当前|该)?(?:整份|整个|全部)?(?:信用)?报告"
            r"(?:一下|下|吧|好吗|可以吗)?(?:然后|并|再)?(?:做个|做一个|给个|给一个)?(?:整体总结)?")
    return bool(re.fullmatch(base, text) or re.fullmatch(
        r"(?:请)?(?:从头|按模块|逐模块)(?:分析|解读|总结)(?:一下|下)?(?:我的|这份|当前)?报告", text))


# 每组只帮助定位资料，不据此断言同义字段具有相同业务口径。
CONCEPTS = (
    ("分析指数", "风险指数", "评分", "分数", "多少分"),
    ("非银行",), ("银行",), ("申请",), ("逾期",),
    ("机构数", "多少家", "几家"), ("次数", "多少次", "几次"),
    ("失信", "老赖"), ("限高", "限制高消费"), ("执行案件", "被执行"),
    ("关联案件", "涉诉", "诉讼", "官司"), ("法院",),
    ("借贷", "贷款"), ("网贷", "网络贷款"), ("结清",), ("还款",),
    ("婚姻", "结婚", "离婚"), ("学历", "教育"), ("收入",),
    ("车辆", "车产"), ("房产", "房屋"), ("公积金",),
    ("手机",), ("在网时长", "入网时间"), ("欺诈", "诈骗"),
    ("社交风险",), ("信用查询", "查询记录"),
    ("企业", "公司"), ("股东",), ("法人",), ("经营异常",),
    ("夜间",), ("白天",), ("周末",), ("传统银行",),
    ("消费金融",), ("汽车金融",), ("代偿分期",),
)
DEFINITION_WORDS = ("什么意思", "含义", "解释", "规则", "怎么算", "怎么计算", "从哪里来", "为什么")


@dataclass
class LocalQuery:
    """本地候选、操作与提示；scope 保存同指标的跨周期候选以支持后续换窗口。"""

    fields: list = field(default_factory=list)
    scope: list = field(default_factory=list)
    operation: str = "both"
    message: str = ""


class LocalQuestionResolver:
    """使用当前报告启用字段匹配问题，不访问网络、不持有报告原始值。"""

    def __init__(self, tools):
        self.tools = tools
        self.fields = tools.current_fields()

    def guidance(self, lead="请补充想查询的指标，例如“有没有逾期”或“分析指数是多少”。"):
        """按本报告实际登记的模块提供下一步，避免重复空泛的隐私提示。"""
        modules = list(dict.fromkeys(f.get("module_name", "") for f in self.fields if f.get("module_name")))
        examples = list(dict.fromkeys(f.get("name", "") for f in self.fields if f.get("name")))[:3]
        return "\n".join([
            lead, f"当前版本：{self.tools.theme_name}；启用模块中登记了 {len(self.fields)} 条字段资料（不代表均已提供值）。",
            "可查模块：" + ("、".join(modules[:16]) or "暂无已登记模块") + ("等。" if len(modules) > 16 else "。"),
            "也可以输入：" + "；".join("/find " + name for name in examples),
        ])

    def _result(self, scope, window, operation):
        """先筛周期再截取候选，记录明确的无匹配原因，不回退到其他统计周期。"""
        unique = {(f["module_id"], f.get("path"), f.get("name")): f for f in scope}
        scope = list(unique.values())
        matches = [f for f in scope if field_matches_window(f, window)]
        if len(matches) == 1:
            scope = self.metric_scope(matches[0])
        message = ""
        if not matches:
            message = self.guidance(
                "当前报告的已登记字段中未找到该指标或指定周期；不能据此判断为0或不存在记录。"
            )
        elif len(matches) > 6:
            message = f"共有 {len(matches)} 个候选，本次显示前6项；请补充模块、字段名或周期缩小范围。"
        return LocalQuery(matches[:6], scope, operation, message)

    def metric_scope(self, chosen):
        """字段选择后只在同模块、同字段名内切换周期，不借用别的机构或模块。"""
        def metric_name(item):
            return re.sub(r"(?:近|最近|过去)?(?:\d+|[一二三六七半]+)(?:个月|天|月|年|周)", "", normalize(item.get("name", "")))
        return [f for f in self.fields if f["module_id"] == chosen["module_id"]
                and metric_name(f) == metric_name(chosen)]

    def resolve(self, question, previous=None):
        """返回本地查询结果；只有明确指代才复用上一轮，未知新问题清空上下文。"""
        raw = question.strip()
        text = normalize(raw)
        operation = "definition" if any(word in text for word in DEFINITION_WORDS) else "both"
        if re.search(r"多少|几次|几家|当前值|数值", text):
            operation = "both"
        if raw.startswith("/find "):
            fields = self.tools.search_report_fields(raw[6:].strip())
            return self._result(fields, "unspecified", "both")
        pick = re.fullmatch(r"(?:/pick\s+|选(?:择)?第?|第)([1-6])(?:个|项)?", raw)
        if pick:
            index = int(pick.group(1)) - 1
            if previous and index < len(previous.fields):
                chosen = previous.fields[index]
                return LocalQuery([chosen], self.metric_scope(chosen), previous.operation)
            return LocalQuery(message="该序号不在上次列出的候选中；请先查询字段，再用 /pick 序号选择。")
        if raw.startswith("/"):
            return LocalQuery(message=self.guidance("未识别该命令；可用 /find 关键词 或 /pick 序号。"))

        # 自然月与日期范围不能擅自替换为滚动窗口；多周期比较也不能只取其中一个。
        if re.search(r"上个?月|去年|今年|本月|这个月|上周|本周|\d{4}[-/年]\d{1,2}", text):
            return LocalQuery(message="当前仅按资料登记的滚动周期查询，不能把自然月或日期区间换算成近1个月。请明确一个周期，例如近7天、近1个月。")
        windows = time_windows(text)
        if len(windows) > 1:
            return LocalQuery(message="这次提到了多个统计周期，请每次指定一个周期，避免混用口径。")
        window = windows[0] if windows else "unspecified"
        reference = r"(?:这个字段|这个数值|这个指标|这个指数|这一项|这个|这项|这|它)"
        followup = re.fullmatch(r"(?:那|那么)?" + reference + r"?(?:呢|是什么意思|什么意思|是啥意思|啥意思|含义|解释一下|怎么理解|怎么算|是怎么算的|怎么算出来的|为什么是0|为什么这么低|为什么这么高|的数据从哪里来|数据从哪里来|的含义|的展示规则)", text)
        value_followup = re.fullmatch(r"(?:那|那么)?" + reference + r"(?:是多少|的值是多少|的数值是多少|有多少次)", text)
        inference_followup = re.fullmatch(r'(?:那|那么)(?:是不是|是否)(?:就)?(?:等于|说明|代表)'
                                        r'(?:没有申请|没有记录|从没申请过|无风险|没有逾期)(?:呢|吗)?', text)
        window_followup = re.fullmatch(r"(?:那|那么)?(?:最近|过去|近)?(?:\d+|十二|十五|一个|[一二两三六七半])(?:个月|天|周|月|年)(?:的)?(?:呢|是多少|有多少次)?", text)
        if followup or value_followup or window_followup or inference_followup:
            if not previous or not previous.fields:
                return LocalQuery(message=self.guidance("请先说明“这个”指哪个字段，或先选定一个候选。"))
            if window_followup:
                return self._result(previous.scope, window, "both")
            return LocalQuery(previous.fields, previous.scope, "both" if value_followup else "definition")

        if any(word in text for word in ("能不能贷", "能贷款吗", "能贷多少", "通过率", "审批概率", "能批吗", "能下款吗")):
            return LocalQuery(message=self.guidance("报告字段不能确定审批结果或可贷额度。可以继续查询申请、逾期、案件等具体记录。"))
        # 用完整句式覆盖“分析下我的报告”等口语，避免把字段问题也泛化成整体概览。
        overview = re.fullmatch(r"(?:请|麻烦)?(?:帮我|给我)?(?:整体|全面|综合)?(?:分析|解读|看看|看一看|看)(?:一下|下)?(?:我的|这份|这个|当前|该)?(?:信用)?报告(?:一下|下|吧|好吗|可以吗)?", text)
        if overview or any(word in text for word in ("分析报告", "分析一下报告", "分析这份报告", "解读报告", "解读一下报告", "看看报告", "看一下报告", "报告怎么样", "报告有哪些", "有什么内容", "能查什么", "有哪些模块")):
            return LocalQuery(message=self.guidance("可以逐项查看这份报告的字段值和登记规则，请选择一个模块或指标继续。"))

        # 先完整字段名，再以独立概念过滤；银行必须排除“非银行”，词组包含时保留长词组。
        exact = [f for f in self.fields if any(len(normalize(f.get(key, ""))) >= 2
                 and normalize(f.get(key, "")) in text for key in ("name", "path"))]
        if exact:
            longest = max(len(normalize(f.get("name", ""))) for f in exact)
            exact = [f for f in exact if len(normalize(f.get("name", ""))) == longest]
        groups = [group for group in CONCEPTS if any(word in text for word in group)]
        # “非银行”内含“银行”，多个长词组亦会包含短词组；不能要求候选同时命中这些子词。
        groups = [g for g in groups if not any(g != other and all(any(word in longer for longer in other) for word in g)
                                              for other in groups)]
        candidates = exact or self.fields
        # 夜间/周末等限定不能被一个更短的完整名称吞掉，否则回退会误报全部申请次数。
        qualifiers = {('夜间',), ('白天',), ('周末',), ('传统银行',), ('消费金融',), ('汽车金融',), ('代偿分期',)}
        if exact and any(group in qualifiers and not any(
                any(word in normalize(f.get('name', '') + f.get('module_name', '')) for word in group)
                for f in exact) for group in groups):
            exact, candidates = [], self.fields
        for group in groups:
            matched = [f for f in candidates if any(word in normalize(f.get("name", "") + " " + f.get("module_name", "")) for word in group)
                       and not (group == ("银行",) and "非银行" in normalize(f.get("module_name", "") + f.get("name", "")))]
            # 完整字段名已明确时，粘贴的手机号等无关文字不能让该字段失配。
            # 可用的模块限定仍然生效，例如同名申请次数中的银行/非银行。
            if matched or not exact or group in (("银行",), ("非银行",)):
                candidates = matched
        basic = {("非银行",), ("银行",), ("申请",), ("次数", "多少次", "几次")}
        if (any(g in groups for g in (("非银行",), ("银行",)))
                and ("申请",) in groups and ("次数", "多少次", "几次") in groups
                and all(g in basic for g in groups)):
            candidates = [f for f in candidates if is_application_total(f)]
        if not exact and not groups:
            # 支持用户直接问本版本独有的模块，而不要求维护所有模块的别名。
            candidates = [f for f in self.fields if len(normalize(f.get("module_name", ""))) >= 2
                          and normalize(f.get("module_name", "")) in text]
        if not candidates:
            return self._result([], window, operation)
        return self._result(candidates, window, operation)
