"""限高立案日期纠正使用同一条记录和报告支持的日期。"""

import unittest

from report_assistant.conversation.case_filing import correct_filing_gap
from report_assistant.security.answer_validation import check_answer_numbers


def projected_rows(*rows):
    """以正式数组投影的包装构造虚构日期和案件来源。"""
    return {'status': 'provided', 'value': list(rows)}


class CaseFilingTests(unittest.TestCase):
    """覆盖上下文保留、引用绑定与空白情况。"""

    def setUp(self):
        self.fields = {
            'f1': 'report.LIMITED_CONSUMPTION_00001[].court',
            'f2': 'report.LIMITED_CONSUMPTION_00001[].issueTime',
            'f3': 'report.LIMITED_CONSUMPTION_00001[].fileTime',
            'f4': 'report.PERSONOPENCASE.personRestrictedConsumer.xzgxfList[].sortDate',
        }
        self.facts = {
            'f1': projected_rows({'present': True, 'value': '示例法院'}),
            'f2': projected_rows({'present': True, 'value': '2024-03-15'}),
            'f3': projected_rows({'present': True, 'value': '2024年2月14日'}),
            'f4': projected_rows({'present': True, 'value': '2023-01-01'}),
        }
        self.draft = '有示例法院的限高案件，发布时间为2024-03-15，立案时间暂未提供。'

    def correct(self, text, *sources):
        return correct_filing_gap(text, self.facts, self.fields, sources=sources)

    def test_corrects_only_the_standalone_filing_gap_and_preserves_other_facts(self):
        text, refs = self.correct(self.draft, 'f1', 'f2')
        self.assertEqual(text, '有示例法院的限高案件，发布时间为2024-03-15，立案时间为2024-02-14。')
        self.assertEqual(refs, ['f3'])
        check_answer_numbers(text, [self.facts[ref] for ref in ('f1', 'f2', *refs)])
        for draft in ('暂时无法确认该案的立案日期。', '立案时间暂未显示。'):
            self.assertEqual(self.correct(draft, 'f3'), ('立案时间为2024-02-14。', []))

    def test_missing_filing_value_keeps_verified_facts_or_suggests_human_for_filing_only(self):
        for empty in ({'present': False}, {'present': True, 'value': None},
                      {'present': True, 'value': '2024-02-31'}):
            with self.subTest(empty=empty):
                self.facts['f3'] = projected_rows(empty)
                text, refs = self.correct(self.draft, 'f1', 'f2')
                self.assertEqual(text, '有示例法院的限高案件，发布时间为2024-03-15。')
                self.assertEqual(refs, [])
                self.assertEqual(self.correct('立案时间暂未提供，发布时间为2024-03-15。', 'f2'),
                                 ('发布时间为2024-03-15。', []))
                self.assertEqual(self.correct('立案时间暂未提供。', 'f3'),
                                 ('具体情况请联系人工客服核实。', []))

    def test_refuses_to_borrow_another_case_group_or_row(self):
        self.assertEqual(self.correct(self.draft, 'f1', 'f2', 'f4'), (self.draft, []))
        self.assertEqual(self.correct('立案时间暂未提供。', 'f4'), ('立案时间暂未提供。', []))
        self.facts['f3']['value'].append({'present': True, 'value': '2024-02-01'})
        self.assertEqual(self.correct(self.draft, 'f1', 'f2'), (self.draft, []))

    def test_refuses_to_change_questions_or_explanations_with_a_matching_substring(self):
        for draft in ('立案时间暂未提供？', '尚不能判断立案时间暂未提供的原因。',
                      '报告注明立案时间暂未提供的原因。', '立案时间暂未提供的记录可另行查询。'):
            with self.subTest(draft=draft):
                self.assertEqual(self.correct(draft, 'f1', 'f2'), (draft, []))

    def test_binds_each_confirmed_date_to_its_own_role(self):
        original = '立案时间为2024-03-15，发布时间为2024-02-14。'
        corrected, refs = self.correct(original, 'f2', 'f3')
        self.assertEqual(corrected, '立案时间为2024-02-14，发布时间为2024-03-15。')
        self.assertEqual(refs, [])

    def test_removes_only_the_handoff_attached_to_the_corrected_date(self):
        text, refs = self.correct(
            '发布时间为2024-03-15，立案时间暂未提供。建议联系人工客服核实。对法院记录有疑问可咨询客服。', 'f2')
        self.assertEqual(text, '发布时间为2024-03-15，立案时间为2024-02-14。对法院记录有疑问可咨询客服。')
        self.assertEqual(refs, ['f3'])
        self.facts['f3'] = projected_rows({'present': True, 'value': '0000-00-00'})
        self.assertEqual(self.correct('发布时间为2024-03-15，立案时间为0000-00-00。', 'f2', 'f3'),
                         ('发布时间为2024-03-15。', []))
