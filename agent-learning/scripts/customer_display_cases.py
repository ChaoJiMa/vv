"""页面规则专项虚构报告：检验已恢复的实际转换，而非只测试直出数值。"""

from scripts.eval_support.fixtures import display_tools




def display_cases():
    """预期独立于模型，禁止把未解析的图片值当作实际账户数。"""
    from scripts.eval_support.contracts import Case, Step
    rows = [
        ('sum', '近1个月非银行其他申请一共几次？', (('5次', '5 次', '五次'),), ('NONE_BANK_APPLY_M1_APPLY_P2P_COUNT',), ()),
        ('gear', '近7天非银行其他申请档位是多少，能知道具体次数吗？', (('3档', '3 档'), ('不能', '无法')), ('NONE_BANK_APPLY_D7_APPLY_QT_COUNT',), ('4次',)),
        ('marriage', '婚姻登记这一栏显示什么结果？', (('已婚',),), ('state',), ('未查到',)),
        ('duration', '报告显示手机在网多久，运营商是什么？', (('24个月以上', '24 个月以上'), ('虚构运营商',)), ('min', 'isp'), ('查询结果码',)),
        ('time', '最近一次记录距今多久？', (('3到5年', '3至5年', '3—5年', '3-5年'),), ('record_time',), ()),
        ('income', '报告里的收入预测结果是什么？', (('10万',), ('15万',)), ('BRS_SUMMARY_CDDATAINCOMEINFO',), ('实际年收入为',)),
        ('amount', '我的未结清金额区间显示多少？', (('4.5',), ('11.5',), ('万',)), ('BRS_LS_XYP_T01ACZZZZ',), ()),
        ('cases', '报告列了哪些案件编号？', (('CASE-A',), ('CASE-B',)), ('ah',), ('DO-NOT-USE',)),
        ('missing', '报告里的学历是什么？', (('未提供', '未显示', '暂无', '缺少'),), ('education',), ('本科',)),
        ('partial', '借贷模块能看出哪些结果？请把已经能确认的告诉我。', (('4.5',), ('11.5',)), ('BRS_LS_XYP_T01ACZZZZ',), ('99',)),
    ]
    result = [Case('display-' + key, '页面规则专项', (Step(question, required=required, fields=fields,
              forbidden=forbidden),), display_rules=True) for key, question, required, fields, forbidden in rows]
    result.append(Case('display-overview', '页面规则整份报告', (Step('分析我的报告', kind='overview',
                  required=(('已婚',), ('24个月',), ('4.5',)), forbidden=('99',), max_chars=4500),), display_rules=True))
    result.append(Case('display-case-detail', '明细归纳边界', (Step('案件记录这一部分，简要说说列出的编号和每项金额。',
                  required=(('CASE-A',), ('CASE-B',), ('800.50',), ('1200.00',)),
                  fields=('ah', 'amount'), forbidden=('2000.5', '2000.50', '2条', '2个'), max_chars=250),), display_rules=True))
    return result
