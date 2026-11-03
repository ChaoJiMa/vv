"""小贝客服知识：固定业务说明留在本地，模型只选择封闭主题，不执行业务操作。"""

import re

from report_projection import normalized


# 联系方式与时段来自用户于2026-10-30提供的客服话术，不推导退款政策或处理时效。
HOTLINE = "400-668-2687"
SERVICE_HOURS = "工作日 9:30-11:30、13:00-18:00"
SERVICE_EMAIL = "ztkj@normalarmor.com"
CONTACT_REPLY = f"官方热线：{HOTLINE}\n服务时间：{SERVICE_HOURS}\n联系邮箱：{SERVICE_EMAIL}"

SERVICE_REPLIES = {
    "thanks": "不客气，能帮您看明白就好。",
    "greeting": (
        "您好，我是小贝🐚。可以帮您解读报告，或说明数据异议、退款咨询和人工客服的联系方法。您想了解哪一项？"
    ),
    "human": (
        "您可以通过以下方式联系人工客服：\n\n" + CONTACT_REPLY
    ),
    "appeal": (
        "报告数据有异议时，请联系人工客服，说明具体模块和有疑问的记录，"
        "并按工作人员要求提供报告编号及证明材料。\n\n" + CONTACT_REPLY
        + "\n\n请通过人工核验渠道提供个人材料，不要在AI对话里发送身份证号等信息。"
    ),
    "refund": (
        "退款需要人工结合订单和适用业务规则核实，小贝无法直接办理或承诺退款结果。\n\n" + CONTACT_REPLY
        + "\n\n联系时请说明购买情况和退款诉求。"
    ),
    "data_source": (
        "目前无法核实各项数据的具体提供方、更新周期和授权情况。"
        f"您可以查看该模块的来源说明；需要进一步确认时，可拨打 {HOTLINE} 联系人工核实。"
    ),
    "loan": (
        "仅凭这份报告无法判断能否获得贷款，也不能保证下款。"
        "具体申请结果和条件请向申请的贷款机构核实；小贝可以帮您解读报告中的申请、逾期和借贷记录。"
    ),
    "score_vs_loan": (
        "报告评分不等于贷款审批结果，也无法说明某次申请未通过的具体原因。"
        "请向申请的贷款机构核实该次申请的结果和要求。"
    ),
    "application_frequency": (
        "目前没有可据以判断的统一申请间隔或次数标准，也不能承诺间隔多久就不影响申请。"
        "具体要求请向准备申请的机构确认。"
    ),
    "identity": (
        "小贝不会通过外部AI读取或展示您的姓名、身份证号等个人信息，"
        "这不代表报告中没有这些字段。您可以在本人报告页面核实，"
        "或在本地输入 /find 姓名、/find 身份证 查找已登记字段。请不要把证件号码发到AI对话中。"
    ),
    "report_list": (
        "当前对话只绑定已选中的这份报告，小贝不能据此确定您名下共有多少份报告。"
        "在业务报告模式下，可输入 /orders 重新查看可选报告；"
        f"也可以拨打 {HOTLINE} 请人工协助核实。"
    ),
    "attention": (
        "您想查询报告中名为“关注内容”的栏目，还是让我总结这份报告需要留意的地方？"
        "查询栏目可输入 /find 关注内容；整体解读可说“分析我的报告”。"
    ),
}

# 只匹配完整常见表达，避免把“你好，分析报告”等复合问题截取成问候；其余由模型理解。
LOCAL_SERVICE_PATTERNS = {
    "thanks": r"(?:谢谢(?:你|您)?|多谢|感谢|辛苦了)(?:这次(?:我)?明白了|我明白了|明白了|懂了|清楚了)?(?:啦|哈|哦)?",
    "greeting": r"(?:你好|您好|哈喽|hello|hi|小贝你好|你好小贝)",
    "human": r"(?:人工|人工客服|转人工|联系人工|我要人工|找人工|客服电话|客服联系方式)",
    "appeal": r"(?:我要|我想|怎么|如何|我要怎么|我想要)?(?:申诉|投诉)(?:呢|啊|呀|吗)?",
    "refund": r"(?:我能|可以|我要|我想|能不能|怎么|如何)?(?:退款|退费)(?:吗|么|呢)?",
    "data_source": r"(?:你|你们|你的|你们的|报告的|报告)?数据(?:是)?(?:哪里来的|哪来的|从哪里来|来源是什么)",
    "loan": r"(?:我能|我可以|我能不能|我可不可以)(?:贷款|贷到款)(?:吗|么|呢)?",
    "score_vs_loan": r"(?:我|我的)?(?:分数|评分)(?:这么高|很高|高)(?:为什么|为啥)(?:贷款贷不下来|贷不下来|贷不了款)",
    "application_frequency": r"(?:银行和非银行|银行和非银|银行|非银行|非银)?申请(?:多久申请一次|多久一次|多少次)(?:比较)?(?:正常|合适)(?:呢|吗)?",
    "identity": r"(?:我|我的|查看我的|看看我的)?(?:名字|姓名|身份证|身份证号|姓名身份证|名字身份证)(?:是什么|是多少|呢)?",
    "report_list": r"(?:我|我的|我名下)(?:有哪些|有几份|有多少份|有什么)报告",
    "attention": r"(?:我|我的|报告的)?关注内容(?:是什么|有哪些|呢)?",
}


def local_service_topic(question):
    """完整匹配本地常见客服意图，返回封闭主题或None；不提取、回显或外发任何原文。"""
    text = re.sub(r"[\s，,。.!！?？、：:]", "", normalized(question)).casefold()
    return next((topic for topic, pattern in LOCAL_SERVICE_PATTERNS.items() if re.fullmatch(pattern, text)), None)


def service_reply(topic):
    """仅按封闭主题返回固定知识；未知主题拒绝，避免模型注入任意业务事实。"""
    if type(topic) is not str or topic not in SERVICE_REPLIES:
        raise ValueError("未知客服主题。")
    return SERVICE_REPLIES[topic]


def service_replies(topics):
    """组合已验证的多个客服主题，保留办理边界，热线联系方式只显示一次。

    单主题继续返回原固定文案，保持现有调用契约；不允许模型传入自定义答复。
    """
    if (not isinstance(topics, (list, tuple)) or not 1 <= len(topics) <= 3
            or not all(type(topic) is str and topic in SERVICE_REPLIES for topic in topics)
            or len(set(topics)) != len(topics)):
        raise ValueError('客服主题列表无效。')
    if len(topics) == 1:
        return service_reply(topics[0])
    # 退款/申诉本身已包含完整人工联系方式，无需再重复一段“转人工”引导。
    if 'human' in topics and any(topic in topics for topic in ('appeal', 'refund')):
        topics = [topic for topic in topics if topic != 'human']
        if len(topics) == 1:
            return service_reply(topics[0])
    parts, contact_shown = [], False
    full_contact = any(CONTACT_REPLY in service_reply(topic) for topic in topics)
    for topic in topics:
        text = service_reply(topic)
        # 来源和报告列表还含行内热线：其他主题已提供联系渠道时，只压缩这句固定引导。
        # 不删除业务边界，不改写模型文本；来源单问继续保留原固定回复。
        if topic == 'data_source' and any(HOTLINE in service_reply(other) for other in topics if other != topic):
            text = text.replace(f'需要进一步确认时，可拨打 {HOTLINE} 联系人工核实。',
                                '需要进一步确认时，可联系人工核实。')
        if topic == 'report_list' and full_contact:
            text = text.replace(f'也可以拨打 {HOTLINE} 请人工协助核实。', '也可以请人工协助核实。')
        if CONTACT_REPLY in text:
            if contact_shown:
                text = text.replace(CONTACT_REPLY, '').replace('\n\n\n\n', '\n\n')
            else:
                contact_shown = True
        parts.append(text.strip())
    return '\n\n'.join(parts)
