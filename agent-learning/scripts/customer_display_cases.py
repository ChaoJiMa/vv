"""页面规则专项虚构报告：检验已恢复的实际转换，而非只测试直出数值。"""

from report_tools import LocalReportTools


def display_tools():
    """固定虚构值及已核实规则，包含复合依赖、真正缺失和未知图片三种边界。"""
    modules = {9: '非银行申请', 58: '非银行申请档位', 145: '婚姻登记', 169: '手机在网',
               18: '记录时间', 4: '报告概览', 19: '借贷统计', 30: '案件记录', 22: '学历信息'}
    fields, report = [], {
        'NONE_BANK_APPLY_M1_APPLY_QT_COUNT': '2', 'NONE_BANK_APPLY_M1_APPLY_P2P_COUNT': '3',
        'NONE_BANK_APPLY_D7_APPLY_QT_COUNT': 2, 'NONE_BANK_APPLY_D7_APPLY_P2P_COUNT': 2,
        'taizhouMarriageData': {'code': 0, 'data': {'state': 1}},
        'gxOnlineDurationModel': {'code': 200, 'queryResult': 1, 'min': 24, 'max': None, 'isp': '虚构运营商'},
        'record_time': '2', 'BRS_SUMMARY_CDDATAINCOMEINFO': '10万至15万',
        'BRS_LS_XYP_CPL0007': 99, 'BRS_LS_XYP_T01ACZZZZ': 2,
        'cases': [{'caseNo': None, 'c_ah': 'CASE-A', 'amount': '800.50元'},
                  {'ah': 'CASE-B', 'amount': '1200.00元'}],
    }

    def add(mid, name, path, rule, enum='', window=''):
        fields.append({'module_id': mid, 'module_name': modules[mid], 'name': name, 'path': 'report.' + path,
                       'frontend_processing': rule, 'enum_mapping': enum, 'window': window})

    add(9, '非银行其他申请次数', 'NONE_BANK_APPLY_M1_APPLY_P2P_COUNT', 'QT 与 P2P 两个字段直接用 JavaScript + 相加', window='近1月')
    add(58, '非银行其他申请档位', 'NONE_BANK_APPLY_D7_APPLY_QT_COUNT', 'QT 与 P2P 两个字段；档位展示经 getGear(D7, 原值)', window='近7天')
    add(145, '婚姻登记结果', 'taizhouMarriageData.data.state', '原值传给页面或子组件')
    for key, name in [('min', '手机在网时长'), ('isp', '运营商'), ('code', '查询状态'), ('max', '时长上界'), ('queryResult', '查询结果码')]:
        add(169, name, 'gxOnlineDurationModel.' + key, '与 max 联合生成文字')
    add(18, '最近一次记录时间', 'record_time', '页面 A() 宽松相等映射后展示')
    add(4, '收入预测', 'BRS_SUMMARY_CDDATAINCOMEINFO', '按字段JavaScript真值决定收入图文是否显示')
    add(19, '借贷账户图示', 'BRS_LS_XYP_CPL0007', '严谨版onMounted按==0/1/2/3/4宽松比较选择图片',
        '0 → 暂无记录；1 → 1；2 → 1；3 → 2~3；4 → 4+。\n数值为图片文案')
    add(19, '未结清金额区间', 'BRS_LS_XYP_T01ACZZZZ', '先以parseInt(值)-1取zz元区间，再formatRangeWan')
    add(30, '案件编号', 'cases[].caseNo | report.cases[].c_ah | report.cases[].ah', 'caseNo ?? c_ah ?? ah 依次取首个非 null/undefined 值')
    add(30, '案件金额', 'cases[].amount', '直接输出原值')
    add(22, '学历', 'education', '尚未核实的转换')
    order = {'order_id': 'EVAL_DISPLAY_ORDER', 'report_id': 'EVAL_DISPLAY_REPORT', 'is_demo': False,
             'report_data': {'report': report, 'template': {'theme': 1, 'config': '',
                'modules': [{'moduleId': mid, 'moduleName': name} for mid, name in modules.items()]}}}
    return LocalReportTools(order, {'theme': 1, 'theme_name': '虚构页面规则报告', 'fields': fields})


def display_cases():
    """预期独立于模型，禁止把未解析的图片值当作实际账户数。"""
    from scripts.customer_eval_cases import Case, Step
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
