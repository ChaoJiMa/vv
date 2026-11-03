"""页面规则缺口回归：虚构输入验证组合依赖、空值语义与不外泄编码。"""

from copy import deepcopy
import json

from report_display import HIDDEN, MISSING, UNCONFIRMED, display_dependencies, display_field
from report_analysis import AnalysisStrategy
from report_privacy import PrivacyError
from report_projection import FactProjection, QuestionGuard
from report_tools import LocalReportTools
import test_privacy as support


def field(path, rule, enum='', mid=9, name='展示结果'):
    """构造固定源码规则的最小目录条目，不读取本机真实目录。"""
    return {'module_id': mid, 'module_name': '虚构模块', 'name': name, 'path': path,
            'frontend_processing': rule, 'enum_mapping': enum}


def projection_with(report, fields):
    """将虚构字段绑定到启用模块，走正式过滤与投影链路。"""
    order, catalog = support.fixtures(61)
    order['report_data']['report'].update(deepcopy(report))
    existing = {module['moduleId'] for module in order['report_data']['template']['modules']}
    for item in fields:
        if item['module_id'] not in existing:
            order['report_data']['template']['modules'].append({'moduleId': item['module_id'], 'moduleName': '虚构模块'})
            existing.add(item['module_id'])
    catalog['fields'].extend(deepcopy(fields))
    tools = LocalReportTools(order, catalog)
    return FactProjection(tools, QuestionGuard(tools))


def read_path(projection, path):
    """只通过已登记引用读取投影，测试不直接伪造模型路径。"""
    ref = next(ref for ref, item in projection.fields.items() if item['local']['path'] == path)
    return projection.read([ref])[0]


class DisplayRuleTests(support.NoExternalIO):
    """边界用例来自固定页面源码，不把扩大放行范围当作修复。"""

    def test_negated_equivalence_is_a_caution_instead_of_a_risk_guarantee(self):
        strategy = AnalysisStrategy(projection_with({}, []).tools)
        for text in ('未命中不能直接等同于没有逾期或无风险。',
                     '这些结果无法据此等同为无风险。'):
            strategy._check_text(text)

    def test_positive_guarantee_after_negated_equivalence_still_fails(self):
        strategy = AnalysisStrategy(projection_with({}, []).tools)
        for text in ('这些结果可以直接等同于无风险。',
                     '未命中不能直接等同于没有逾期，但当前无风险。',
                     '不能直接等同于无风险；实际上没有任何风险。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                strategy._check_text(text)

    def test_negated_borrowing_and_overdue_share_only_one_negative_scope(self):
        from report_overview import ReportOverview
        strategy = AnalysisStrategy(projection_with({}, []).tools)
        overview = ReportOverview(strategy.tools, strategy.projection, strategy._check_text, json.loads)
        facts = {'f1': {'status': 'missing'}}
        for text in ('查询结果不代表从未借贷或没有逾期。', '未提供不代表从未借贷、无逾期或无风险。'):
            overview._validate({'text': text, 'sources': ['f1']}, facts)
        for text in ('不代表从未借贷，但没有逾期。', '不代表从未借贷或没有逾期；当前无风险。',
                     '不代表从未借贷或您没有逾期。'):
            with self.subTest(text=text), self.assertRaises(PrivacyError):
                overview._validate({'text': text, 'sources': ['f1']}, facts)

    def test_unknown_rule_preserves_missing_null_empty_and_withholds_existing_value(self):
        fields = [field('report.' + key, '未知转换') for key in ('absent', 'nil', 'blank', 'coded')]
        projection = projection_with({'nil': None, 'blank': '', 'coded': 'private-code'}, fields)
        for key, expected in (('absent', 'missing'), ('nil', 'null'), ('blank', 'empty'), ('coded', 'withheld')):
            with self.subTest(key=key):
                fact = read_path(projection, 'report.' + key)
                self.assertEqual(fact['status'], expected)
                self.assertNotIn('value', fact)

    def test_record_time_codes_are_converted_instead_of_treated_as_unconfirmed(self):
        for letter, code, expected in (('A', '2', '3到5年'), ('A', 5, '无'), ('C', '2', '3年以上'), ('D', 3, '3个月以上')):
            with self.subTest(letter=letter, code=code):
                item = field('report.record', f'页面 {letter}() 宽松相等映射后展示')
                self.assertEqual(display_field(item, code), expected)
                self.assertEqual(display_field(item, None), '')
                self.assertEqual(display_field(item, 99), '')

    def test_combined_application_uses_both_fields_and_adapter_numeric_addition(self):
        path = 'report.NONE_BANK_APPLY_M1_APPLY_P2P_COUNT'
        item = field(path, 'QT 与 P2P 两个字段直接用 JavaScript + 相加')
        keys = display_dependencies(item)
        self.assertEqual(display_field(item, '3'), UNCONFIRMED)
        self.assertEqual(display_field(item, '3', dependencies=dict(zip(keys, ['2', '3']))), 5)
        self.assertIs(display_field(item, None, False, dependencies=dict.fromkeys(keys, MISSING)), MISSING)
        # 有一侧存在时复现页面Number||0；未知路径不能成为依赖入口。
        self.assertEqual(display_field(item, '3', dependencies=dict(zip(keys, [MISSING, '3']))), 3)
        projection = projection_with({path.split('.')[1]: '3', keys[0].split('.')[1]: '2'}, [item])
        self.assertEqual(read_path(projection, path)['value'], 5)
        with self.assertRaises(ValueError):
            projection.tools.display_value(field('report.secret', '直接输出原值'), 'x', True, lambda v, *_: v)

    def test_combined_gear_exposes_only_gear_not_combined_exact_value(self):
        item = field('report.NONE_BANK_APPLY_D7_APPLY_QT_COUNT', 'QT 与 P2P 两个字段；档位展示经 getGear(D7, 原值)', mid=58)
        keys = display_dependencies(item)
        values = {path.split('.')[1]: value for path, value in zip(keys, [2, 2])}
        projection = projection_with(values, [item])
        fact = read_path(projection, item['path'])
        self.assertEqual(fact['value'], '3档')
        self.assertNotIn('4', json.dumps(fact, ensure_ascii=False))

    def test_filtered_dependency_cannot_be_replaced_by_zero_in_a_combined_statistic(self):
        path = 'report.NONE_BANK_APPLY_M1_APPLY_P2P_COUNT'
        item = field(path, 'QT 与 P2P 两个字段直接用 JavaScript + 相加')
        projection = projection_with({'NONE_BANK_APPLY_M1_APPLY_P2P_COUNT': 3,
                                      'NONE_BANK_APPLY_M1_APPLY_QT_COUNT': '13800000000'}, [item])
        fact = read_path(projection, path)
        self.assertEqual(fact['status'], 'withheld')
        self.assertNotIn('value', fact)
        self.assertNotIn('13800000000', json.dumps(fact))

    def test_case_number_candidates_are_coalesced_per_record_and_keep_empty_priority(self):
        path = 'report.cases[].caseNo | report.cases[].c_ah | report.cases[].ah'
        item = field(path, 'caseNo ?? c_ah ?? ah 依次取首个非 null/undefined 值')
        projection = projection_with({'cases': [
            {'caseNo': None, 'c_ah': 'CASE-A'}, {'caseNo': '', 'c_ah': 'DO-NOT-USE'},
            {'ah': ' CASE-C '}, {'caseNo': 'null', 'ah': 'DO-NOT-USE'},
        ]}, [item])
        fact = read_path(projection, path)
        self.assertEqual([item['value'] for item in fact['value']], ['CASE-A', '——', 'CASE-C', '——'])
        self.assertNotIn('report.', json.dumps(fact))
        self.assertNotIn('DO-NOT-USE', json.dumps(fact))

    def test_marriage_display_uses_status_mapping_and_success_gate(self):
        item = field('report.taizhouMarriageData.data.state', '原值传给页面或子组件', mid=145, name='婚姻登记结果')
        for state in ('1', 1, 1.0, '3', 3, True):
            with self.subTest(state=state):
                expected = '已婚' if state == '1' or type(state) in (int, float) and state == 1 else '离异' if state in ('3', 3) else '未查到登记记录'
                self.assertEqual(display_field(item, state, dependencies={'report.taizhouMarriageData.code': '0'}), expected)
                self.assertEqual(display_field(item, state, dependencies={'report.taizhouMarriageData.code': '500'}), '未查到登记记录')
        classic = field('report.BRS_MR_00001', '原值传给页面或子组件', '假值或与 3 宽松相等 → 未查到登记记录')
        self.assertEqual(display_field(classic, '1'), '已婚')
        self.assertEqual(display_field(classic, 2), '离异')
        self.assertEqual(display_field(classic, 3), '未查到登记记录')

    def test_gx_duration_requires_success_and_preserves_null_upper_bound(self):
        base = 'report.gxOnlineDurationModel.'
        fields = [field(base + key, '与 max 联合生成文字', mid=169, name=key) for key in ('code', 'queryResult', 'isp', 'min', 'max')]
        projection = projection_with({'gxOnlineDurationModel': {'code': 200.0, 'queryResult': 1.0, 'isp': '虚构运营商', 'min': 24, 'max': None}}, fields)
        public_paths = {item['local']['path'] for item in projection.fields.values()}
        self.assertFalse({base + key for key in ('code', 'queryResult', 'max')} & public_paths)
        duration = read_path(projection, base + 'min')
        self.assertEqual((duration['name'], duration['value']), ('手机在网时长', '24个月以上'))
        self.assertEqual(read_path(projection, base + 'isp')['value'], '虚构运营商')
        failed = projection_with({'gxOnlineDurationModel': {'code': 500, 'queryResult': 1, 'isp': '隐藏运营商', 'min': 3, 'max': 6}}, fields)
        for key in ('isp', 'min'):
            fact = read_path(failed, base + key)
            self.assertEqual(fact['status'], 'empty')
            self.assertNotIn('value', fact)
        missing_upper = dict(zip(display_dependencies(fields[3]), [200, 1, 24, MISSING]))
        self.assertEqual(display_field(fields[3], 24, dependencies=missing_upper), '——')

    def test_overview_maps_only_current_modules_without_sending_numeric_ids(self):
        item = field('report.BRS_SUMMARY_00004', '用 == 与 template.modules[].moduleId 比较', mid=4)
        modules = [{'module_id': 9, 'name': '申请情况'}, {'module_id': 19, 'name': '借贷情况'}]
        self.assertEqual(display_field(item, ['19', 9, 9999, 9], modules=modules), ['申请情况', '借贷情况'])

    def test_old_abnormal_dates_are_hidden_when_nested_component_is_used(self):
        item = field('report.ABNORMAL_LIST_D90_YQ_DURATION', '仅 abnormalBehavior 为假值时显示此旧字段', mid=11)
        keys = display_dependencies(item)
        self.assertIs(display_field(item, 3, dependencies=dict(zip(keys, [{}, 1])), theme=1), HIDDEN)
        self.assertEqual(display_field(item, 3, dependencies=dict(zip(keys, [None, 1])), theme=1), '近4年内')
        self.assertEqual(display_field(item, '3', dependencies=dict(zip(keys, [None, 1])), theme=1), '近31年内')
        self.assertEqual(display_field(item, 3, dependencies=dict(zip(keys, [{}, 0])), theme=6), '-')

    def test_loan_response_zero_is_not_decoded_twice_and_unknown_image_stays_unconfirmed(self):
        zero = field('report.BRS_LS_XYP_T03TD148', 'null/undefined/空串 → ——；保留数字0和字符串0。', '1 → 0\n2 → 1')
        self.assertEqual(display_field(zero, 0), '0')
        self.assertEqual(display_field(zero, '3+'), '3+')
        image = field('report.BRS_LS_XYP_CPL0007', '严谨版onMounted按==0/1/2/3/4宽松比较选择图片', '0 → 暂无记录\n1 → 1\n2 → 1\n3 → 2~3\n4 → 4+。\n数值为图片文案')
        self.assertEqual(display_field(image, '3'), '2~3')
        self.assertIs(display_field(image, 99), UNCONFIRMED)

    def test_image_mapping_accepts_actual_single_line_semicolon_catalog(self):
        image = field('report.BRS_LS_XYP_CPL0001', '严谨版onMounted按==0/1/2/3宽松比较选择图片',
                      '0 → 暂无放款记录；1 → 1~8；2 → 9~13；3 → 14+。\n数值为实际切图顶部文案；比较使用==。')
        for code, expected in ((0, '暂无放款记录'), (1, '1~8'), ('2', '9~13'), (3, '14+')):
            with self.subTest(code=code):
                self.assertEqual(display_field(image, code), expected)
        self.assertIs(display_field(image, 99), UNCONFIRMED)

    def test_income_truthiness_and_amount_range_keep_page_semantics(self):
        income = field('report.BRS_SUMMARY_CDDATAINCOMEINFO', '按字段JavaScript真值决定收入图文是否显示')
        self.assertIs(display_field(income, 0), HIDDEN)
        self.assertEqual(display_field(income, '0'), '0')
        self.assertEqual(display_field(income, '10万至15万'), '10万至15万')
        amount = field('report.BRS_LS_XYP_T01ACZZZZ', '先以parseInt(值)-1取zz元区间，再formatRangeWan')
        for source, expected in ((1, '1~4.5万'), ('2', '4.5~11.5万'), (3, '11.5~∞万'),
                                 ('11500', '1.1万'), ('12500', '1.3万'), (None, '')):
            self.assertEqual(display_field(amount, source), expected)
