"""独立虚构报告构造器，不反向导入题目集合，不读取报告资料文件。"""

from report_assistant.reports.tools import LocalReportTools


def synthetic_tools(score=69.5, unconfirmed_education=False, with_report_date=False, display_rules=False):
    """返回纯内存、明确虚构的严谨版报告，覆盖展示值与来源口径差异。"""
    if display_rules:
        return display_tools()
    modules = [(5, "报告分析指数"), (9, "非银行申请"), (10, "银行申请"),
               (20, "逾期记录"), (21, "借贷统计"), (22, "学历信息")]
    rows = [
        (5, "报告分析指数", "BRS_RS_00001", "", score, "直接输出原值", ""),
        (9, "非银行申请次数", "nonbank_D7_count", "近7天", 0, "直接输出原值", ""),
        (9, "非银行申请次数", "nonbank_M1_count", "近1月", 8, "直接输出原值", ""),
        (9, "非银行申请机构数", "nonbank_M1_orgs", "近1月", 3, "直接输出原值", ""),
        (9, "非银行申请次数", "nonbank_M3_count", "近3月", None, "直接输出原值", ""),
        (9, "非银行申请次数", "nonbank_M6_count", "近6月", None, "直接输出原值", "missing"),
        (9, "非银行夜间申请次数", "nonbank_night", "近1月", "", "直接输出原值", ""),
        (9, "非银行申请档位", "sample_D7_gear", "近7天", 4, "档位模块：经 getGear 显示档位", ""),
        (10, "银行申请次数", "bank_M1_count", "近1月", 2, "直接输出原值", ""),
        (10, "银行申请机构数", "bank_M1_orgs", "近1月", 1, "直接输出原值", ""),
        (20, "逾期记录数", "overdue_count", "近1年", None, "直接输出原值", ""),
        (21, "未结清余额", "loan_balance", "", "1000至2000元", "直接输出原值", ""),
        (22, "学历", "education", "", "4", "函数switch严格匹配字符串编码", '"4" → 本科\n严格字符串匹配；其他／空值 → -。'),
    ]
    # 独立日期变式保留原题的引用顺序；必须实际提供日期，不能用空报告代替回归。
    if with_report_date:
        modules.append((23, "报告概览"))
        rows.append((23, "报告查询日期", "report_query_date", "", "2024-05-07", "直接输出原值", ""))
    names = dict(modules)
    fields, report = [], {}
    for mid, name, key, window, value, rule, enum in rows:
        if key == 'education' and unconfirmed_education:
            rule = '显示需要另一个字段，当前尚未核实全部依赖'
        fields.append({"module_id": mid, "module_name": names[mid], "name": name,
                       "path": "report." + key, "window": window,
                       "frontend_processing": rule, "enum_mapping": "" if enum == "missing" else enum})
        if enum != "missing":
            report[key] = value
    order = {"order_id": "EVAL_SYNTHETIC_ORDER", "report_id": "EVAL_SYNTHETIC_REPORT", "is_demo": False,
             "report_data": {"report": report, "template": {"theme": 3, "config": "",
                 "modules": [{"moduleId": mid, "moduleName": name} for mid, name in modules]}}}
    return LocalReportTools(order, {"theme": 3, "theme_name": "严谨版", "fields": fields})


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
