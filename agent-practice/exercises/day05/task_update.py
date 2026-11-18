# D5 练习：按任务编号标记完成
#
# 你要做一件事：输入任务编号，找到对应任务，把它标记为已完成。
# 例如输入 101，任务「学习 Python」的 done 从 False 变成 True，
# 然后终端显示「已标记完成：学习 Python」。数据和输入入口已经放在下方。
# 在文件底部的 mark_done 函数中作答，预计 20–30 分钟。
#
# 题目要求
# 1. 输入是一个整数编号，和任务字典中的 id 比较。列表数据保证字段齐全，编号唯一。
# 2. 找到未完成的任务时，只把这一条任务的 done 改为 True，返回「已标记完成：任务标题」。
# 3. 任务已完成时，返回「任务已经完成：任务标题」。
# 4. 整个列表找不到编号时，返回「未找到任务：编号」。空列表也按找不到处理。
# 终端入口会打印函数的返回值。修改发生在这次运行的内存中，重启后恢复初始数据。
#
# 验收用例（每组从默认数据重新运行，中文标签清楚即可）
# A. 输入 101 → 已标记完成：学习 Python。只把编号 101 的 done 设为 True。
# B. 输入 205 → 任务已经完成：整理笔记。所有任务字段保持原值。
# C. 输入 999 → 未找到任务：999。所有任务字段保持原值。
# D. 临时把 tasks 改成 [] 再输入 101 → 未找到任务：101。试完恢复默认数据。
# E. 输入 309 → 已标记完成：编写练习。前两项保持原值。
#
# 两条语法提示
# - task["id"] 对应 JS 的 task.id。id 是任务编号。比如 309 对应列表里的第三项。
# - task["done"] = True 会把当前字典的 done 改成布尔值 True。
#   想一想：如果第一条任务的 id 不匹配，接下来应该看看谁？
#
# 运行（在 agent-practice 目录中）：py -3 -B exercises\day05\task_update.py
# 也可以使用：python -B exercises\day05\task_update.py
#
# 作答记录（直接写在本文件里）
# A–E 实际结果及 done 的变化：
# 用自己的话解释：什么时候可以判断任务编号不存在？
# 小结（助手整理）
# A–E 均通过：101 和 309 标记完成，205 提示已经完成，999 和空列表提示未找到。
# `continue` 跳过当前行，后面的任务仍有机会匹配。找到时用 `return` 结束函数，
# 因此能走到循环后的返回语句，就表示整个列表都没有找到该编号。
# 先读 `done` 再决定是否更新。对同一任务连续操作两次，只在第一次写入 `done=True`。

tasks = [
    {"id": 101, "title": "学习 Python", "done": False},
    {"id": 205, "title": "整理笔记", "done": True},
    {"id": 309, "title": "编写练习", "done": False},
]


def mark_done(data, task_id):
    """按整数编号更新任务字典列表中的匹配项，返回终端提示文字。"""
    for task in data:
        # 跳过不匹配id
        if task['id'] != task_id:
            continue
        if task['id'] == task_id:
            return f"{getdesc(task)} {task['title']}"
    return f"未找到任务 {task_id} 所有任务字段保持原值"


def getdesc(data):
    """标记未完成的任务，返回相应的状态提示文字。"""
    if not data['done']:
        data['done'] = True
        return "已标记完成"
    else:
        return "任务已经完成"


if __name__ == "__main__":
    requested_id = int(input("任务编号："))
    print(mark_done(tasks, requested_id))
