"""执行万级真实模型问答，逐会话落盘并按题库摘要恢复，失败与版本变化如实保留。"""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import ExitStack, contextmanager
from dataclasses import asdict
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
from main import configure_private_logging
from report_session import Conversation
from scripts.customer_bulk_cases import bulk_cases
from scripts.customer_eval_cases import synthetic_tools
from scripts.evaluate_customer import (MeteredClient, ObservedAnalysis, fingerprint, judge,
                                       model_client, safe_answer, stamp, write_json)


def case_hash(case):
    """摘要覆盖问题、预期和报告变式，防止题目改动后误用旧结果。"""
    return hashlib.sha256(json.dumps(asdict(case), ensure_ascii=False, sort_keys=True).encode()).hexdigest()


@contextmanager
def output_lock(output, name='writer.lock'):
    """用操作系统文件锁保护一个产物目录；进程异常退出后锁自动释放。

    持锁期间拒绝其他写入者，避免恢复尾行或原子进度文件被并发改坏；锁文件本身保留。
    """
    with (output / name).open('a+b') as handle:
        if not handle.seek(0, 2):
            handle.write(b'\0')
            handle.flush()
        handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == 'nt':
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def load_completed(path, suite):
    """每行是一段完整会话；恢复只接受题库摘要匹配且轮数齐全的记录。

    进程退出留下的末行半截可忽略；正文中的其他损坏须报错，避免静默丢失证据。
    """
    latest = {}
    if not path.exists():
        return latest
    raw = path.read_bytes()
    lines = raw.decode('utf-8', errors='replace').splitlines()
    for index, line in enumerate(lines):
        try:
            item = json.loads(line)
        except ValueError:
            if index == len(lines) - 1:
                # 先完整备份，再去掉不可解析的尾行；否则下一次追加会把损坏移到中间。
                backup = path.with_name(path.name + '.' + datetime.now().strftime('%Y%m%d%H%M%S%f') + '.interrupted')
                backup.write_bytes(raw)
                path.write_text('\n'.join(lines[:index]) + ('\n' if index else ''), encoding='utf-8')
                break
            raise ValueError('评测记录中间行损坏') from None
        case = suite.get(item.get('case'))
        if (case and item.get('case_hash') == case_hash(case)
                and len(item.get('rows', [])) == len(case.steps)):
            latest[case.id] = item
    # 完整末行没有换行也可能是中止点，确保后续JSON不拼到上一条记录末尾。
    if path.stat().st_size and not path.read_bytes().endswith(b'\n'):
        with path.open('ab') as handle:
            handle.write(b'\n')
    return latest


def summary(completed, total, version, started, state):
    """只统计每题最新完整会话；历史失败仍保留在追加日志中，不重复凑次数。"""
    rows = [row for item in completed.values() for row in item['rows']]
    seconds = sorted(r['seconds'] for r in rows if r['requests'])
    versions = Counter(item['version'] for item in completed.values())
    errors = Counter(error for row in rows for error in row['errors'])
    return {'updated': stamp(), 'started': started, 'state': state, 'current_version': version,
            'total_cases': total, 'completed_cases': len(completed), 'completed_steps': len(rows),
            'unique_questions': len({r['question'] for r in rows}),
            'passed_steps': sum(not r['errors'] for r in rows), 'failed_steps': sum(bool(r['errors']) for r in rows),
            'requests': sum(r['requests'] for r in rows), 'version_cases': dict(versions),
            'current_version_cases': versions[version],
            'current_version_passed_cases': sum(item['version'] == version and not any(
                r['errors'] for r in item['rows']) for item in completed.values()),
            'version_stable': fingerprint() == version,
            'categories': dict(Counter(item['category'] for item in completed.values())),
            'errors': dict(errors), 'failed_cases': [key for key, item in completed.items() if any(r['errors'] for r in item['rows'])],
            'model_latency_p50': round(statistics.median(seconds), 3) if seconds else None,
            'model_latency_p95': seconds[min(len(seconds) - 1, int(len(seconds) * .95))] if seconds else None,
            'semantic_review': 'pending'}


def run(args):
    """独占产物目录后执行一批；拒绝两个进程同时恢复或追加同一份记录。"""
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with output_lock(output):
        return run_batch(args, output)


def run_batch(args, output):
    """题间并发、题内顺序执行正常会话；网络错误仅记录封闭分类，绝不打印异常正文。"""
    suite = {case.id: case for case in bulk_cases()}
    manifest = [asdict(case) for case in suite.values()]
    write_json(output / 'manifest.json', {'cases': manifest, 'total_cases': len(suite),
               'total_steps': sum(len(case.steps) for case in suite.values()), 'source': 'synthetic_grammar'})
    if args.plan:
        print(json.dumps({'cases': len(suite), 'steps': sum(len(c.steps) for c in suite.values()),
                          'categories': dict(Counter(c.category for c in suite.values()))}, ensure_ascii=False))
        return 0
    configure_private_logging()
    load_dotenv(ROOT / '.env')
    version, started = fingerprint(), stamp()
    path = output / 'answers.jsonl'
    completed = load_completed(path, suite)
    selected = [case for case in suite.values()
                if (not args.only or case.id in args.only.split(','))
                and (case.id not in completed
                     or (args.retry_stale and completed[case.id]['version'] != version)
                     or (args.retry_failed and any(r['errors'] for r in completed[case.id]['rows'])))]
    if args.limit:
        selected = selected[:args.limit]
    run_id = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    lock = threading.Lock()
    finished_this_run = 0

    def evaluate(case):
        """一条日志包含全部追问，便于恢复时原子认定会话已执行；无个人历史持久化。"""
        nonlocal finished_this_run
        rows = []
        with ExitStack() as stack:
            client, provider, model = model_client(stack)
            metered = MeteredClient(client)
            tools = synthetic_tools(case.score, case.unconfirmed_education, case.with_report_date, case.display_rules)
            conversation = Conversation(tools, strategy='analysis')
            conversation.analysis = ObservedAnalysis(tools)
            for index, step in enumerate(case.steps):
                count, draft_count, start = metered.requests, len(metered.drafts), time.monotonic()
                conversation.analysis.failure = ''
                try:
                    answer = conversation.answer(step.question, metered, model)
                except Exception:
                    answer = '评测未完成（固定分类：unexpected）'
                    conversation.analysis.failure = 'unexpected'
                elapsed, answer = round(time.monotonic() - start, 3), safe_answer(answer)
                errors = judge(step, answer, conversation, metered.requests - count, conversation.analysis.failure)
                if elapsed > (90 if step.kind == 'overview' else 60):
                    errors.append('slow_response')
                rows.append({'step': index + 1, 'question': step.question, 'answer': answer,
                             'errors': errors, 'seconds': elapsed, 'requests': metered.requests - count,
                             'request_seconds': metered.request_seconds[count:], 'failure': conversation.analysis.failure,
                             'draft_answers': metered.drafts[draft_count:],
                             'sources': list(conversation.analysis_context.field_refs) if conversation.analysis_context else []})
        item = {'run': run_id, 'time': stamp(), 'version': version, 'case': case.id, 'category': case.category,
                'case_hash': case_hash(case), 'provider': provider, 'model': model, 'rows': rows}
        with lock:
            with path.open('a', encoding='utf-8') as handle:
                handle.write(json.dumps(item, ensure_ascii=False) + '\n')
            completed[case.id] = item
            finished_this_run += 1
            if finished_this_run % 10 == 0 or any(r['errors'] for r in rows):
                write_json(output / 'progress.json', summary(completed, len(suite), version, started, 'running'))
                print(json.dumps({'completed': len(completed), 'case': case.id,
                                  'errors': [e for row in rows for e in row['errors']]}, ensure_ascii=False), flush=True)

    write_json(output / 'progress.json', summary(completed, len(suite), version, started, 'running'))
    # 启动前先验证一次模型配置，防止一万个任务重复因同一缺失配置而失败。
    if selected:
        with ExitStack() as stack:
            model_client(stack)
    pool = ThreadPoolExecutor(max_workers=args.workers)
    futures = [pool.submit(evaluate, case) for case in selected]
    try:
        for future in as_completed(futures):
            future.result()
    except BaseException:
        for future in futures:
            future.cancel()
        pool.shutdown(wait=True, cancel_futures=True)
        write_json(output / 'progress.json', summary(completed, len(suite), version, started, 'interrupted'))
        raise
    else:
        pool.shutdown(wait=True)
    state = 'completed' if len(completed) == len(suite) else 'partial'
    final = summary(completed, len(suite), version, started, state)
    write_json(output / 'progress.json', final)
    write_json(output / (run_id + '-summary.json'), final)
    print(json.dumps(final, ensure_ascii=False), flush=True)
    return int(bool(final['failed_steps']))


NETWORK_FAILURES = frozenset({'timeout', 'connection', 'service'})


def continuation_cases(suite, completed, version, attempts, max_attempts):
    """先覆盖本版本未执行题，再有界复测网络故障；业务失败保留供修复。

    attempts只统计本版本且题目摘要匹配的完整尝试；旧版本的通过不能替代当前版本验证。
    """
    fresh, retries = [], []
    for case in suite.values():
        item = completed.get(case.id)
        if not item or item['version'] != version:
            fresh.append(case)
        elif (any(row.get('failure') in NETWORK_FAILURES for row in item['rows'])
              and attempts[case.id] < max_attempts):
            retries.append(case)
    return fresh + retries


def continuous(args):
    """按小批子进程持续执行，源码变更后重新验证；退避、进程及停止状态单独落盘。

    连续三批至少半数会话出现网络故障时退出并标明service_unavailable；不会继续
    消耗整库请求。只自动重试封闭网络分类，不通过反复碰运气掩盖业务断言失败。
    """
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with output_lock(output, 'runner.lock'):
        return supervise(args, output)


def supervise(args, output):
    """持有续跑锁的监督循环；异常正文不落盘，完整问答由子进程独占追加。"""
    configure_private_logging()
    load_dotenv(ROOT / '.env')
    started, workers, outages, batches = stamp(), args.workers, 0, 0
    suite = {case.id: case for case in bulk_cases()}
    state = {'started': started, 'pid': os.getpid(), 'semantic_review': 'pending'}

    def save(status, **values):
        """runner.json记录监督进程状态；progress.json仍由实际问答进程维护。"""
        state.update(updated=stamp(), state=status, workers=workers, batches=batches, **values)
        write_json(output / 'runner.json', state)

    try:
        while True:
            version = fingerprint()
            with output_lock(output):
                completed = load_completed(output / 'answers.jsonl', suite)
                attempts = Counter()
                path = output / 'answers.jsonl'
                if path.exists():
                    for line in path.read_text(encoding='utf-8').splitlines():
                        item = json.loads(line)
                        case = suite.get(item.get('case'))
                        if (case and item.get('version') == version
                                and item.get('case_hash') == case_hash(case)
                                and len(item.get('rows', [])) == len(case.steps)):
                            attempts[case.id] += 1
            pending = continuation_cases(suite, completed, version, attempts, args.max_network_attempts)
            counts = summary(completed, len(suite), version, started, 'running')
            save('running', current_version=version, completed_cases=len(completed),
                 current_version_cases=counts['current_version_cases'],
                 passed_cases=counts['current_version_passed_cases'], failed_steps=counts['failed_steps'],
                 remaining_cases=len(pending), child_pid=None, retry_in_seconds=0, reason=None)
            if (output / 'stop.request').exists():
                save('stopped')
                return 130
            if not pending:
                failed = bool(counts['failed_steps'])
                save('completed_with_failures' if failed else 'awaiting_semantic_review')
                return int(failed)
            selected = pending[:args.chunk_size]
            command = [sys.executable, '-X', 'utf8', str(Path(__file__).resolve()),
                       '--output', str(output), '--workers', str(workers), '--retry-failed',
                       '--retry-stale', '--only', ','.join(case.id for case in selected)]
            # 子进程只输出固定统计；SDK异常正文丢弃，不写后台日志或下次请求。
            with subprocess.Popen(command, cwd=ROOT, stderr=subprocess.DEVNULL) as child:
                save('running', child_pid=child.pid)
                while child.poll() is None:
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        save('running')
                result = child.returncode
            batches += 1
            if result not in (0, 1):
                save('failed', child_pid=None, reason='batch_failed')
                return 2
            with output_lock(output):
                after = load_completed(output / 'answers.jsonl', suite)
            if any(case.id not in after or after[case.id].get('run') == completed.get(case.id, {}).get('run')
                   for case in selected):
                save('failed', child_pid=None, reason='batch_incomplete')
                return 2
            network = sum(any(row.get('failure') in NETWORK_FAILURES for row in after[case.id]['rows'])
                          for case in selected)
            outages = outages + 1 if network * 2 >= len(selected) else 0
            if outages:
                workers = max(1, workers // 2)
                if outages >= 3:
                    save('service_unavailable', child_pid=None, reason='consecutive_network_failures')
                    return 2
                delay = min(300, args.interval * 2 ** (outages - 1))
                save('backoff', child_pid=None, retry_in_seconds=delay)
                # 最多一秒检查一次停止标记，后台退避也可以及时退出。
                until = time.monotonic() + delay
                while time.monotonic() < until:
                    if (output / 'stop.request').exists():
                        save('stopped')
                        return 130
                    time.sleep(min(1, max(0, until - time.monotonic())))
    except KeyboardInterrupt:
        save('interrupted', child_pid=None)
        return 130
    except Exception:
        save('failed', child_pid=None, reason='runner_error')
        return 2


def main():
    """--plan只生成题库；正常执行使用现有模型额度，默认不重新请求已完成题。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default=str(ROOT / '.eval' / 'bulk-10000'))
    parser.add_argument('--workers', type=int, choices=range(1, 65), default=2)
    parser.add_argument('--limit', type=int, default=0, help='本次最多执行多少个会话；0为所有未完成题')
    parser.add_argument('--only', default='', help='逗号分隔的题目ID')
    parser.add_argument('--retry-failed', action='store_true', help='允许重新执行已有失败记录')
    parser.add_argument('--retry-stale', action='store_true', help='重新执行源码或模型配置版本已变化的旧结果')
    parser.add_argument('--continuous', action='store_true', help='分批常驻续跑全部题目及网络失败题')
    parser.add_argument('--chunk-size', type=int, default=32, help='持续模式每批会话数')
    parser.add_argument('--max-network-attempts', type=int, default=3, help='持续模式同版本网络失败的最大总尝试数')
    parser.add_argument('--interval', type=int, default=60, help='持续模式遇集中网络失败时的起始退避秒数')
    parser.add_argument('--plan', action='store_true', help='只生成题库，不加载模型配置或访问网络')
    args = parser.parse_args()
    if args.limit < 0:
        parser.error('limit不能为负数')
    if min(args.chunk_size, args.max_network_attempts, args.interval) < 1:
        parser.error('批大小、网络尝试次数和退避秒数必须为正数')
    if args.continuous and (args.only or args.limit or args.plan):
        parser.error('持续模式不能与only、limit或plan组合')
    try:
        return continuous(args) if args.continuous else run(args)
    except KeyboardInterrupt:
        return 130
    except Exception:
        print('批量评测中止：请检查配置或记录文件；异常正文不记录。', flush=True)
        return 2


if __name__ == '__main__':
    sys.exit(main())
