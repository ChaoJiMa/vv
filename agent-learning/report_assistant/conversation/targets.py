"""本轮高置信诉求账本：只校对元数据与已读事实，不读取报告值或执行网络请求。

这是模型路由的独立交叉检查，不是新的通用语义路由器。无法唯一绑定的表达
继续交给既有模型；只对明确的指标、周期及客服主题补齐遗漏，不猜数值或政策。
"""

import re
from report_assistant.conversation.wording import metric_unit

from report_assistant.security.answer_validation import answer_numeric_content
from report_assistant.security.text import normalized
from report_assistant.conversation.questions import normalize
from report_assistant.reports.score import score_family
from report_assistant.conversation.service import local_service_topic
from report_assistant.conversation.data_policy import excluded_personal_clause, declared_personal_clause, personal_target_text
from report_assistant.reports.tools import field_matches_window, time_windows


# 规则描述业务意图，不包含题库ID、结果数字或具体报告路径。
_SERVICE = {
    'human': r'(?:怎么|如何|要怎么)?联系(?:人工|真人)(?:客服|工作人员)?|(?:把)?(?:真人|人工)(?:客服|工作人员)?联系方式(?:给我)?|找人工工作人员要怎么联系|人工热线和邮箱是什么',
    'appeal': r'(?:报告)?(?:数据|记录|结果).{0,12}(?:异议|错误|不对).{0,12}(?:申诉|投诉|渠道|找谁)|有一条记录不对如何提出异议|想投诉报告中的错误该找谁|对报告结果提出异议有什么渠道',
    'refund': r'(?:买错报告)?如何咨询退款|想把购买费用退回该联系谁|退款申请要找谁核实|退费的事怎么跟人工沟通|(?:怎么|如何|能否|我想|我要|可以)?(?:退款|退费)(?:吗|呢|怎么办)?',
    'data_source': r'数据提供方和更新周期能确认吗|这些信息从哪来多久更新一次|能不能核实报告数据的来源|各模块数据来源由谁核实|(?:这些信息|报告数据|数据)(?:到底)?(?:从哪里来|从哪来|来源是什么|由谁提供)(?:多久更新一次)?',
    'loan': r'凭这份报告能保证贷款通过吗|我现在能不能贷到款|报告能不能保证下款|能不能承诺我申请会获批|(?:我|我现在)?(?:能不能|能否|可以|能)(?:贷到款|贷到钱|贷款|下款)(?:吗|呢)?',
    'score_vs_loan': r'(?:报告)?(?:评分|分数|高分).{0,12}(?:但|可|为什么|为啥).{0,16}(?:没通过|没成功|被拒|贷不下来|贷不了款|申请仍被拒)(?:是什么原因|怎么回事|吗)?',
    'application_frequency': r'两次申请隔多少天才正常|贷款申请多久一次才合适|非银行申请多长时间一次不影响结果|申请间隔有没有统一标准|(?:两次)?(?:贷款|非银行|银行)?申请(?:间隔多久|多久一次|多长时间一次|隔多少天)(?:才)?(?:正常|合适|不影响结果)(?:吗|呢)?',
    'report_list': r'账号下报告总数能查出来吗|名下全部报告一共有几份|能数一下我全部的报告吗|我总共买过几份报告|(?:我|我的|我名下|账号下|我账号下|名下)(?:一共|总共|全部)?(?:有多少份|有几份|有哪些)报告',
}
_SERVICE = {key: re.compile('(?:' + value + ')') for key, value in _SERVICE.items()}
_SPLIT = re.compile(r'[，,；;。！？!?\n]+|另外(?:也)?(?:查一下)?|同时(?:想知道)?|顺带(?:问问)?|还有|以及|再帮我确认|也请说明|第二项是|而是|改查|改看|只查|只看|只说')
_PREFIX = re.compile(r'^(?:请帮我看一下|小贝|查查|我没看明白|想了解|能直接告诉我|麻烦核对|我想确认|请说一下|帮忙解释一下|我比较着急|想知道|刚打开报告|请看|不太懂这一项|想问|帮我看看|帮我|请|麻烦|也)+')
_STYLE = re.compile(r'(?:直接说结果就好|不要讲技术字段|请用一句话说明|按报告实际显示回答|别猜没有的数据|请用好理解的话说|我只想知道这个|不用扩展其他指标|请分别回应|这几件事都说一下|按顺序解释就好|只要结果|别把机构数当成次数|别混用银行和非银行|仍以刚才这份报告为准|按相同指标口径说|缺失就说明无法确认|不要加其他周期|不用复述上一轮结果|先说这一个指标|我接着问|后面我再换个口径问|先确认这一周期的结果|先查这个|稍后再比较|我想先听这个结果|这一项先解释清楚|先给我当前这个数|看懂这项我再继续问)')
_REJECT = re.compile(r'^(?:我|请)?(?:不(?:要|用|想|需要)|别|无需|不是(?:要|想)?)(?:再)?(?:查|查询|看|说|讲|问|解释|介绍|办理|联系)?')
_QUALIFIERS = ('夜间', '白天', '周末', '其他', '传统银行', '消费金融', '汽车金融', '代偿分期')
_UNKNOWN = re.compile(r'未提供|未显示|暂无|缺少|无法确认|没有可确认|空白|未给出')
_TARGET_HINT = re.compile(r'申请|机构数|多少家|几家|次数|档位|第几档|分数|评分|指数|得分|等级|分档|逾期|结清|还清|学历|教育程度|婚姻|结婚|在网|运营商|记录|收入预测|案件编号|案号|查询日期|查询时间|查询日')
_OPEN_REPORT = re.compile(
    r'为什么|为何|含义|什么意思|反推|加起来|比较|对比|(?:能否|是否|能|可以)证明|能说明|是否说明|'
    r'(?:通俗(?:地)?|简单|详细)(?:解释|解读|说|说明)(?:一下|下)?|解释(?:一下|下)?(?:吗|么|呢|$)|'
    r'(?:是否(?:算|属于)?|是不是(?:算|属于)?|算不算(?:是)?|算是?|属于)(?:比较|很|太|偏)?(?:频繁|正常|异常|好|差|高|低|多|少)|'
    r'(?:频繁|正常|异常)(?:吗|么|不|呢|$)|好不好|好坏|正不正常|频不频繁|高不高|低不低|多不多|少不少|'
    r'风险(?:大不大|高不高)|有没有风险|是否有风险|有(?:什么|何)影响|影响大不大|'
    r'意味着什么|代表什么|说明什么|怎么理解|如何理解|怎么看|怎么样|怎么评价|是否有问题|有没有问题|是否存在问题'
)
# 闭合资格是正向语法证明，不把“未命中开放关键词”等同于闭合。数字只能作为
# 与该分句目标登记窗口一致的周期出现，不把用户自带结果数字当作可信答案。
_CLOSED_PERIOD = re.compile(r'(?:最近|过去|近)?(?:\d+|十二|十五|一个|[一二两三六七半])'
                            r'(?:个月|天|周(?!期)|月|年(?!级|度|份|代))')
_CLOSED_PREAMBLE = re.compile(r'(?:小贝|我比较着急|我没看明白|不太懂这一项|刚打开报告|想知道|想了解)')
_CLOSED_GRAMMAR = re.compile(
    r'(?:请帮我看一下|能直接告诉我|麻烦核对|我想确认|请说一下|我想知道|想了解|想知道|'
    r'请看|查一下|查查|看一下|看看|帮我看看|帮我|告诉我|给我|查询|核对|查|看|请|麻烦|小贝|'
    r'这份报告|当前报告|报告|本报告|当前|这份|我的|我|该|这个|这项|这一项|那一项|这一栏|那一栏|'
    r'实际显示|显示的|展示的|显示|展示|登记的|列出的|中的|里的|这边|里面|里|中|上|的|'
    r'分别|一共|总共|结果|状态|范围|区间|数量|信息|名称|所属|对应|及|和|与|也|都|'
    r'是多少|是什么|有多少|有几家|有几次|有几条|有多少家|有多少次|有多少条|'
    r'多少|多久|多长时间|几个月|几年|几家|几次|几条|第几档|哪家|哪个|什么|是|为|有|一下|吗|呢|就好)*'
)


def _closed_aliases(item, tools):
    """只为已绑定目标生成受控结果名称，不新增引用、业务概念或数据访问权限。"""
    name = normalize(item['public']['name'])
    aliases = {name}
    if signature := _field_application(item):
        entity, metric, qualifiers = signature
        subject = ('非银行' if entity == 'nonbank' else '银行') + ''.join(qualifiers)
        nouns = {
            'count': ('申请次数', '申请总次数', '申请了几次', '申请几次', '申请了多少次', '申请了几回', '申请数'),
            'orgs': ('申请机构数', '申请机构数量', '申请涉及几家机构', '申请涉及几家', '申请过几家', '申请涉及的机构数量', '机构数', '机构数量'),
            'band': ('申请档位', '显示第几档', '申请处于第几档', '申请显示的档位', '申请显示第几档', '第几档'),
        }[metric]
        aliases.update(subject + noun for noun in nouns)
        aliases.update(nouns)
    if score_family(item['local'], tools.theme):
        aliases.update(('报告分数和等级', '报告评分及所属等级', '分析指数和对应等级', '报告展示分数及分档',
                        '报告分数', '分数', '评分', '分析指数', '风险指数', '得分', '等级', '分档'))
    if '逾期' in name:
        aliases.update(('逾期记录数', '有几条逾期记录', '逾期条数', '逾期数量', '登记的逾期数量'))
    if '未结清' in name:
        aliases.update(('未结清余额范围', '尚未结清的金额范围', '还没还清的余额区间', '还没结清的余额区间',
                        '未结清余额显示的区间', '未结清余额', '未结清金额区间', '未结清金额的页面区间',
                        '未结清金额这一项的范围', '借贷模块展示的未结清金额范围'))
    if re.search(r'在网时长|在网时间', name):
        aliases.update(('手机在网时长', '手机在网时间', '手机在网多久', '手机入网时长', '手机入网时间',
                        '手机号在网时长', '手机号码在网时长', '手机号在网时间', '手机号码在网时间',
                        '在网时长', '在网时间', '在网多久'))
    if '运营商' in name:
        aliases.update(('手机运营商', '手机在网模块的运营商信息', '运营商信息', '运营商名称', '运营商'))
    if '收入预测' in name:
        aliases.update(('收入预测范围', '报告显示的收入预测', '报告概览中的收入预测区间', '收入预测这一栏的结果', '收入预测'))
    if '记录时间' in name:
        aliases.update(('最近一次记录时间范围', '最近一次记录距今多久', '最近记录距今的时间档位',
                        '最近记录的时间区间', '最近一次记录时间', '最近记录时间'))
    if '查询日期' in name:
        aliases.update(('报告查询日期', '报告查询时间', '报告概览里的查询日期', '报告标注的查询日', '查询日期', '查询时间', '查询日'))
    if re.search(r'案件编号|案号', name):
        aliases.update(('案件编号', '案件记录里的编号', '案件记录中的各项编号', '报告中列出的案号', '案号'))
    if '学历' in name:
        aliases.update(('报告里的学历', '学历这一栏的结果', '这份报告登记的学历信息', '教育程度', '学历信息', '学历'))
    if '婚姻' in name:
        aliases.update(('婚姻登记结果', '婚姻登记状态', '婚姻登记这一栏的显示结果', '婚姻状态'))
    return {normalize(alias) for alias in aliases if alias}


def _parts(question):
    """按显式并列和标点分片；只移除已知礼貌/格式短语，不吞掉未知实质问句。"""
    result = []
    for raw in _SPLIT.split(normalized(question)):
        text = normalize(raw)
        if _STYLE.fullmatch(text):
            continue
        text = _PREFIX.sub('', text)
        if not text or _STYLE.fullmatch(text) or _REJECT.match(text):
            continue
        result.append(text)
    return result


def _application(text):
    """提取明确的申请口径；无实体/指标时不补猜，追问由上一唯一字段补齐。"""
    entities = []
    if '非银行' in text:
        entities.append('nonbank')
    if '银行' in text.replace('非银行', ''):
        entities.append('bank')
    found = []
    for metric, pattern in (('orgs', r'机构数|机构数量|涉及几家|多少家|几家|家银行'),
                            ('band', r'档位|第几档'),
                            ('count', r'次数|多少次|几次|几回|申请数|申请总数')):
        match = re.search(pattern, text)
        if match:
            found.append((match.start(), metric))
    metrics = [metric for _, metric in sorted(found)]
    return entities, metrics, tuple(q for q in _QUALIFIERS if q in text)


def _field_application(item):
    """从当前字段公开名称和模块判断申请指标，不依据路径名或结果值推断。"""
    public = item['public']
    text = normalize(public['name'])
    module = normalize(item['local'].get('module_name', ''))
    if '申请' not in text:
        return None
    entities, metrics, qualifiers = _application(text + module)
    if len(entities) != 1 or len(metrics) != 1:
        return None
    return entities[0], metrics[0], qualifiers


def _fact_map(facts):
    """兼容工具事实列表和会话内部引用字典，不修改调用方数据。"""
    if isinstance(facts, dict):
        return facts
    if isinstance(facts, list):
        return {fact['field_ref']: fact for fact in facts if isinstance(fact, dict) and 'field_ref' in fact}
    return {}


def _leaves(value):
    """只展开已过滤的取值包装；不把present、路径或对象键解释成客户业务结果。"""
    if isinstance(value, str):
        return [value] if value else []
    if type(value) in (int, float):
        return [str(value)]
    if isinstance(value, list):
        return list(dict.fromkeys(part for item in value for part in _leaves(item)))
    if isinstance(value, dict) and 'present' in value and set(value) <= {'present', 'value'}:
        return _leaves(value.get('value')) if value['present'] else []
    return []


class QuestionTargets:
    """构造本轮高置信目标，不读取数据；未知/歧义目标仍交给原模型流程。

    question 必须先经过既有隐私检查，projection 必须属于 tools 当前报告。
    previous 仅用于明确追问，且须有唯一有效字段；不恢复完整历史或旧答案。
    """

    def __init__(self, question, tools, projection, previous=None):
        self.question, self.tools, self.projection = question, tools, projection
        self.report_refs, self.service_topics = [], []
        self.ambiguous = False
        self._recognized = False
        parts = _parts(question)
        report_parts = []
        only_service = bool(parts)
        for text in parts:
            if projection.guard.allow_personal and (excluded_personal_clause(text) or declared_personal_clause(text)):
                continue
            local = local_service_topic(text)
            if local == 'identity' and projection.guard.allow_personal:
                local = None
            topics = [local] if local and local != 'attention' else [topic for topic, pattern in _SERVICE.items() if pattern.fullmatch(text)]
            if topics:
                for topic in topics:
                    if topic not in self.service_topics:
                        self.service_topics.append(topic)
                continue
            only_service = False
            report_parts.append(text)
            self._match_report(text, previous)
        # 这是本地已核实意图集合，不受单次模型路由的3主题上限截断；调用方仅
        # 组合封闭固定知识，模型路由上限不变。未知实质片段仍使service_only保持False。
        if self.report_refs and _OPEN_REPORT.search(''.join(report_parts)):
            # 已知字段仍可补读，但仅列事实不能替代用户的解释、比较或推断诉求。
            self.ambiguous = True
        self.has_report_targets = bool(self.report_refs)
        self.service_only = only_service and not self.ambiguous and bool(self.service_topics)

    def is_closed_result_query(self):
        """正向证明全部报告分句只是已绑定指标的值/状态查询；不读取事实。

        别名和周期消费后必须只剩封闭问值语法，且每个分句和每个已绑定引用均有
        对应。原始“解释一下”等意图不会因_parts移除礼貌前缀而获得闭合资格。
        未覆盖的合法复杂表达保守返回False，由调用方保留原语义处理。
        """
        if self.ambiguous or not self.report_refs:
            return False
        owners = {}
        for ref in self.report_refs:
            for alias in _closed_aliases(self.projection.fields[ref], self.tools):
                owners.setdefault(alias, set()).add(ref)
        if not owners:
            return False
        pattern = re.compile('|'.join(re.escape(alias) for alias in sorted(owners, key=len, reverse=True)))
        covered, report_parts = set(), 0
        for raw in _SPLIT.split(normalized(self.question)):
            text = normalize(raw)
            if not text or _STYLE.fullmatch(text) or _CLOSED_PREAMBLE.fullmatch(text):
                continue
            stripped = _PREFIX.sub('', text)
            local = local_service_topic(stripped)
            if local and local != 'attention' or any(p.fullmatch(stripped) for p in _SERVICE.values()):
                continue
            periods = []

            def remove_period(match):
                periods.extend(time_windows(match.group()))
                return ''

            remaining = _CLOSED_PERIOD.sub(remove_period, text.replace('近一季', '近3个月'))
            matched = set()

            def remove_target(match):
                matched.update(owners[match.group()])
                return ''

            remaining = pattern.sub(remove_target, remaining)
            if not matched or not _CLOSED_GRAMMAR.fullmatch(remaining):
                return False
            allowed_periods = {window for ref in matched
                               for window in time_windows(self.projection.fields[ref]['public']['window'])}
            if not set(periods) <= allowed_periods:
                return False
            covered.update(matched)
            report_parts += 1
        return bool(report_parts) and set(self.report_refs) <= covered

    def _add(self, candidates):
        """只登记唯一候选；同名同周期多模块时不任选一个，不静默展开所有候选。"""
        self._recognized = True
        if len(candidates) != 1:
            self.ambiguous = True
            return
        if candidates[0] not in self.report_refs:
            self.report_refs.append(candidates[0])

    def _match_report(self, text, previous):
        """按指标语义及当前登记元数据绑定，不按任意金额/数字或宽泛模块推测。"""
        joined_parts = re.split(r'和|(?<!涉)及|与', text)
        for joined in joined_parts if len(joined_parts) > 1 else []:
            # “银行和非银行的申请次数”共享后置指标，单独实体片段并非未知诉求。
            entity_fragment = re.fullmatch(r'(?:(?:最近|过去|近)?(?:\d+|十二|十五|一个|[一二两三六七半])(?:个月|天|周|月|年))?(?:银行|非银行)(?:的)?', joined)
            if joined and not entity_fragment and not _TARGET_HINT.search(joined) and not any(
                    len(normalize(item['public']['name'])) >= 4
                    and normalize(item['public']['name']) in joined for item in self.projection.fields.values()):
                self.ambiguous = True
        if re.search(r'今年|去年|本月|上个?月|这个月|上周|本周|未来|明年|下个?月', text):
            self.ambiguous = True
            return
        entities, metrics, qualifiers = _application(text)
        previous_refs = getattr(previous, 'field_refs', ()) if previous is not None else ()
        prior = self.projection.fields.get(previous_refs[0]) if len(previous_refs) == 1 else None
        prior_signature = _field_application(prior) if prior else None
        follow = bool(re.search(r'^(?:那|那么|同一周期|刚才|这个指标|再看|改成)|同周期', text))
        window_text = text.replace('近一季', '近3个月').replace('同一周期', '').replace('同周期', '')
        windows = time_windows(window_text)
        if follow and prior_signature:
            entities = entities or [prior_signature[0]]
            metrics = metrics or [prior_signature[1]]
            qualifiers = qualifiers or prior_signature[2]
            if not windows:
                windows = time_windows(prior['public']['window'])
        matched_application = False
        if entities and metrics and ('申请' in text or follow or metrics == ['band']):
            # 多实体又多口径时不能做笛卡尔积，否则会强加用户没问的指标。
            if len(metrics) > 1 and (len(entities) > 1 or len(windows) > 1):
                self.ambiguous = True
                return
            for entity in entities:
                for metric in metrics:
                    for window in windows or ['unspecified']:
                        candidates = [ref for ref, item in self.projection.fields.items()
                                      if _field_application(item) == (entity, metric, qualifiers)
                                      and field_matches_window(item['local'], window)]
                        self._add(candidates)
            # 同一句仍可能并列学历、余额等其他类型，不能命中申请后就提前收尾。
            matched_application = True
        selectors = []
        if self.projection.guard.allow_personal:
            # 只在已授权的当前报告目录中补齐个人资料目标，不赋予任意路径访问权。
            personal_text = personal_target_text(text)
            for query, label in ((r'姓名|名字', r'姓名|名字'),
                                 (r'身份证|证件|护照', r'身份证|证件|护照'),
                                 (r'手机号|手机号码|电话号码', r'手机号|手机号码|电话号码'),
                                 (r'住址|地址', r'住址|地址')):
                if re.search(query, personal_text):
                    selectors.append(lambda item, pattern=label: bool(re.search(pattern, item['public']['name'])))
        if re.search(r'分数|评分|分析指数|风险指数|得分|多少分', text):
            selectors.append(lambda item: bool(score_family(item['local'], self.tools.theme)))
        if re.search(r'逾期.{0,12}(?:记录|条|数)|(?:几条|多少条).{0,8}逾期', text):
            selectors.append(lambda item: '逾期' in item['public']['name'] and bool(re.search(r'记录数|条数|数量', item['public']['name'])))
        if re.search(r'未结清|尚未结清|还没(?:还|结)?清', text) and re.search(r'余额|金额|区间|范围|钱', text):
            selectors.append(lambda item: bool(re.search(r'未结清.*(?:余额|金额)|(?:余额|金额).*未结清', item['public']['name'])))
        for query, field in ((r'学历|教育程度', r'学历|教育程度'),
                             (r'婚姻|婚姻登记|结婚', r'婚姻'),
                             (r'在网时长|在网时间|在网多久', r'在网时长|在网时间'),
                             (r'运营商', r'运营商'),
                             (r'记录.{0,10}(?:距今|时间)|最近.{0,5}记录.{0,6}多久', r'记录时间'),
                             (r'收入预测', r'收入预测'),
                             (r'案件编号|案件.{0,8}编号|案号', r'案件编号|案号'),
                             (r'报告.{0,8}查询(?:日期|时间|日)|查询日期', r'报告查询日期')):
            if re.search(query, text):
                selectors.append(lambda item, pattern=field: bool(re.search(pattern, item['public']['name'])))
        if selectors:
            for select in selectors:
                self._add([ref for ref, item in self.projection.fields.items() if select(item)])
            return
        if matched_application:
            return
        # 未登记别名只接受足够具体的完整公开字段名，避免“金额”“状态”机械匹配。
        exact = {}
        for ref, item in self.projection.fields.items():
            name = normalize(item['public']['name'])
            if len(name) >= 4 and name in text:
                exact.setdefault(name, []).append(ref)
        for candidates in exact.values():
            self._add(candidates)
        if not exact:
            # 未识别的实质分句不能因其他分句已命中目标而在本地收尾时被丢弃。
            self.ambiguous = True

    def missing_refs(self, facts):
        """返回本轮尚未读取的高置信目标，不把未查询伪装为missing状态。"""
        available = _fact_map(facts)
        return [ref for ref in self.report_refs if ref not in available]

    def validate_answer(self, sections, facts):
        """能证明逐项展示锚点时返回True；False含未覆盖和无法自动证明两种情况。

        这不是语义错误判决器。尤其ambiguous=True的解释/比较问题，调用方应保留
        已通过原安全检查的模型正文，不因多来源表达无法自动证明而改写为局部事实。
        """
        available = _fact_map(facts)
        if not isinstance(sections, list) or self.missing_refs(available):
            return False
        for ref in self.report_refs:
            cited = [part for part in sections if isinstance(part, dict)
                     and isinstance(part.get('sources'), list) and set(part['sources']) == {ref}
                     and isinstance(part.get('text'), str)]
            if not cited or not any(self._anchored(part['text'], available[ref]) for part in cited):
                return False
        return True

    @staticmethod
    def _anchored(text, fact):
        """只要求来源结果可见，不把区间的合理精度限制误当成整个字段缺失。"""
        if fact.get('status') != 'provided':
            return fact.get('status') in {'missing', 'null', 'empty', 'withheld'} and bool(_UNKNOWN.search(text))
        if re.search(r'未提供|未显示|没(?:有)?查到|查不到|未查到|没有可确认|暂无可确认|(?:无法|不能|不能够)确认(?:具体)?(?:结果|次数|条数|机构数|状态|数值)?(?!精确)', text):
            # “显示区间，但无法确认精确值”是合法边界；“8次无法确认”仍是否认结果。
            limited = re.sub(r'(?:无法|不能)确认(?:具体的?)?(?:精确(?:值|金额|数值|收入|时间)?|准确(?:值|金额|数值|时间))', '', text)
            if re.search(r'未提供|未显示|没(?:有)?查到|查不到|未查到|没有可确认|暂无可确认|(?:无法|不能)确认', limited):
                return False
        value = fact.get('value')
        presentation = fact.get('presentation') or {}
        if 'display_value' in presentation:
            value = presentation['display_value']
        if type(value) in (int, float):
            digits = str(value)
            aliases = [digits]
            if type(value) is int and 0 <= value <= 10:
                aliases.append('零一二三四五六七八九十'[value])
                if value == 2:
                    aliases.append('两')
            unit = '次' if '次数' in fact.get('name', '') else '家' if '机构数' in fact.get('name', '') else '条' if '记录数' in fact.get('name', '') else '档' if '档位' in fact.get('name', '') else ''
            matched = bool(re.search(r'(?<![\d.])(?:' + '|'.join(re.escape(a) for a in aliases) + r')\s*' + unit + r'(?![\d.十百千万亿])', text))
        elif isinstance(value, str):
            # 日期仅等价化完整日期格式；区间可使用同义连接符，但不换算单位。
            compact = re.sub(r'\s|[~～至到—–]', '', normalized(text))
            anchor = re.sub(r'\s|[~～至到—–]', '', normalized(value))
            matched = bool(anchor) and anchor in compact
            dates = answer_numeric_content(value)[2]
            if dates:
                matched = dates <= answer_numeric_content(text)[2]
        else:
            leaves = _leaves(value)
            matched = bool(leaves) and all(leaf in text for leaf in leaves)
        rank = presentation.get('rank')
        return matched and (not rank or rank in text)

    def factual_sections(self, facts):
        """仅用已读且经投影过滤的目标事实生成保底短答，不增读、不引用未读项。

        调用方仍需走既有文本/数字校验。只能在预算内补读后收尾，不能以该方法
        冒充完成未知目标或任意对象明细的语义分析。
        """
        available, result = _fact_map(facts), []
        for ref in self.report_refs:
            fact = available.get(ref)
            if not isinstance(fact, dict):
                continue
            window = fact.get('window', '')
            label = (window if window != '未登记周期' else '') + fact.get('name', '该项')
            status = fact.get('status')
            if status == 'provided':
                presentation = fact.get('presentation') or {}
                if presentation.get('answer'):
                    text = presentation['answer']
                else:
                    values = _leaves(fact.get('value'))
                    if not values:
                        text = label + '有相关信息，暂未完成进一步解读。'
                    else:
                        unit = metric_unit(fact) if type(fact.get('value')) in (int, float) else ''
                        text = label + '为' + '、'.join(values) + unit + '。'
            elif status == 'missing':
                text = '当前报告未提供' + label + '，无法确认具体结果。'
            elif status == 'empty':
                text = label + '显示为空白，无法确认具体结果。'
            else:
                text = label + '暂时没有可确认的结果。'
            result.append({'text': text, 'sources': [ref]})
        return result
