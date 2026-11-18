"""目录迁移的行为风险回归：嵌套源码指纹完整性、包导入隔离及资源锚点。"""

import importlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import evaluate_customer as evaluation
from report_assistant.reports.tools import DATA_DIR


class PackageLayoutTests(unittest.TestCase):
    """仅使用临时虚构源码，不读.env、不调用模型或业务接口。"""

    def make_sources(self, root):
        """构造同名嵌套文件，验证相对路径及递归扫描都参与版本识别。"""
        root = Path(root)
        for relative in ('main.py', 'scripts/cases.py', 'report_assistant/security/nested/check.py'):
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('VALUE = 1\n', encoding='utf-8')
        return root

    def test_nested_source_change_invalidates_evaluation_version(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.make_sources(temp)
            with patch.object(evaluation, 'ROOT', root):
                first = evaluation.fingerprint()
                (root / 'report_assistant/security/nested/check.py').write_text('VALUE = 2\n', encoding='utf-8')
                self.assertNotEqual(first, evaluation.fingerprint())

    def test_relative_paths_distinguish_same_named_modules(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.make_sources(temp)
            with patch.object(evaluation, 'ROOT', root):
                first = evaluation.fingerprint()
                source = root / 'report_assistant/security/nested/check.py'
                target = root / 'report_assistant/security/check.py'
                source.rename(target)
                self.assertNotEqual(first, evaluation.fingerprint())

    def test_absolute_workspace_and_generated_files_do_not_change_version(self):
        with tempfile.TemporaryDirectory() as one, tempfile.TemporaryDirectory() as two:
            first, second = self.make_sources(one), self.make_sources(two)
            with patch.object(evaluation, 'ROOT', first):
                version = evaluation.fingerprint()
                (first / '.eval').mkdir()
                (first / '.eval/transcript.py').write_text('IGNORED = 3\n', encoding='utf-8')
                self.assertEqual(version, evaluation.fingerprint())
            with patch.object(evaluation, 'ROOT', second):
                self.assertEqual(version, evaluation.fingerprint())

    def test_resources_remain_at_project_root(self):
        root = Path(__file__).resolve().parents[1]
        self.assertEqual(root / 'data', DATA_DIR)
        self.assertTrue((DATA_DIR / 'report_fields.json').is_file())

    def test_importing_package_does_not_read_configuration_or_connect(self):
        with patch('dotenv.load_dotenv', side_effect=AssertionError('不能读配置')), \
                patch('httpx.Client', side_effect=AssertionError('不能创建网络客户端')):
            module = importlib.import_module('report_assistant')
            importlib.reload(module)
            importlib.reload(importlib.import_module('report_assistant.security'))
