"""用纯虚构报告实测小贝客服；逐题落盘，连续模式每轮重启以加载最新规则。

仅创建独立模型客户端，不调用Java登录、报告接口或个人历史。正常答案记录在
本地.eval目录；SDK错误仅记录固定分类，既不输出异常正文也不保存请求消息。
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import statistics
import subprocess
import sys
import threading
import time
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

from report_assistant.runtime.logging import configure_private_logging
from report_assistant.runtime.config import ModelSettings
from report_assistant.runtime.models import create_model_client
from report_assistant.conversation.analysis import AnalysisFailure, AnalysisStrategy, OUT_OF_SCOPE_REPLY
from report_assistant.security.answer_validation import assertion_text, negative_zero_text
from report_assistant.conversation.service import HOTLINE, SERVICE_EMAIL, service_reply
from report_assistant.conversation.session import Conversation
from scripts.customer_eval_cases import cases, synthetic_tools


def stamp():
    """统一记录UTC绝对时间；报告另外标明本地时区，便于核对跨夜执行。"""
    return datetime.now(timezone.utc).isoformat()


def fingerprint():
    """根入口、完整业务包、题库/脚本和模型配置共同定版，不读取密钥。

    迁移后的子包必须递归覆盖；相对路径参与哈希，避免不同目录同名文件混淆，
    同时使同一份源码复制到不同绝对工作区后仍保持相同指纹。
    """
    digest = hashlib.sha256()
    paths = [*ROOT.glob('*.py'), *(ROOT / 'report_assistant').rglob('*.py'),
             *(ROOT / 'scripts').rglob('*.py')]
    for path in sorted(paths, key=lambda p: p.relative_to(ROOT).as_posix()):
        digest.update(path.relative_to(ROOT).as_posix().encode('utf-8'))
        digest.update(b'\0')
        digest.update(path.read_bytes())
        digest.update(b'\0')
    for name in ('REPORT_MODEL_PROVIDER', 'OPENAI_AUTH_MODE', 'OPENAI_MODEL', 'ZHIPU_MODEL', 'DEEPSEEK_MODEL', 'OPENAI_BASE_URL', 'OPENAI_PROXY_URL'):
        digest.update(os.getenv(name, '').encode())
    return digest.hexdigest()[:16]


def model_client(stack):
    """复用公共配置和模型装配；评测保持非交互，不打开浏览器或读取业务报告。"""
    settings = ModelSettings.from_env()
    return create_model_client(stack, settings, interactive=False), settings.provider, settings.model


class MeteredClient:
    """只统计请求与工具名称；模型原始消息、推理和异常均不进入记录。"""

    def __init__(self, client):
        self.client, self.requests, self.tools, self.drafts = client, 0, [], []
        self.request_seconds = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        """保持被测调用原样；计数包括失败请求，避免把回退当成功。"""
        self.requests += 1
        started = time.monotonic()
        try:
            result = self.client.chat.completions.create(**kwargs)
        finally:
            # 只记录每次请求耗时，包含失败调用；不记录请求正文或服务错误内容。
            self.request_seconds.append(round(time.monotonic() - started, 3))
        if result.choices:
            message = result.choices[0].message
            calls = message.tool_calls or []
            self.tools.extend(call.function.name for call in calls)
            # 只摘录模型面向客户撰写的text，用于诊断被拒绝的答案；不保存原始回包。
            def collect(value):
                if isinstance(value, dict):
                    for key, child in value.items():
                        if key == 'text' and isinstance(child, str):
                            self.drafts.append(safe_answer(child[:6000]))
                        elif isinstance(child, (dict, list)):
                            collect(child)
                elif isinstance(value, list):
                    for child in value:
                        collect(child)
            for raw in [message.content, *[call.function.arguments for call in calls if call.function.name == 'submit_report_analysis']]:
                try:
                    collect(json.loads(raw))
                except (ValueError, TypeError):
                    pass
        return result


class ObservedAnalysis(AnalysisStrategy):
    """观察正常会话会吞掉的回退分类，尤其是评分本地兜底不显示错误的情形。"""

    def answer(self, *args, **kwargs):
        self.failure = ''
        try:
            return super().answer(*args, **kwargs)
        except AnalysisFailure as error:
            self.failure = error.reason
            raise
        except Exception:
            self.failure = 'unexpected'
            raise


def safe_answer(answer):
    """日志只允许虚构问答；额外移除配置中的凭据，防止异常服务回显密钥。"""
    for name, value in os.environ.items():
        if any(word in name.upper() for word in ('API_KEY', 'TOKEN', 'PASSWORD', 'SECRET')) and len(value) >= 8:
            answer = answer.replace(value, '[凭据已移除]')
    return answer


def overview_scope_errors(answer, module_names):
    """仅在评测中发现基础信息模块夹带总体评价，不触发客户运行时回退。

    用已知模块标题划定正文，避免把末尾整体总结的合理限制归到上一模块。
    这里只识别明确无关的短语；最终仍须阅读原始虚构回答复核语义。
    """
    errors = []
    headings = list(re.finditer(r'\*\*([^*\n]+)\*\*', answer))
    for index, heading in enumerate(headings):
        name = heading.group(1)
        if name not in module_names or not re.search(r'学历|婚姻|手机在网|手机网络', name):
            continue
        end = headings[index + 1].start() if index + 1 < len(headings) else len(answer)
        body = answer[heading.end():end]
        if re.search(r'整体来看|综合来看|信用状况|整体信用|贷款审批|其他模块', body):
            errors.append('unrelated_module_conclusion:' + name)
    return errors


def evaluation_claims(answer):
    """评测用肯定内容视图；封闭的‘无法确认有没有逾期’不是‘没有逾期’保证。

    不跨分句删除后续结论，运行时校验保持原样；原始回答和失败记录均不改写。
    """
    text = re.sub(r'(?:无法|不能)(?:确定|确认|判断)(?:您|你)?有没有逾期(?:记录)?', '', answer)
    return negative_zero_text(assertion_text(text))


def judge(step, answer, conversation, requests, failure):
    """独立业务断言加来源检查；通过只代表自动门槛，还需逐条复核语义和体验。"""
    errors = []
    if failure or any(word in answer for word in ('改用本地', 'AI分析暂不可用', '未通过本地校验')):
        errors.append('model_fallback:' + (failure or 'local'))
    if not answer.strip():
        errors.append('empty_answer')
    if len(answer) > step.max_chars:
        errors.append('too_verbose')
    if len(re.findall(r'(?:报告)?页面.{0,5}(?:核对|查看|确认|核实)', answer)) > 1:
        errors.append('repeated_page_check')
    if answer.count(HOTLINE) > 1 or answer.count(SERVICE_EMAIL) > 1:
        errors.append('repeated_contact')
    for group in step.required:
        if not any(word in answer for word in group):
            errors.append('missing_expected:' + '/'.join(group))
    claims = evaluation_claims(answer)
    for word in step.forbidden:
        if word in claims:
            errors.append('forbidden:' + word)
    if step.kind == 'service':
        if answer != service_reply(step.topic):
            errors.append('wrong_service_topic:' + step.topic)
        if conversation.analysis_context is not None:
            errors.append('service_kept_context')
    elif step.kind == 'service_multiple':
        if conversation.analysis_context is not None:
            errors.append('service_kept_context')
    elif step.kind == 'general':
        if answer != OUT_OF_SCOPE_REPLY:
            errors.append('wrong_general_reply')
    else:
        context = conversation.analysis_context
        refs = context.field_refs if context else ()
        actual = {conversation.analysis.projection.fields[ref]['local']['path'].split('.')[-1] for ref in refs}
        if not set(step.fields) <= actual:
            errors.append('missing_sources:' + ','.join(sorted(set(step.fields) - actual)))
        if not requests:
            errors.append('no_real_model_request')
        if step.kind == 'overview':
            names = [m['name'] for m in conversation.tools.current_modules()] + ['整体总结']
            if not all('**' + name + '**' in answer for name in names):
                errors.append('overview_missing_modules')
            errors.extend(overview_scope_errors(answer, names[:-1]))
        if re.search(r'\b[fm]\d+\b|BRS_RS_|report\.|field_ref|module_ref|取整前|四舍五入|内部编码|原始值', answer):
            errors.append('internal_details')
    return errors


def write_json(path, value):
    """原子更新进度，读者不会读到半份JSON；追加问答独立实时刷盘。"""
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)


def run_round(args):
    """题间可并发、题内保持追问顺序；每题独立模型连接和内存会话。"""
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    version, started = fingerprint(), stamp()
    lock, rows = threading.Lock(), []
    selected = [case for case in cases() if not args.only or case.id in args.only.split(',')]
    if not selected:
        raise ValueError('没有匹配的题目')
    run_id = datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + version[:6]
    log = output / (run_id + '.jsonl')
    transcript = output / (run_id + '.md')
    transcript.write_text(f'# 小贝客服真实模型模拟记录\n\n开始：{started}；版本：{version}。\n\n全部报告和问题为虚构数据；自动通过须另经逐条语义复核，不代表真实用户或生产验收。\n', encoding='utf-8')

    def evaluate(case):
        """同一Case的多轮会话共用上下文，异常只按固定分类记录后继续其余题。"""
        with ExitStack() as stack:
            client, provider, model = model_client(stack)
            metered = MeteredClient(client)
            conversation = Conversation(synthetic_tools(case.score, case.unconfirmed_education, case.with_report_date, case.display_rules), strategy='analysis')
            conversation.analysis = ObservedAnalysis(conversation.tools)
            for index, step in enumerate(case.steps):
                count, started_turn = metered.requests, time.monotonic()
                draft_count, tool_count = len(metered.drafts), len(metered.tools)
                conversation.analysis.failure = ''
                try:
                    answer = conversation.answer(step.question, metered, model)
                except Exception:
                    answer = '评测未完成（固定分类：unexpected）'
                    conversation.analysis.failure = 'unexpected'
                elapsed = round(time.monotonic() - started_turn, 3)
                answer = safe_answer(answer)
                errors = judge(step, answer, conversation, metered.requests - count, conversation.analysis.failure)
                if elapsed > (90 if step.kind == 'overview' else 60):
                    errors.append('slow_response')
                record = {'time': stamp(), 'version': version, 'case': case.id, 'category': case.category,
                          'step': index + 1, 'provider': provider, 'model': model, 'question': step.question,
                          'answer': answer, 'seconds': elapsed, 'requests': metered.requests - count,
                          'request_seconds': metered.request_seconds[count:],
                          'draft_answers': metered.drafts[draft_count:], 'tools': metered.tools[tool_count:],
                          'sources': list(conversation.analysis_context.field_refs) if conversation.analysis_context else [],
                          'errors': errors, 'passed': not errors}
                with lock:
                    rows.append(record)
                    with log.open('a', encoding='utf-8') as handle:
                        handle.write(json.dumps(record, ensure_ascii=False) + '\n')
                    with transcript.open('a', encoding='utf-8') as handle:
                        handle.write(f'\n## {case.id} / {index + 1}\n\n用户：{step.question}\n\n小贝：{answer}\n\n结果：{errors or "自动通过"}；耗时{elapsed}秒；请求{record["requests"]}次。\n')
                    print(json.dumps({k: record[k] for k in ('case', 'step', 'passed', 'errors', 'seconds')}, ensure_ascii=False), flush=True)
                    write_json(output / 'progress.json', {'run': run_id, 'started': started, 'updated': stamp(),
                               'finished_steps': len(rows), 'total_steps': sum(len(c.steps) for c in selected),
                               'failed_steps': sum(not r['passed'] for r in rows)})

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for future in as_completed([pool.submit(evaluate, case) for case in selected]):
            future.result()
    complete_version = fingerprint()
    latencies = sorted(r['seconds'] for r in rows if r['requests'])
    summary = {'run': run_id, 'started': started, 'finished': stamp(), 'version': version,
               'version_stable': complete_version == version, 'full_suite': not bool(args.only),
               'cases': len(selected), 'steps': len(rows), 'passed': sum(r['passed'] for r in rows),
               'failed': sum(not r['passed'] for r in rows), 'requests': sum(r['requests'] for r in rows),
               'model_latency_p50': round(statistics.median(latencies), 3) if latencies else None,
               'model_latency_p95': latencies[min(len(latencies) - 1, int(len(latencies) * .95))] if latencies else None,
               'failure_cases': [r['case'] for r in rows if not r['passed']],
               'log': str(log), 'transcript': str(transcript), 'semantic_review': 'pending'}
    write_json(output / (run_id + '-summary.json'), summary)
    write_json(output / 'latest.json', summary)
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return 0 if summary['failed'] == 0 and summary['version_stable'] else 1


def continuous(args):
    """连续运行到同版本全题库连续达标；每轮新进程，修订后自动重新累计。

    机器门槛通过仅进入待语义复核，不宣称客服质量已获完整证明。父进程不保存
    子进程错误正文，服务失败仍逐轮记账；间隔避免网络故障时无休止密集请求。
    """
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    consecutive, last_version, round_number = 0, '', 0
    while True:
        round_number += 1
        command = [sys.executable, '-X', 'utf8', str(Path(__file__).resolve()), '--output', str(output), '--workers', str(args.workers)]
        if args.only:
            command.extend(['--only', args.only])
        # stdout仅包含本程序的固定统计；异常正文不输出到后台日志。
        result = subprocess.run(command, cwd=ROOT, stderr=subprocess.DEVNULL)
        try:
            summary = json.loads((output / 'latest.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            summary = {}
        valid = (result.returncode == 0 and summary.get('full_suite') and summary.get('version_stable')
                 and summary.get('failed') == 0 and summary.get('version') == fingerprint())
        consecutive = consecutive + 1 if valid and summary['version'] == last_version else int(valid)
        last_version = summary.get('version', '')
        state = {'updated': stamp(), 'rounds': round_number, 'consecutive_passes': consecutive,
                 'required_passes': args.until_pass, 'version': last_version,
                 'state': 'awaiting_semantic_review' if consecutive >= args.until_pass else 'running'}
        write_json(output / 'continuous.json', state)
        if consecutive >= args.until_pass:
            return 0
        time.sleep(args.interval)


def main():
    """显式运行该脚本即进行真实模型测试；--continuous为持续执行入口。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default=str(ROOT / '.eval' / 'customer'))
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=2)
    parser.add_argument('--only', default='', help='逗号分隔题目ID，适合失败题复测，不计入全量达标')
    parser.add_argument('--continuous', action='store_true')
    parser.add_argument('--until-pass', type=int, default=3)
    parser.add_argument('--interval', type=int, default=60)
    args = parser.parse_args()
    if args.until_pass < 1 or args.interval < 1:
        parser.error('连续通过轮数和轮间隔必须为正数')
    configure_private_logging()
    load_dotenv(ROOT / '.env')
    try:
        return continuous(args) if args.continuous else run_round(args)
    except KeyboardInterrupt:
        return 130
    except Exception:
        print('评测未完成：请核对配置或本地文件；异常正文不记录。', flush=True)
        return 2


if __name__ == '__main__':
    sys.exit(main())
