"""按当前报告目录位置绑定模块解读范围；不读取原值，不允许模型传入业务标识。"""

from dataclasses import dataclass, field
import re

from report_assistant.conversation.questions import normalize
from report_assistant.security.privacy import PrivacyError
from report_assistant.security.text import normalized


_NUMBER = r'(?:[+-]?\d{1,12}|[零一二两三四五六七八九十百千]{1,8})'
_PREFIX = r'(?:请|麻烦)?(?:帮我|给我|我想)?(?:用通俗的话|简单|详细|分别)?(?:分析|解读|总结|解释|看看|看)(?:一下|下)?(?:(?:当前|这份|我的|本|该)?报告(?:中|里|的)?)?'
_MODULE_UNIT = r'(?:个|项)?(?:模块|栏目)(?:的(?:内容|情况|结果|数据)|内容)?'
_UNIT = _MODULE_UNIT + r'(?:呢|吧)?'
_RANGE_BODY = r'第?(?P<start>' + _NUMBER + r')(?:个)?(?:到|至|[-~～])第?(?P<end>' + _NUMBER + r')'
_ORDINAL_BODY = r'第(?P<index>' + _NUMBER + r')'
_EDGE_BODY = r'(?P<edge>前面?|最前面?|后面?|最后)(?:的)?(?P<count>' + _NUMBER + r')'
_RANGE = re.compile(_PREFIX + _RANGE_BODY + _UNIT)
_ORDINAL = re.compile(_PREFIX + _ORDINAL_BODY + _UNIT)
_EDGE = re.compile(_PREFIX + _EDGE_BODY + _UNIT)
# 倒装与位置追问仍须完整命中有限句式，避免只看见“前三个”就吞掉同句其他诉求。
_POST_PREFIX = r'(?:请|麻烦|我想|想)?(?:帮我|给我)?(?:把|将)?(?:(?:当前|这份|我的|本|该)?报告(?:中|里|的)?)?'
_POST_SUFFIX = r'(?:分别)?(?:分析|解读|总结|解释|看看|看)(?:一下|下)?(?:呢|吧)?|(?:分别)?(?:怎么样|情况如何|是什么情况|什么情况|有哪些问题|有什么问题|有什么值得关注)|呢|吧'
_RANGE_POST = re.compile(_POST_PREFIX + _RANGE_BODY + _MODULE_UNIT + '(?:' + _POST_SUFFIX + ')')
_ORDINAL_POST = re.compile(_POST_PREFIX + _ORDINAL_BODY + _MODULE_UNIT + '(?:' + _POST_SUFFIX + ')')
_EDGE_POST = re.compile(_POST_PREFIX + _EDGE_BODY + _MODULE_UNIT + '(?:' + _POST_SUFFIX + ')')
# “这些模块”只承接上一轮实际展示的目录范围；完整句式以外不能猜为整份报告。
_REFERENCE = r'(?:这些|上述|这几个|那几个|刚才(?:提到|列出)的|前面(?:提到|列出)的|上面(?:提到|列出)的)(?:模块|栏目)'
_REFERENCE_ACTION = re.compile(_PREFIX + _REFERENCE + r'(?:呢|吧)?')
_REFERENCE_POST = re.compile(_POST_PREFIX + _REFERENCE + '(?:' + _POST_SUFFIX + ')')
_REFERENCE_HINT = re.compile(_REFERENCE)
# 不能解析的位置表达只澄清，不回到语义模型去猜全报告范围；长数字也要捕捉。
_HINT = re.compile(r'(?:前面?|最前面?|后面?|最后|第)(?:的)?(?:[+-]?\d+|[零一二两三四五六七八九十百千]{1,20})(?:个|项)?(?:模块|栏目)')
_SPLIT = re.compile(r'[，,。；;！？!?\n]+|(?:然后|并且|并|再)(?=请|帮我|分析|解读|查|看|怎么|如何|联系)')
_MAX_PREVIEW_MODULES = 8


@dataclass(frozen=True)
class ModuleSelection:
    """位置选择结果；空ids配error表示匹配到无效范围，不能回到全报告分析。"""

    module_ids: tuple = ()
    matched: bool = False
    error: str = ''
    remainder: str = field(default='', repr=False)


def _integer(text):
    """支持阿拉伯数及一至九十九的常用中文数；未知大数不猜，交给范围澄清。"""
    if text.isascii() and text.isdigit():
        return int(text)
    digits = {char: index for index, char in enumerate('零一二三四五六七八九')}
    digits['两'] = 2
    if len(text) == 1:
        return 10 if text == '十' else digits.get(text)
    if text.count('十') == 1:
        high, low = text.split('十')
        if (not high or high in digits) and (not low or low in digits):
            return digits.get(high, 1) * 10 + digits.get(low, 0)
    return None


def select_modules(question, tools, previous_module_ids=None):
    """完整匹配位置或上轮模块指代并绑定当前目录；无可靠前文时只澄清。"""
    modules, positions, remaining, matched = tools.current_modules(), set(), [], False
    for raw in _SPLIT.split(normalized(question)):
        text = normalize(raw)
        if not text:
            continue
        if _REFERENCE_ACTION.fullmatch(text) or _REFERENCE_POST.fullmatch(text):
            matched = True
            allowed = {module['module_id'] for module in modules}
            # 前文范围只能由会话本地提交；模型、旧报告或无效ID不能借“这些”扩大权限。
            if (not isinstance(previous_module_ids, (tuple, list)) or not previous_module_ids
                    or any(type(value) not in (int, str) or value not in allowed for value in previous_module_ids)
                    or len(set(previous_module_ids)) != len(previous_module_ids)):
                return ModuleSelection(matched=True, error='请先说明要解读哪些模块；刚才没有可确定的模块范围。')
            positions.update(index for index, module in enumerate(modules)
                             if module['module_id'] in previous_module_ids)
            continue
        match = (_RANGE.fullmatch(text) or _ORDINAL.fullmatch(text) or _EDGE.fullmatch(text)
                 or _RANGE_POST.fullmatch(text) or _ORDINAL_POST.fullmatch(text) or _EDGE_POST.fullmatch(text))
        if match is None:
            if ((_HINT.search(text) or _REFERENCE_HINT.search(text))
                    and not re.match(r'^(?:不要|不用|不需要|别|我不想|我不要)', text)):
                return ModuleSelection(matched=True, error='请按当前模块目录说明要解读的前几个、后几个或具体位置，避免分析到其他模块。')
            remaining.append(raw.strip())
            continue
        matched = True
        values = match.groupdict()
        if 'start' in values:
            first, last = _integer(values['start']), _integer(values['end'])
        elif 'index' in values:
            first = last = _integer(values['index'])
        else:
            count = _integer(values['count'])
            first, last = ((1, count) if values['edge'].startswith(('前', '最前'))
                           else (len(modules) - count + 1, len(modules))) if count is not None else (None, None)
        if first is None or last is None or not 1 <= first <= last <= len(modules):
            return ModuleSelection(matched=True, error=(f'这份报告当前有{len(modules)}个模块，请按目录中实际存在的位置指定解读范围。'))
        positions.update(range(first - 1, last))
    ids = tuple(module['module_id'] for index, module in enumerate(modules) if index in positions)
    return ModuleSelection(ids, matched, remainder='，'.join(remaining))


def selected_module_fallback(tools, projection, selection, *, on_degradation=None):
    """模型失败后限量预览已核实结果；仅把固定降级类别交给维护诊断。"""
    selected = set(selection.module_ids)
    modules = [module for module in tools.current_modules() if module['module_id'] in selected]
    degradations = set()
    lead = ('所选模块的分析暂未完成，先列出每个所选模块最多3项可核实的展示结果：'
            if len(modules) <= _MAX_PREVIEW_MODULES else
            f'所选模块的分析暂未完成，先预览前{_MAX_PREVIEW_MODULES}个所选模块，每个最多3项可核实的展示结果：')
    parts = [lead]
    # 全目录指代可能覆盖很多模块；失败回退有独立展示上限，不因模型失败倾倒全部字段。
    for module in modules[:_MAX_PREVIEW_MODULES]:
        name = projection.guard.label(module['name']) or '名称暂无法确认的模块'
        fields = [item['local'] for item in projection.fields.values()
                  if item['local']['module_id'] == module['module_id']][:3]
        if not fields:
            answer = '该模块暂没有可用于自动解读的内容。'
            degradations.add('fallback_no_fields')
        else:
            try:
                answer = projection.customer_answer(
                    fields, on_structured=lambda: degradations.add('fallback_structured_value'))
            except PrivacyError:
                answer = '该模块的展示结果暂无法确认。'
                degradations.add('fallback_projection_rejected')
        parts.append(f'**{name}**\n{answer}')
    if len(modules) > _MAX_PREVIEW_MODULES:
        parts.append(f'其余{len(modules) - _MAX_PREVIEW_MODULES}个所选模块本次未展示；这不代表它们没有数据。')
        degradations.add('fallback_preview_limit')
    # 诊断写入失败应阻止本轮提交；每类每轮只记一次，避免字段数放大日志量。
    if on_degradation is not None:
        for reason in sorted(degradations):
            on_degradation(reason)
    return ('【演示数据】\n' if tools.is_demo else '') + '\n\n'.join(parts)
