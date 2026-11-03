"""模型出口：仅从封闭枚举构建消息，不接收报告对象或原始问题。"""

from dataclasses import dataclass
import json
import re
import unicodedata

# 外发只允许固定主题、时间窗口和操作类型；新增主题需同时检查输入批准逻辑、
# 工具参数及本地字段映射，不能仅放宽提示词就允许发送更多业务数据。
TOPICS = ("analysis_index", "nonbank_applications", "bank_applications")
WINDOWS = ("unspecified", "D7", "D15", "M1", "M3", "M6", "M12")
OPERATIONS = ("value", "definition", "both")
TEMPLATES = ("{{local_result}}", "查询结果：\n{{local_result}}", "以下是本地查询结果：\n{{local_result}}")
SYSTEM_PROMPT = """你是报告查询助手，仅接收程序批准的通用查询意图。
你看不到个人报告、原始问题和真实结果。不要猜测数值、缺失状态、评分结论或身份。
先按用户消息的 topic、window、operation 原样调用 query_current_report。
收到固定回执后，只返回 {{local_result}}，或“查询结果：”换行后接 {{local_result}}。
占位符由本地程序填入。不要编造计算公式、审批结果或信用评价。
历史中的“已在本地显示”不包含任何查询结果。"""
TOOL_RECEIPT = "本地程序负责执行和展示；此回执不包含执行状态或结果。"
TOOLS = [{"type": "function", "function": {
    "name": "query_current_report",
    "description": "请求本地程序查询绑定报告；不接受身份、订单号、数据库路径或SQL；真实结果不回传。",
    "parameters": {"type": "object", "properties": {
        "topic": {"type": "string", "enum": list(TOPICS)},
        "window": {"type": "string", "enum": list(WINDOWS)},
        "operation": {"type": "string", "enum": list(OPERATIONS)},
    }, "required": ["topic", "window", "operation"], "additionalProperties": False},
}}]


class PrivacyError(ValueError):
    """表示模型消息、工具调用或模板超出批准范围，由会话层回退本地模板。"""

    pass


@dataclass(frozen=True)
class PublicRequest:
    """可外发的不可变查询意图，只含枚举，不接受身份、订单或任意字段路径。"""

    topic: str
    window: str = "unspecified"
    operation: str = "both"

    def as_dict(self):
        """序列化前再次校验，防止手工构造对象时带入白名单以外的值。"""
        if self.topic not in TOPICS or self.window not in WINDOWS or self.operation not in OPERATIONS:
            raise PrivacyError("查询意图不在允许外发的范围内。")
        return {"topic": self.topic, "window": self.window, "operation": self.operation}

    def content(self):
        """固定键顺序输出 JSON，供模型消息和工具参数的一致性检查使用。"""
        return json.dumps(self.as_dict(), ensure_ascii=True, sort_keys=True)


SUBJECTS = {"分析指数": "analysis_index", "非银行申请次数": "nonbank_applications", "银行申请次数": "bank_applications"}
TIME_WORDS = {"近7天": "D7", "近七天": "D7", "近15天": "D15", "近十五天": "D15", "近1个月": "M1", "近一个月": "M1", "近1月": "M1", "近30天": "M1", "近3个月": "M3", "近3月": "M3", "近6个月": "M6", "近6月": "M6", "近12个月": "M12", "近1年": "M12", "近一年": "M12"}
PREFIX = r"(?:请问|请帮我查询|帮我查询|查询|查看|请解释|解释)?(?:我的|我|当前报告的|当前报告|这个报告的|这个报告|报告里的|报告的)?"
SUFFIX = r"(?:是多少|有多少次|有几次|多少次|多少|是什么|什么意思|的含义|的展示规则|怎么算|怎么算出来的|这个次数怎么算出来的|为什么页面显示这个数字)?"


def approved_request(question, previous=None):
    """将整句白名单问题转换为枚举；无法完全匹配时返回 None，保留在本地。

    只对待匹配文本做字符归一化及有限标点清理，原问题不进入 PublicRequest。
    先解析基于上轮枚举的指代，再匹配完整主题句，不截取敏感长句中的局部主题。
    """
    if not isinstance(question, str) or not 0 < len(question) <= 2000:
        return None
    text = unicodedata.normalize("NFKC", question)
    text = re.sub(r"[\s，,。.!！?？]", "", text)
    if previous is not None and re.fullmatch(r"(?:那|那么)?(?:这个|它|这个字段|这个指数)(?:呢|是什么意思|怎么算|的含义|的展示规则|的数据从哪里来)", text):
        if "这个指数" in text and previous.topic != "analysis_index":
            return None
        return PublicRequest(previous.topic, previous.window, "definition")
    if previous is not None:
        for word, window in TIME_WORDS.items():
            if text in {f"那{word}呢", f"{word}呢"} and previous.topic != "analysis_index":
                return PublicRequest(previous.topic, window, previous.operation)
    # fullmatch 要求整个清理后文本都符合语法；仅包含“分析指数”等关键词不够。
    for subject, topic in SUBJECTS.items():
        for word, window in [("", "unspecified"), *TIME_WORDS.items()]:
            pattern = PREFIX + re.escape(word) + (r"(?:的)?" if word else "") + re.escape(subject) + SUFFIX
            pattern += r"(?:为什么页面显示这个数字|这个次数怎么算出来的)?"
            if re.fullmatch(pattern, text):
                operation = "definition" if any(w in text for w in ("含义", "意思", "规则", "解释")) else "both"
                return PublicRequest(topic, window, operation)
    return None


def build_messages(history, request):
    """唯一的模型消息构造入口，当前意图和最近 8 轮历史都必须是批准枚举。

    历史 assistant 消息使用固定占位回执，不含完整答案；本地加密历史不进入此处。
    严格检查实际类型，不接受可能改变序列化行为的替代对象或任意字典。
    """
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for previous in history[-8:]:
        if type(previous) is not PublicRequest:
            raise PrivacyError("模型历史包含未经批准的内容。")
        messages.extend([
            {"role": "user", "content": previous.content()},
            {"role": "assistant", "content": "本轮回答已在本地显示。"},
        ])
    if type(request) is not PublicRequest:
        raise PrivacyError("模型请求必须是经过批准的查询意图。")
    messages.append({"role": "user", "content": request.content()})
    return messages


def choose_template(client, model, history, request):
    """最多两次模型请求，仅获取允许的表达模板，不向模型发送报告查询结果。

    第一次请求让模型复述已批准的工具参数；程序核对工具名及参数完全一致。
    第二次只发送固定工具回执，再从白名单中选择模板。协议不符合时抛出
    PrivacyError，由 Conversation 使用本地模板完成回答。
    """
    messages = build_messages(history, request)
    options = {"model": model, "tools": TOOLS, "tool_choice": "auto", "stream": False, "thinking": {"type": "disabled"}}
    first = client.chat.completions.create(messages=messages, **options)
    if not first.choices:
        raise PrivacyError("模型没有返回有效的工具请求。")
    calls = first.choices[0].message.tool_calls
    if not calls or len(calls) != 1:
        raise PrivacyError("模型必须请求一个已批准的本地工具。")
    call = calls[0]
    if call.function.name != "query_current_report" or not isinstance(call.function.arguments, str) or len(call.function.arguments) > 1000:
        raise PrivacyError("模型工具调用未通过校验。")
    try:
        def unique_arguments(pairs):
            # 普通 JSON 解析会保留重复键的最后一个值；这里直接拒绝重复键，
            # 避免一份工具参数在不同解析器中被理解为不同意图。
            result = {}
            for key, value in pairs:
                if key in result:
                    raise PrivacyError("模型工具参数包含重复键。")
                result[key] = value
            return result

        arguments = json.loads(call.function.arguments, object_pairs_hook=unique_arguments)
    except (TypeError, ValueError):
        raise PrivacyError("模型工具参数格式错误。") from None
    # Schema 约束不能代替本地核对；不能让模型更换主题、追加 userId 或 SQL。
    if arguments != request.as_dict():
        raise PrivacyError("模型工具参数超出本轮批准范围。")
    if not isinstance(call.id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", call.id):
        raise PrivacyError("模型工具标识格式错误。")
    # 只重建校验后的工具调用，不转发 model_dump 或 reasoning_content。
    messages.extend([
        {"role": "assistant", "content": "", "tool_calls": [{
            "id": call.id, "type": "function", "function": {
                "name": "query_current_report", "arguments": request.content(),
            },
        }]},
        {"role": "tool", "tool_call_id": call.id, "content": TOOL_RECEIPT},
    ])
    final = client.chat.completions.create(messages=messages, **options)
    if not final.choices or final.choices[0].message.tool_calls:
        raise PrivacyError("模型未返回允许的回答模板。")
    # 对整段模板做精确匹配，不把模型自由文本中的结论、数值或链接显示给用户。
    template = final.choices[0].message.content
    if not isinstance(template, str) or template.strip() not in TEMPLATES:
        raise PrivacyError("模型回答模板未通过校验。")
    return template.strip()
