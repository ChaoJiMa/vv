"""当前报告目录的本地意图与输出；不读取报告值、不调用模型、不扩大业务权限。"""

from dataclasses import dataclass, field
import re

from report_assistant.conversation.questions import is_report_overview, normalize
from report_assistant.security.text import normalized
from report_assistant.reports.tools import time_windows


_COURTESY = r'(?:(?:请|麻烦|帮我|告诉我|列出|列一下|看看|看下|先|小贝|你好|您好|我想知道|我想了解))*'
_SUBJECT = r'(?:(?:目前|现在|当前)?(?:这份|我的|这个|该|本)?报告(?:里|中|内)?(?:的)?|目前|现在|当前)?'
_CATALOG = re.compile(_COURTESY + _SUBJECT + r'(?:一共|总共)?(?:都)?(?:'
                      r'有(?:哪些|什么|多少个|几个)(?:模块|栏目|内容)|'
                      r'包含(?:哪些|什么)(?:模块|栏目|内容)|'
                      r'(?:模块|栏目)(?:列表|目录|有哪些|有什么|有几个)|'
                      r'(?:能|可以)(?:查|查询|看)(?:什么|哪些内容|哪些模块)|'
                      r'列出(?:所有|全部)?(?:模块|栏目))' + r'(?:呢|吗|吧|一下)?')
_DIRECT_LIST = re.compile(r'(?:请|麻烦)?(?:帮我|给我)?(?:列出|列一下|列)'
                          + _SUBJECT + r'(?:所有|全部)?(?:模块|栏目)(?:呢|吗|吧)?')
# “和风险”仍属于未知完整诉求；只在连接词后跟明确动作或客服问句时拆开。
_SPLIT = re.compile(r'[，,。；;！？!?\n]+|(?:并且|然后|同时|以及|并|再|和)'
                    r'(?=帮我|请|分析|解读|总结|查|看|解释|联系|怎么|如何|'
                    r'(?:人工)?客服(?:几点|什么|电话|邮箱|工作|服务|怎么|如何)|'
                    r'(?:退款|退费)(?:怎么|如何|能不能|是否|可以吗))')
_LINK = re.compile(r'^(?:并且|然后|同时|以及|并|再|另外|还有)')
_NUMBER = r'(?:[+-]?\d{1,12}|[零一二两三四五六七八九十百千]{1,8})'
_ELLIPTIC_POSITION = re.compile(r'(?:请|麻烦)?(?:帮我|给我)?(?:分析|解读|总结|解释|看看|看)'
                                r'(?:一下|下)?(?:前面?|最前面?|后面?|最后)(?:的)?'
                                + _NUMBER + r'(?:个|项)?')


@dataclass(frozen=True)
class CatalogRequest:
    """是否需列目录及剩余完整诉求；repr不展示原始问题。"""

    question: str = field(repr=False)
    listing: bool = False


def split_catalog_request(question):
    """只消费完整目录分句；未知或附加分析不能因关键词命中而被截断。"""
    parts, remaining, listing = _SPLIT.split(normalized(question)), [], False
    for part in parts:
        part = _LINK.sub('', part.strip())
        if not part:
            continue
        if _CATALOG.fullmatch(normalize(part)) or _DIRECT_LIST.fullmatch(normalize(part)):
            listing = True
        else:
            remaining.append(part)
    if listing:
        # 仅当同句已明确要目录时，“分析前三个”才可指向该目录的模块；
        # 带“字段/人员”等其他对象或未闭合片段保留原文，不推断整份报告范围。
        remaining = [part + '模块' if _ELLIPTIC_POSITION.fullmatch(normalize(part)) else part
                     for part in remaining]
        return CatalogRequest('，'.join(remaining), True)
    return CatalogRequest(question)


def catalog_answer(tools, guard):
    """按报告模板顺序列全部启用模块，名称经当前会话守卫，不暗示已读业务结果。"""
    modules = tools.current_modules()
    if not modules:
        answer = '这份报告当前没有可列出的模块。'
    else:
        rows = [f'{index}. {guard.label(module["name"]) or "名称暂无法确认的模块"}'
                for index, module in enumerate(modules, 1)]
        answer = f'这份报告当前有{len(modules)}个模块：\n' + '\n'.join(rows)
    return ('【演示数据】\n' if tools.is_demo else '') + answer


def explicitly_requests_overview(question):
    """整体解读可附关注指标；“报告中的某项”不因此获得全报告范围。"""
    for part in _SPLIT.split(normalized(question)):
        text = normalize(_LINK.sub('', part.strip()))
        if is_report_overview(text):
            return True
        if re.match(r'^(?:请|麻烦)?(?:帮我|给我)?(?:整体|全面|综合|按模块)'
                    r'(?:分析|解读|总结|概括)(?:一下|下)?(?:我的|这份|当前|该)?'
                    r'(?:整份|整个|全部)?(?:信用)?报告(?=重点|尤其|并重点|$)', text):
            return True
    return False


_FAILURE_OPEN = re.compile(r'整体|总体|综合|整份|全部|所有|每个模块|各个模块|各模块|哪些方面|值得关注|需要注意|报告情况|'
                           r'为什么|为何|什么意思|含义|怎么理解|如何理解|解释|总结|解读|比较|对比|风险怎么样|好不好|怎么样')
_FAILURE_VALUE_END = re.compile(r'(?:是多少|是什么|有多少|有几(?:次|家|条|个)|几次|几家|几条|第几档|多久|多长时间|'
                                r'显示什么|结果是什么|状态是什么|哪天|哪年|哪家|几分|能查到吗|查得到吗)(?:呢|吗)?$')
_FAILURE_WINDOW_FOLLOWUP = re.compile(r'(?:那|那么)?(?:最近|过去|近)?(?:\d+|十二|十五|一个|[一二两三六七半])'
                                      r'(?:个月|天|周|月|年)(?:的)?(?:呢|是多少|有多少次)?$')
_FAILURE_CALENDAR = re.compile(r'上个?月|去年|今年|本月|这个月|上周|本周|\d{4}[-/年]\d{1,2}')
_FAILURE_CALENDAR_FOLLOWUP = re.compile(r'(?:那|那么)?(?:上个?月|去年|今年|本月|这个月|上周|本周)(?:呢|是多少)?')
_FAILURE_VALUE_ANY = re.compile(r'是多少|是什么|有多少|有几(?:次|家|条|个)|几次|几家|几条|第几档|多久|多长时间')
_FAILURE_INFERENCE = re.compile(r'(?:那|那么)(?:是不是|是否)(?:就)?(?:等于|说明|代表)'
                                r'(?:没有申请|没有记录|从没申请过|无风险|没有逾期)(?:呢|吗)?')
_FAILURE_REPORT_HINT = re.compile(r'申请|机构|分数|评分|指数|逾期|结清|借贷|贷款|查询|在网|运营商|收入|婚姻|学历|'
                                  r'姓名|证件|身份证|地址|手机|案件|涉诉|失信|车辆|房产|公积金|企业|风险')


def permits_failure_lookup(question):
    """只允许单项查值或周期追问尝试本地匹配；开放分析失败不能退化成指标回答。"""
    text = normalize(question)
    if _FAILURE_OPEN.search(text):
        return False
    if (_FAILURE_WINDOW_FOLLOWUP.fullmatch(text) or _FAILURE_CALENDAR_FOLLOWUP.fullmatch(text)
            or _FAILURE_INFERENCE.fullmatch(text)):
        return True
    if not _FAILURE_REPORT_HINT.search(text):
        return False
    period_question = ((_FAILURE_CALENDAR.search(text) or len(time_windows(text)) > 1)
                       and _FAILURE_VALUE_ANY.search(text))
    return bool(_FAILURE_VALUE_END.search(text) or period_question)


def permits_single_field_failure_answer(question, field):
    """本地唯一候选还须消费整句封闭查值语法；不能漏掉同句第二个指标。"""
    text, name = normalize(question), normalize(field.get('name', ''))
    aliases = {name} if len(name) >= 2 else set()
    if re.search(r'分析指数|风险指数|评分|分数|总分', name):
        aliases.update(('分析指数', '风险指数', '评分', '分数', '得分'))
    prefix = r'(?:(?:请|麻烦|帮我|给我|告诉我|查一下|查|看看|看一下|看下|帮我看下|我想知道|当前|这份报告的|当前报告的|我的报告的|本报告的|这份报告|我的报告|本报告|报告里|报告中|报告的|报告|我的|我|这项|这个))*'
    for alias in aliases:
        if re.fullmatch(prefix + re.escape(alias) + r'(?:的)?' + _FAILURE_VALUE_END.pattern, text):
            return True
    return False


def permits_single_field_availability(question):
    """只识别是否能查到的封闭问法；字段和完整分句仍由目标账本另行证明。"""
    return bool(re.search(r'(?:能查到吗|查得到吗)$', normalize(question)))
