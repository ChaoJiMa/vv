"""独立口语与连续对话题库：固定虚构预期，不让模型自己生成标准答案。"""


def dialogue_cases():
    """覆盖改口、指代、催促、礼貌收尾及报告与客服共问，复用既有虚构报告。"""
    from scripts.eval_support.contracts import Case, Step

    def count(question, field='nonbank_M1_count', required=(('8次', '8 次', '八次'),)):
        return Step(question, fields=(field,), required=required, max_chars=120)

    return [
        Case('dialogue-oral', '口语压力', (count('非银这一个月申了几回啊？'),)),
        Case('dialogue-correct-metric', '改口纠正', (
            count('最近一个月非银申请多少次？'),
            count('我问错了，我想知道的是几家机构，不是几次。', 'nonbank_M1_orgs', (('3家', '3 家', '三家'),)),
        )),
        Case('dialogue-correct-window', '改口纠正', (
            count('非银近7天申请次数？', 'nonbank_D7_count', (('0', '零'),)),
            count('刚才说错了，我要查近一个月的。'),
        )),
        Case('dialogue-bank-follow', '连续追问', (
            count('非银近一个月申请了几次？'),
            count('那银行呢？', 'bank_M1_count', (('2次', '2 次', '两次'),)),
            count('涉及几家？', 'bank_M1_orgs', (('1家', '1 家', '一家'),)),
        )),
        Case('dialogue-org-follow', '连续追问', (
            count('近一个月非银行申请过几家机构？', 'nonbank_M1_orgs', (('3家', '3 家', '三家'),)),
            count('那次数呢？'),
        )),
        Case('dialogue-urgent-missing', '催促下的准确性', (Step('别绕圈了，我的逾期到底有没有？报告没数字，你能不能确认？',
             fields=('overdue_count',), required=(('无法确认', '不能确认', '无法判断', '不能判断'),),
             forbidden=('无逾期', '没有逾期', '0条'), max_chars=160),)),
        Case('dialogue-application-not-debt', '指标含义', (Step('报告近一个月非银申请8次，是不是就是借到了8笔钱？',
             fields=('nonbank_M1_count',), required=(('8次', '8 次'), ('不代表', '不等于', '不能')), max_chars=400),)),
        Case('dialogue-punctuation', '口语压力', (count('小贝？？近一个月，银行申请几次呀？？',
             'bank_M1_count', (('2次', '2 次', '两次'),)),)),
        Case('dialogue-three-facts', '多项指标', (Step('近一个月非银申请几次、涉及几家，未结清余额也一起说一下。',
             fields=('nonbank_M1_count', 'nonbank_M1_orgs', 'loan_balance'),
             required=(('8次', '8 次'), ('3家', '3 家'), ('1000',), ('2000',)), max_chars=250),)),
        Case('dialogue-repeat', '连续追问', (
            count('近一个月非银申请几次？'), count('刚才没看清，只把次数再说一遍就行。'),
        )),
        Case('dialogue-after-refund', '话题切换', (
            Step('报告分数是多少？', fields=('BRS_RS_00001',), required=(('70',), ('一般',))),
            Step('我想退款', topic='refund', kind='service', max_chars=250),
            Step('先不说退款了，我的学历是什么？', fields=('education',), required=(('本科',),),
                 forbidden=('退款需要',), max_chars=100),
        )),
        Case('dialogue-missing-follow', '连续追问', (
            Step('近3个月非银申请次数有吗？', fields=('nonbank_M3_count',), required=(('未提供', '未显示', '暂无'),)),
            Step('所以空着就是完全没申请过，对吧？', fields=('nonbank_M3_count',),
                 required=(('不代表', '不等于', '不能'),), max_chars=150),
        )),
        Case('dialogue-mobile-exact', '区间边界', (Step('手机在网是不是刚好两年？报告实际写的是什么？',
             fields=('min',), required=(('24个月以上', '24 个月以上'), ('不能', '无法', '不代表', '不是')),
             max_chars=160),), display_rules=True),
        Case('dialogue-loan-partial', '部分未知', (Step('借贷的图示看不出来，那已经能确认的金额能告诉我吗？',
             fields=('BRS_LS_XYP_T01ACZZZZ',), required=(('4.5',), ('11.5',)), forbidden=('99',), max_chars=160),),
             display_rules=True),
        Case('dialogue-case-total', '明细归纳边界', (Step('报告有没有给案件总金额？没给就说明不能确认，再把每项金额列出来。',
             fields=('amount',), required=(('800.50',), ('1200.00',), ('无法确认', '不能确认', '未提供', '未给出')),
             forbidden=('2000.5', '2000.50'), max_chars=250),), display_rules=True),
        Case('dialogue-case-follow', '连续追问', (
            Step('案件编号有哪些？', fields=('ah',), required=(('CASE-A',), ('CASE-B',))),
            Step('那每项金额呢？', fields=('amount',), required=(('800.50',), ('1200.00',)), max_chars=180),
        ), display_rules=True),
        Case('dialogue-source-contact', '多项客服', (Step('先说明你能不能确认数据来源，再给我完整人工联系方式。',
             kind='service_multiple', required=(('来源', '提供方'), ('无法核实', '无法确认', '不能确认'),
             ('400-668-2687',), ('ztkj@normalarmor.com',)), max_chars=400),)),
        Case('dialogue-source-appeal', '多项客服', (Step('我对数据来源有疑问，要核实来源，也想提出数据异议，分别怎么联系？',
             kind='service_multiple', required=(('来源', '提供方'), ('异议',), ('400-668-2687',)), max_chars=500),)),
        Case('dialogue-refund-human', '情绪客服', (Step('别只让我问机器人了，我要找真人处理退款，把联系方式给我。',
             kind='service_multiple', required=(('退款',), ('400-668-2687',)),
             forbidden=('已转接', '已为您办理', '已经退款'), max_chars=350),)),
        Case('dialogue-three-services', '多项客服', (Step('报告有数据异议，退款怎么咨询，这份报告能不能保证贷款通过？三件事都回答。',
             kind='service_multiple', required=(('异议',), ('退款',), ('不能', '无法'), ('贷款',), ('400-668-2687',)), max_chars=700),)),
        Case('dialogue-overview-refund', '整份报告与客服', (Step('先按模块分析整份报告并整体总结，最后说一下买错报告怎么退款。',
             kind='overview', required=(('70',), ('本科',), ('退款',), ('400-668-2687',)), max_chars=2600),)),
        Case('dialogue-overview-after-focus', '话题切换', (
            Step('我的学历是什么？', fields=('education',), required=(('本科',),), max_chars=80),
            Step('现在按模块分析整份报告，最后整体总结。', kind='overview', max_chars=2200),
        )),
        Case('dialogue-thanks', '自然收尾', (
            count('近一个月非银申请几次？'),
            Step('谢谢，这次明白了。', kind='service', topic='thanks', required=(('不客气', '不用客气'),),
                 forbidden=('不属于', '服务范围以外', '退款', '贷款'), max_chars=70),
            Step('这下看懂了，多谢您的解答。', kind='service', topic='thanks', max_chars=70),
            count('谢谢，顺便再查一下近一个月银行申请几次。', 'bank_M1_count', (('2次', '2 次', '两次'),)),
        )),
        Case('dialogue-mixed-greeting', '复合口语', (Step('小贝你好，近一个月银行和非银各申请几次？还有退款找谁？',
             fields=('bank_M1_count', 'nonbank_M1_count'), required=(('2次', '2 次'), ('8次', '8 次'),
             ('退款',), ('400-668-2687',)), max_chars=450),)),
    ]
