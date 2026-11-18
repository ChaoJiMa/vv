# D7 综合练习：批量执行任务指令
#
# 场景：将来 Agent 会给你的程序一条条操作指令。先用手写字典模拟这些指令，
# 把它们按顺序作用在同一份任务列表上。预计 50–70 分钟，可以分两段写。
#
# 第一步：实现 execute_command(tasks, command)，一次处理一条指令。
# - {"action": "add", "id": 309, "title": "阅读资料", "minutes": 20, "category": "学习"}
#   新增一条待办。id 和 minutes 须为正整数，title 须为字符串，且去掉首尾空格后不能为空。
#   category 可省略，省略或全为空格时填「未分类」。如果提供 category，其值须为字符串。
#   参数通过检查后，如果 id 已存在，返回 duplicate_id。成功时保存清理后的标题和分类，
#   并将 done 初始化为 False。参数不合法时返回 invalid_args。
# - {"action": "complete", "id": 101}
#   id 须为正整数。找到时将任务设为完成，已经完成时也返回成功，数据值保持原样。
#   编号不存在返回 not_found，参数不合法返回 invalid_args。
# - {"action": "summary"}
#   调用已经导入的 summarize_pending(tasks)，把 D6 的分类统计用作本次结果。
#   统计仅包含当时的待办，所以同一批指令的前后两次汇总可以不同。
# - 其他 action（含缺失）返回 unknown_action。失败时保持任务数据原样。
#
# 返回约定
#   成功时返回 {"ok": True, "code": "ok", "data": ...}。
#   add 和 complete 的 data 为 None，summary 的 data 是 D6 返回的字典。
#   失败时返回 {"ok": False, "code": 对应错误码, "data": None}。
#
# 第二步：实现 execute_batch(tasks, commands)，按原顺序调用单条执行函数，
# 返回每条指令的结果组成的列表。失败也有一条结果，后续指令继续处理。
# 前面成功操作造成的更新会继续生效。给空指令列表时返回 []。
# 题面给出的 tasks 字段齐全、编号唯一，commands 的每一项都是字典。
#
# 验收
# A. 运行下方默认批次，按顺序得到：
#    1. ok，data 为 {"学习": {"count": 1, "total_minutes": 25}}。
#    2. ok，新增编号 309，标题为「阅读资料」。
#    3. duplicate_id，编号 309 的标题和时间都保持原样。
#    4. not_found，任务数据保持原样。
#    5. ok，编号 101 标记完成。
#    6. unknown_action，后续还能执行。
#    7. ok，data 为 {"学习": {"count": 1, "total_minutes": 20}}。
#    最后检查第 1 条结果仍是 25 分钟，说明它保留了当时的统计。
# B. 单独试 add 空白标题和 complete 缺少 id，都应返回 invalid_args，任务数据保持原样。
#    对同一条任务连续执行两次 complete，两次都成功，任务保持完成。
# C. 用空任务列表运行一次 summary，然后 add 一条未填 category 的任务，再 summary。
#    第一次 data 是 {}，第二次在「未分类」中看到新增待办。空指令列表返回 []。
#
# 在 D:\vv 打开本文件可直接运行。终端也可用 python -B .\agent-practice\exercises\day07\task_commands.py。
# 在 agent-practice 目录下可用 python -B -m exercises.day07.task_commands。
#
# 作答记录（直接写在本文件）
# A–C 实际结果：
# 面试表达：如果批次的第二条指令失败，为什么第一条的修改仍生效，第三条也会执行？
#
# 小结（助手整理）
# A–C 通过。默认批次前后两次汇总分别是 25 和 20 分钟，每条指令都有对应结果。
# execute_command() 根据动作选择处理函数，execute_batch() 传入同一份任务列表并按顺序收集结果。
# 先校验编号，再查找和修改。未知或缺失动作以失败结果返回，批次可以继续执行。

from pathlib import Path
import sys

# 直接运行文件时，Python 从 day07 目录查找模块。补上练习项目根目录以复用 D6。
if __name__ == "__main__" and not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# D6 已提供按分类统计待办的函数，这里直接用来处理 summary 指令。
from exercises.day06.category_summary import summarize_pending

# tasks 是被操作的任务列表。初始只有编号 101 仍是待办，预计 25 分钟。
tasks = [
    {"id": 101, "title": "练习函数", "minutes": 25, "category": "学习", "done": False},
    {"id": 205, "title": "整理需求", "minutes": 40, "category": "工作", "done": True},
]

# commands 是按顺序执行的指令列表。两次 summary 用来对照修改前后的待办。
commands = [
    {"action": "summary"},
    {"action": "add", "id": 309, "title": "  阅读资料  ", "minutes": 20, "category": " 学习 "},
    {"action": "add", "id": 309, "title": "重复编号", "minutes": 99},
    {"action": "complete", "id": 999},
    {"action": "complete", "id": 101},
    {"action": "archive"},
    {"action": "summary"},
]


def execute_command(tasks, command):
    """处理一条字典格式的任务指令，返回含 ok、code 和 data 的结果。"""
    # 缺少 action 时 get() 返回 None，下面的兜底会把它作为未知指令处理。
    action = command.get("action")
    # 汇总只读当前列表，并把 D6 的统计字典放进结果的 data 字段。
    if action == 'summary':
        return {'ok': True, 'code': 'ok', 'data': summarize_pending(tasks)}
    # 检查编号是否重复，通过后新增一条待办。
    elif action == 'add':
        return addtask(tasks, command)
    # 按编号找到任务，把它标记为已完成。
    elif action == 'complete':
        return completetask(tasks, command)
    # 三种操作都未匹配时，返回失败结果供批量函数收集。
    return {"ok": False, "code": "unknown_action", "data": None}


# 手写汇总版本，接收任务列表并返回各分类的待办条数与分钟数。
def summarytask(data):
    # 每次调用都新建结果字典，使每份结果反映调用时的任务状态。
    summary = {}
    for task in data:
        if task['done']:
            continue
        category = task.get("category", "").strip() or "未分类"
        # 首次遇到分类时创建计数记录，随后取出同一份记录继续累加。
        stats = summary.setdefault(category, {"count": 0, "total_minutes": 0})
        stats["count"] += 1
        stats["total_minutes"] += task["minutes"]
    return summary


# tasks 是当前任务列表，data 是这次 add 指令。成功时直接向 tasks 追加待办。
# 返回 ok、code 和 data 三个字段。新增结果的 data 固定为 None。
def addtask(tasks, data):
    # 用 get() 取值。缺少必填字段会得到 None，分类缺省时用空字符串。
    new_id = data.get("id")
    minutes = data.get("minutes")
    title = data.get("title")
    category = data.get("category", "")
    # 先判断类型，再比较大小或调用 strip()。or 遇到真值就会停止，避免对错误类型做后续操作。
    # type(...) is int 只接受整数类型，避免把 True 或 False 当作编号或分钟数。
    if (
            type(new_id) is not int or new_id <= 0
            or type(minutes) is not int or minutes <= 0
            or not isinstance(title, str) or not title.strip()
            or not isinstance(category, str)
    ):
        return {"ok": False, "code": "invalid_args", "data": None}

    # 保存清理后的文字。缺省或全是空格的分类都归为「未分类」。
    title = title.strip()
    category = category.strip() or "未分类"

    # 在整份列表里查重，已完成的任务也占用编号。any() 找到一个匹配项就停止。
    is_duplicate = any(task["id"] == new_id for task in tasks)
    if not is_duplicate:
        # 前面的校验和查重都通过后才写入，新任务从待办状态开始。
        tasks.append({
            "id": new_id,
            "title": title,
            "minutes": minutes,
            "category": category,
            "done": False,
        })
        return {'ok': True, 'code': 'ok', 'data': None}
    if any(task["id"] == new_id for task in tasks):
        return {"ok": False, "code": "duplicate_id", "data": None}


def completetask(tasks, data):
    """从指令 data 读取任务编号，在 tasks 中标记完成，返回操作结果字典。"""
    new_id = data.get("id")
    # 先校验正整数，再查找。这样 101.0 不会匹配编号 101。
    if type(new_id) is not int or new_id <= 0:
        return {"ok": False, "code": "invalid_args", "data": None}

    # next() 取第一个匹配项。取到的是列表里的任务字典，改 done 就会更新原任务。
    task = next((item for item in tasks if item["id"] == new_id), None)
    # 找不到编号时 next() 返回 None，由这里转换成题目规定的失败结果。
    if task is None:
        return {"ok": False, "code": "not_found", "data": None}

    # 找到任务就算成功。已完成时跳过赋值，重复执行也不会再次写入。
    if not task["done"]:
        task["done"] = True
    return {"ok": True, "code": "ok", "data": None}


def execute_batch(tasks, commands):
    """按顺序在同一份任务列表上执行指令，返回对应的结果列表。"""
    # l 按指令顺序收集结果，成功和失败各占一项。
    l = []
    for command in commands:
        # 每次都传入同一份 tasks，让后续指令看到前面成功操作带来的变化。
        l.append(execute_command(tasks, command))
    return l


# 入口保护让其他模块可以导入函数。作为程序启动时，执行并逐条打印样例结果。
if __name__ == "__main__":
    executes = execute_batch(tasks, commands)
    for execute in executes:
        print(execute)
