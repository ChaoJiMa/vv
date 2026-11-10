"""万级虚构问题：组合实际业务指标、周期和诉求，固定种子并全局去重。

预期直接取自独立虚构报告约定，不由被测模型生成；语言变式不是一万个业务意图。
无真实用户数据，既不读取.env，也不调用任何网络或历史数据库。
"""

from dataclasses import dataclass
import random
import re
import unicodedata

from scripts.eval_support.contracts import Case, Step


@dataclass(frozen=True)
class Atom:
    """一个可独立提问的指标，绑定自然标签、预期词组及本地来源末级名。"""

    labels: tuple
    fields: tuple
    required: tuple
    forbidden: tuple = ()


UNKNOWN = ('未提供', '未显示', '暂无', '缺少', '无法确认', '没有可确认', '空白')
BASIC = (
    Atom(('报告分数和等级', '报告评分及所属等级', '分析指数和对应等级', '报告展示分数及分档'),
         ('BRS_RS_00001',), (('70分', '70 分'), ('一般',)), ('69.5',)),
    Atom(('近7天非银行申请次数', '最近一周非银申请了几次', '非银过去7天的申请次数', '非银行近一周申请总次数'),
         ('nonbank_D7_count',), (('0次', '0 次', '零次'),), ('从未申请', '没有逾期')),
    Atom(('近一个月非银行申请次数', '非银近30天申请了几次', '非银行最近一个月申请总次数', '非银近1个月申请次数'),
         ('nonbank_M1_count',), (('8次', '8 次', '八次'),)),
    Atom(('近一个月非银行申请机构数', '非银近30天申请涉及几家机构', '非银行最近一个月申请过几家', '非银近1月的申请机构数量'),
         ('nonbank_M1_orgs',), (('3家', '3 家', '三家'),)),
    Atom(('近3个月非银申请次数', '过去三个月非银行申请总次数', '非银行最近3月申请几次', '非银近一季的申请次数'),
         ('nonbank_M3_count',), (UNKNOWN,), ('是0', '为0', '没有申请')),
    Atom(('近半年非银行申请次数', '非银最近6个月申请了几次', '过去六个月非银行申请次数', '非银近6月的申请总次数'),
         ('nonbank_M6_count',), (UNKNOWN,), ('是0', '为0', '没有申请')),
    Atom(('近一个月非银行夜间申请次数', '非银近1月夜间申请了几次', '非银行最近30天的夜间申请数', '最近一个月非银夜间申请记录次数'),
         ('nonbank_night',), (UNKNOWN,), ('是0', '为0')),
    Atom(('近7天非银行申请档位', '非银近一周的申请档位', '非银行过去7天申请处于第几档', '非银最近一周申请显示的档位'),
         ('sample_D7_gear',), (('3档', '3 档', '第三档'),), ('4次',)),
    Atom(('近一个月银行申请次数', '银行近30天申请了几次', '最近一个月银行申请总次数', '银行近1个月的申请数'),
         ('bank_M1_count',), (('2次', '2 次', '两次', '二次'),)),
    Atom(('近一个月银行申请机构数', '最近30天申请过几家银行', '银行近1月的申请机构数量', '近一个月银行申请涉及几家'),
         ('bank_M1_orgs',), (('1家', '1 家', '一家'),)),
    Atom(('近一年逾期记录数', '近12个月有几条逾期记录', '过去一年逾期条数', '报告近1年登记的逾期数量'),
         ('overdue_count',), (UNKNOWN,), ('没有逾期', '无逾期', '0条')),
    Atom(('未结清余额范围', '报告上还没结清的余额区间', '尚未结清的金额范围', '未结清余额显示的区间'),
         ('loan_balance',), (('1000',), ('2000',))),
    Atom(('报告里的学历', '报告显示的教育程度', '学历这一栏的结果', '这份报告登记的学历信息'),
         ('education',), (('本科',),), ('编码',)),
    Atom(('报告查询日期', '这份报告的查询时间', '报告概览里的查询日期', '当前报告标注的查询日'),
         ('report_query_date',), (('2024年5月7日', '2024年05月07日', '2024-05-07', '2024/05/07'),)),
)
DISPLAY = (
    Atom(('近1月非银行其他申请次数', '非银其他近一个月申请了几次', '非银行其他申请近30天总次数', '近一个月非银其他的申请数'),
         ('NONE_BANK_APPLY_M1_APPLY_P2P_COUNT',), (('5次', '5 次', '五次'),)),
    Atom(('近7天非银行其他申请档位', '非银其他最近一周申请档位', '非银行其他近一周显示第几档', '过去7天非银其他申请的档位'),
         ('NONE_BANK_APPLY_D7_APPLY_QT_COUNT',), (('3档', '3 档', '第三档'),)),
    Atom(('婚姻登记结果', '报告里的婚姻登记状态', '婚姻登记这一栏的显示结果', '当前报告显示的婚姻状态'),
         ('state',), (('已婚',),)),
    Atom(('手机在网时长', '报告显示手机在网多久', '手机在网时间范围', '手机号在网时长区间'),
         ('min',), (('24个月以上', '24 个月以上'),)),
    Atom(('手机运营商', '报告里显示的运营商', '手机在网模块的运营商信息', '当前报告中的手机运营商名称'),
         ('isp',), (('虚构运营商',),)),
    Atom(('最近一次记录时间范围', '最近一次记录距今多久', '报告最近记录的时间区间', '最近记录距今的时间档位'),
         ('record_time',), (('3到5年', '3至5年', '3—5年', '3-5年', '3~5年', '3～5年'),)),
    Atom(('收入预测范围', '报告显示的收入预测', '报告概览中的收入预测区间', '收入预测这一栏的结果'),
         ('BRS_SUMMARY_CDDATAINCOMEINFO',), (('10万',), ('15万',))),
    Atom(('未结清金额区间', '借贷模块展示的未结清金额范围', '未结清金额的页面区间', '未结清金额这一项的范围'),
         ('BRS_LS_XYP_T01ACZZZZ',), (('4.5',), ('11.5',), ('万',))),
    Atom(('案件编号', '案件记录里的编号', '报告中列出的案号', '案件记录中的各项编号'),
         ('ah',), (('CASE-A',), ('CASE-B',))),
)

# 每个客服诉求独立登记关键业务内容，组合时必须全部保留，不能只检查热线。
SERVICES = {
    'human': (('怎么联系人工客服', '把真人客服联系方式给我', '找人工工作人员要怎么联系', '人工热线和邮箱是什么'), (('400-668-2687',),)),
    'appeal': (('报告数据有异议该怎么申诉', '有一条记录不对如何提出异议', '想投诉报告中的错误该找谁', '对报告结果提出异议有什么渠道'), (('异议',), ('400-668-2687',))),
    'refund': (('买错报告如何咨询退款', '想把购买费用退回该联系谁', '退款申请要找谁核实', '退费的事怎么跟人工沟通'), (('退款', '退费'), ('400-668-2687',))),
    'data_source': (('数据提供方和更新周期能确认吗', '这些信息从哪来多久更新一次', '能不能核实报告数据的来源', '各模块数据来源由谁核实'), (('无法核实', '无法确认', '不能核实'),)),
    'loan': (('凭这份报告能保证贷款通过吗', '我现在能不能贷到款', '报告能不能保证下款', '能不能承诺我申请会获批'), (('无法', '不能'), ('贷款', '下款'))),
    'score_vs_loan': (('评分高但贷款没通过是什么原因', '分数不低为什么还是贷不下来', '高分为什么申请仍被拒', '评分挺好可贷款申请没成功怎么回事'), (('评分',), ('审批', '申请'))),
    'application_frequency': (('两次申请隔多少天才正常', '贷款申请多久一次才合适', '非银申请多长时间一次不影响结果', '申请间隔有没有统一标准'), (('没有', '不能'), ('间隔', '标准'))),
    'report_list': (('账号下报告总数能查出来吗', '名下全部报告一共有几份', '能数一下我全部的报告吗', '我总共买过几份报告'), (('不能', '无法'), ('报告',))),
}
OPENERS = ('请帮我看一下', '小贝，查查', '我没看明白，想了解', '能直接告诉我', '麻烦核对', '我想确认', '请说一下', '帮忙解释一下', '我比较着急，想知道', '刚打开报告，请看', '不太懂这一项，想问', '帮我看看')
ENDINGS = ('，直接说结果就好。', '，不要讲技术字段。', '，请用一句话说明。', '，按报告实际显示回答。', '，别猜没有的数据。', '，请用好理解的话说。', '，我只想知道这个。', '，不用扩展其他指标。')
CONNECTORS = ('；另外也查一下', '，还有', '；再帮我确认', '，同时想知道', '，以及', '；也请说明', '，顺带问问', '；第二项是')


def question_key(text):
    """忽略宽窄字符、空白及标点去重，不用序号或仅变标点凑数量。"""
    return re.sub(r'[\W_]+', '', unicodedata.normalize('NFKC', text)).casefold()


def bulk_cases(seed=20261102):
    """返回10000个会话/10600轮独特问法，分层配额避免只生成单类排列。

    每个指标的多种标签均明确保留模块和周期；双/三指标只在同一虚构报告内组合。
    连续追问第一轮带完整指标，第二轮只改变周期或指标，检验上下文承接。
    """
    rng, result, seen = random.Random(seed), [], set()
    quotas = [('单指标', 2500), ('双指标', 2500), ('三指标', 1200), ('报告与客服', 2000),
              ('多项客服', 1000), ('连续追问', 600), ('整体总结', 200)]
    for category, count in quotas:
        added = attempts = 0
        while added < count:
            attempts += 1
            if attempts > count * 300:
                raise ValueError(f'{category}题库组合空间不足，已生成{added}条，拒绝重复凑数')
            display = rng.random() < .35
            atoms = DISPLAY if display else BASIC
            opener, ending = rng.choice(OPENERS), rng.choice(ENDINGS)
            number = {'双指标': 2, '三指标': 3}.get(category, 1)
            chosen = rng.sample(atoms, number)
            question = opener + rng.choice(chosen[0].labels)
            for atom in chosen[1:]:
                question += rng.choice(CONNECTORS) + rng.choice(atom.labels)
            question += ending
            required = tuple(group for atom in chosen for group in atom.required)
            fields = tuple(field for atom in chosen for field in atom.fields)
            forbidden = chosen[0].forbidden if number == 1 else ()
            kind, extra = 'report', ()
            if category == '报告与客服':
                topic = rng.choice(tuple(SERVICES))
                texts, expected = SERVICES[topic]
                question = question.rstrip('。') + rng.choice(CONNECTORS) + rng.choice(texts) + '？'
                required += expected
            elif category == '多项客服':
                topics = rng.sample(tuple(SERVICES), rng.choice((2, 3)))
                question = opener + rng.choice(SERVICES[topics[0]][0])
                for topic in topics[1:]:
                    question += rng.choice(CONNECTORS) + rng.choice(SERVICES[topic][0])
                question += rng.choice(('，请分别回应。', '，这几件事都说一下。', '，按顺序解释就好。'))
                required = tuple(group for topic in topics for group in SERVICES[topic][1])
                fields, forbidden, kind = (), (), 'service_multiple'
            elif category == '连续追问':
                display = False
                first, second, follows = rng.choice((
                    (BASIC[1], BASIC[2], ('那近一个月呢', '改成最近30天呢', '再看近1个月的同一项呢', '这个指标近一个月又是多少')),
                    (BASIC[2], BASIC[3], ('那涉及几家机构', '同一周期机构数呢', '刚才那些申请涉及几家', '那申请机构数量是多少')),
                    (BASIC[2], BASIC[8], ('那银行这边呢', '同一周期换成银行申请呢', '银行同周期次数也说一下', '再看银行近一个月呢')),
                ))
                question = opener + rng.choice(first.labels) + rng.choice((
                    '，先说这一个指标，我接着问。', '，后面我再换个口径问。',
                    '，先确认这一周期的结果。', '，先查这个，稍后再比较。',
                    '，我想先听这个结果。', '，这一项先解释清楚。',
                    '，先给我当前这个数。', '，看懂这项我再继续问。'))
                required, fields, forbidden = first.required, first.fields, first.forbidden
                follow = rng.choice(follows) + rng.choice(CONNECTORS) + rng.choice((
                    '只要结果', '别把机构数当成次数', '别混用银行和非银', '仍以刚才这份报告为准',
                    '按相同指标口径说', '缺失就说明无法确认', '不要加其他周期', '不用复述上一轮结果',
                )) + rng.choice(ENDINGS)
                extra = (Step(follow, required=second.required, fields=second.fields),)
            elif category == '整体总结':
                question = opener + rng.choice(('这份报告的所有模块', '当前报告各部分', '报告里全部已开放的模块', '这份报告的逐模块解读'))
                question += rng.choice(CONNECTORS) + rng.choice(('最后做整体总结', '结尾说整体情况', '给一个整体归纳', '最后概括关注事项'))
                question += rng.choice(ENDINGS)
                fields, required, forbidden, kind = (), (), (), 'overview'
            step = Step(question, required=required, fields=fields, forbidden=forbidden, kind=kind,
                        max_chars=4500 if kind == 'overview' else 1500 if category in ('多项客服', '报告与客服') else 600)
            steps = (step,) + extra
            keys = [question_key(s.question) for s in steps]
            if len(set(keys)) != len(keys) or any(key in seen for key in keys):
                continue
            seen.update(keys)
            result.append(Case(f'bulk-{len(result) + 1:05d}', category, steps,
                               display_rules=display, with_report_date=not display))
            added += 1
    # 交错各类别，先试跑小批也覆盖全部类别；种子不受线程完成顺序影响。
    rng.shuffle(result)
    return result
