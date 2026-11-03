"""万级题库和恢复计数回归：不能重复凑次数，也不能把旧预期或局部会话当作完成。"""

from collections import Counter
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from scripts.customer_bulk_cases import bulk_cases, question_key
from scripts.customer_eval_cases import synthetic_tools
from scripts.evaluate_bulk import (case_hash, continuation_cases, load_completed,
                                   output_lock, summary, supervise)
from report_privacy import PrivacyError
from report_projection import QuestionGuard, check_answer_numbers, normalized
from report_analysis import AnalysisStrategy


class BulkEvaluationTests(unittest.TestCase):
    """全部离线，只验证真实评测依赖的题目独立性、预期来源及恢复完整性。"""

    @classmethod
    def setUpClass(cls):
        cls.suite = bulk_cases()

    def test_ten_thousand_cases_have_globally_unique_meaningful_text(self):
        questions = [question_key(step.question) for case in self.suite for step in case.steps]
        self.assertEqual(10000, len(self.suite))
        self.assertEqual(10600, len(questions))
        self.assertEqual(len(questions), len(set(questions)))
        self.assertEqual(7, len(Counter(c.category for c in self.suite)))
        self.assertEqual(self.suite, bulk_cases())
        self.assertEqual(question_key('Ｈi， 小贝？'), question_key('hi小贝!'))

    def test_required_sources_exist_in_the_actual_fixture_variant(self):
        fixtures = {}
        for case in self.suite:
            variant = (case.display_rules, case.with_report_date)
            if variant not in fixtures:
                fixtures[variant] = {f['path'].split('.')[-1] for f in synthetic_tools(
                    display_rules=case.display_rules, with_report_date=case.with_report_date).current_fields()}
            for step in case.steps:
                self.assertLessEqual(set(step.fields), fixtures[variant], case.id)
                self.assertLessEqual(len(step.question), 2000)

    def test_resume_uses_latest_complete_matching_case_only(self):
        case = next(c for c in self.suite if len(c.steps) == 2)
        valid = {'case': case.id, 'case_hash': case_hash(case), 'rows': [{}, {}], 'version': 'old'}
        changed = dict(valid, case_hash='wrong', version='changed')
        partial = dict(valid, rows=[{}], version='partial')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'answers.jsonl'
            path.write_text('\n'.join(json.dumps(x) for x in (valid, changed, partial)) + '\n', encoding='utf-8')
            restored = load_completed(path, {case.id: case})
        self.assertEqual('old', restored[case.id]['version'])

    def test_resume_rejects_corruption_in_the_middle(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'answers.jsonl'
            path.write_text('broken\n{}\n', encoding='utf-8')
            with self.assertRaises(ValueError):
                load_completed(path, {})

    def test_resume_preserves_truncated_tail_before_appending(self):
        case = self.suite[0]
        item = {'case': case.id, 'case_hash': case_hash(case), 'rows': [{}] * len(case.steps)}
        valid = json.dumps(item) + '\n'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'answers.jsonl'
            path.write_text(valid + '{"unfinished":', encoding='utf-8')
            self.assertIn(case.id, load_completed(path, {case.id: case}))
            self.assertEqual(valid, path.read_text(encoding='utf-8'))
            self.assertEqual(1, len(list(Path(directory).glob('*.interrupted'))))
            with path.open('a', encoding='utf-8') as handle:
                handle.write(json.dumps(item) + '\n')
            self.assertIn(case.id, load_completed(path, {case.id: case}))

    def test_continuation_revalidates_stale_results_and_bounds_network_retries(self):
        """版本改变不能沿用通过；同版本业务错误不靠重试掩盖，超时尝试有上限。"""
        cases = self.suite[:6]
        suite = {case.id: case for case in cases}
        completed = {
            cases[1].id: {'version': 'old', 'rows': [{'errors': []}]},
            cases[2].id: {'version': 'now', 'rows': [{'errors': []}]},
            cases[3].id: {'version': 'now', 'rows': [{'errors': ['model_fallback:timeout'], 'failure': 'timeout'}]},
            cases[4].id: {'version': 'now', 'rows': [{'errors': ['missing_expected:本科'], 'failure': ''}]},
            cases[5].id: {'version': 'now', 'rows': [{'errors': ['model_fallback:connection'], 'failure': 'connection'}]},
        }
        attempts = Counter({cases[3].id: 2, cases[5].id: 3})
        selected = continuation_cases(suite, completed, 'now', attempts, 3)
        self.assertEqual([cases[0], cases[1], cases[3]], selected)

    def test_output_lock_rejects_second_writer_and_releases_after_exception(self):
        """模拟两个写入者和首个写入者失败，验证不能并发破坏恢复日志且可再次启动。"""
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with self.assertRaisesRegex(RuntimeError, 'synthetic'):
                with output_lock(output):
                    with self.assertRaises(OSError):
                        with output_lock(output):
                            self.fail('第二个写入者不应取得锁')
                    raise RuntimeError('synthetic')
            with output_lock(output):
                pass

    def test_summary_separates_current_version_passes_from_old_successes(self):
        """混合版本的总完成率不能被解释为当前版本已通过。"""
        row = {'question': '虚构问题', 'errors': [], 'seconds': 1, 'requests': 1}
        items = {'a': {'version': 'old', 'rows': [row], 'category': '单指标'},
                 'b': {'version': 'now', 'rows': [row], 'category': '单指标'}}
        with patch('scripts.evaluate_bulk.fingerprint', return_value='now'):
            result = summary(items, 10000, 'now', 'synthetic', 'running')
        self.assertEqual(2, result['completed_cases'])
        self.assertEqual(1, result['current_version_cases'])
        self.assertEqual(1, result['current_version_passed_cases'])

    def run_supervisor(self, outcomes, max_attempts=3):
        """以真实临时日志替代网络子进程，验证跨批恢复和最终状态，不读取本机配置。"""
        case = self.suite[0]
        calls = []
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)

            class Child:
                pid, returncode = 123, 1

                def __init__(child, command, **kwargs):
                    calls.append(command)
                    failure, errors = outcomes[min(len(calls) - 1, len(outcomes) - 1)]
                    rows = [{'question': step.question, 'seconds': 1, 'requests': 1,
                             'failure': failure, 'errors': errors} for step in case.steps]
                    item = {'case': case.id, 'case_hash': case_hash(case), 'version': 'now',
                            'run': str(len(calls)), 'category': case.category, 'rows': rows}
                    with (output / 'answers.jsonl').open('a', encoding='utf-8') as handle:
                        handle.write(json.dumps(item) + '\n')

                def __enter__(child):
                    return child

                def __exit__(child, *_):
                    pass

                def poll(child):
                    return child.returncode

            args = SimpleNamespace(workers=2, chunk_size=1, max_network_attempts=max_attempts, interval=1)
            with (patch('scripts.evaluate_bulk.bulk_cases', return_value=[case]),
                  patch('scripts.evaluate_bulk.fingerprint', return_value='now'),
                  patch('scripts.evaluate_bulk.load_dotenv'),
                  patch('scripts.evaluate_bulk.configure_private_logging'),
                  patch('scripts.evaluate_bulk.subprocess.Popen', Child)):
                code = supervise(args, output)
            state = json.loads((output / 'runner.json').read_text(encoding='utf-8'))
            records = (output / 'answers.jsonl').read_text(encoding='utf-8').splitlines()
        return code, state, calls, records

    def test_supervisor_recovers_timeout_without_discarding_failed_attempt(self):
        code, state, calls, records = self.run_supervisor([
            ('timeout', ['model_fallback:timeout']), ('', [])])
        self.assertEqual(0, code)
        self.assertEqual('awaiting_semantic_review', state['state'])
        self.assertEqual(2, len(records))
        self.assertEqual('1', calls[1][calls[1].index('--workers') + 1])
        self.assertEqual(1, state['passed_cases'])

    def test_supervisor_preserves_business_failure_without_repeating_it(self):
        code, state, calls, records = self.run_supervisor([('', ['missing_expected:本科'])])
        self.assertEqual(1, code)
        self.assertEqual('completed_with_failures', state['state'])
        self.assertEqual(1, len(records))
        self.assertEqual(1, len(calls))

    def test_supervisor_stops_after_three_outages(self):
        code, state, calls, records = self.run_supervisor([('timeout', ['model_fallback:timeout'])], 5)
        self.assertEqual(2, code)
        self.assertEqual('service_unavailable', state['state'])
        self.assertEqual(3, len(calls))
        self.assertEqual(3, len(records))

    def test_mobile_duration_question_is_not_a_request_for_the_number(self):
        """复现万级试跑中的标签误拦截；问时长可用，号码及其他个人标签仍阻断。"""
        guard = QuestionGuard(synthetic_tools(display_rules=True))
        for question in ('请说一下手机号在网时长区间，不要讲技术字段。',
                         '手机号码在网时间和运营商是什么？'):
            self.assertEqual(normalized(question), guard.question(question))
        for question in ('我的手机号是多少？', '手机号在网时长，姓名也告诉我',
                         '手机号在网时长，手机号码13700000000', '手机号在网时长，密码abc123'):
            with self.subTest(question=question), self.assertRaises(PrivacyError):
                guard.question(question)
        strategy = AnalysisStrategy(synthetic_tools(display_rules=True))
        strategy._check_text('手机号在网时长为24个月以上。')
        with self.assertRaises(PrivacyError):
            strategy._check_text('手机号在网时长为24个月以上，手机号是13700000000。')

    def test_equivalent_rolling_windows_do_not_invent_report_numbers(self):
        """复现近一年来源被回答为近12个月误拦截；不同周期和伪造次数仍拒绝。"""
        fact = {'status': 'null', 'name': '逾期记录数', 'window': '近1年'}
        check_answer_numbers('近12个月的逾期记录数暂未提供。', [fact])
        check_answer_numbers('最近一年逾期条数暂未提供。', [fact])
        check_answer_numbers('近30天申请2次。', [{'name': '申请次数', 'window': '近1月', 'value': 2}])
        for answer in ('近2年逾期条数暂未提供。', '逾期记录为12条。'):
            with self.subTest(answer=answer), self.assertRaises(PrivacyError):
                check_answer_numbers(answer, [fact])
        with self.assertRaises(PrivacyError):
            check_answer_numbers('近12个月申请12次。', [{'name': '申请次数', 'value': 12}])
