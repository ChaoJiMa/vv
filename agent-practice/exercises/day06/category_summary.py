# D6 练习：按分类统计剩余任务
#
# 场景：你想知道各类待办还有几条、预计还要花多少分钟。
# 在 summarize_pending(tasks) 里作答。跑通样例后，再用新数据复测。预计 25–35 分钟。
#
# 题目要求
# 1. 只统计 done 为 False 的任务。某个分类如果只有已完成任务，结果里不出现这个分类。
# 2. 按 category 分组。缺少 category 或 category 去掉首尾空格后为空，都归为「未分类」。
#    数据保证 minutes 是整数、done 是布尔值，存在的 category 都是字符串。
# 3. 返回一个字典，键是分类名称，值是包含 count 和 total_minutes 的字典。
#    count 是该分类的待办条数，total_minutes 是这些待办任务的预计分钟数之和。
# 4. 每次调用按传入的列表重新统计，保留原任务数据。没有待办时返回 {}。
#    主程序已写好，会打印函数结果。字典键的顺序不影响验收。
#
# 语法提示
# - task.get("category", "") 类似 JS 的 task.category ?? ""，用在本题给定的数据类型上。
# - text.strip() 类似 JS 的 text.trim()，去掉首尾空格。
# - 字典允许用变量作为键。若 name = "学习"，summary[name] 就是读取「学习」对应的值。
#
# 验收用例
# A. 用下方默认数据运行，返回：
#    {
#        "学习": {"count": 2, "total_minutes": 45},
#        "工作": {"count": 1, "total_minutes": 40},
#        "未分类": {"count": 1, "total_minutes": 10},
#    }
# B. 临时加一条待办 {"title": "复查需求", "category": "  工作  ", "minutes": 15, "done": False}。
#    「工作」应变成 2 条、55 分钟，其他分类的结果和 A 一样。
# C. 临时把 tasks 改成 []，返回 {}。再试只有已完成任务的列表，也返回 {}。
#    改完后恢复默认数据。
#
# 运行（在 agent-practice 目录）：py -3 -B exercises\day06\category_summary.py
# 也可以用：python -B exercises\day06\category_summary.py
#
# 作答记录（直接填在本文件）
# A–C 实际结果：
# 用自己的话解释：遍历到第二条「学习」待办时，如何把它计入第一次的结果？
#
# 小结（助手整理）
# - 分步写法先取出待办分类，再逐类计数和计算分钟数，最后把两项统计组装成字典。
#   用 dict.fromkeys() 去重时，会保留每个分类第一次出现的顺序。
#   getcategory() 和 gettime() 职责分开，便于逐步检查。需要单独查某类的
#   待办总时长时，可以直接复用 gettime()。分类较多时，每类都会重新扫描数据。
# - 参考写法在同一轮循环里按分类同时累加条数和分钟数。第一次遇到某类时先初始化，
#   之后遇到同类任务就更新已有记录。适合一次拿到所有分类的汇总。
# - 两种写法的 A–C、空白分类和新增分类用例均实测通过。

tasks = [
    {"title": "练习函数", "category": "学习", "minutes": 30, "done": False},
    {"title": "整理需求", "category": "工作", "minutes": 40, "done": False},
    {"title": "复习字典", "category": "学习", "minutes": 15, "done": False},
    {"title": "整理笔记", "category": "学习", "minutes": 60, "done": True},
    {"title": "回复消息", "minutes": 10, "done": False},
    {"title": "买文具", "category": "生活", "minutes": 20, "done": True},
]


def summarize_pending(tasks):
    """接收任务列表，返回每个待办分类的条数和预计总分钟数。"""
    obj = {}
    categories = getcategory(tasks)
    for category in dict.fromkeys(categories):
        obj[category] = {
            'count': categories.count(category),
            'total_minutes': gettime(tasks, category)
        }
    return obj


def getcategory(tasks):
    """返回待办的分类名列表，保留重复项供后续计数。"""
    categories = []
    for task in tasks:
        # 跳过已完成
        if task["done"]:
            continue
        # 分类
        category = task.get("category", "").strip() or "未分类"
        # 添加进数组
        categories.append(category)
    return categories


def gettime(tasks, target_category):
    """返回指定分类中未完成任务的预计总分钟数。"""
    total = 0
    for task in tasks:
        if task["done"]:
            continue
        category = task.get("category", "").strip() or "未分类"
        if category == target_category:
            total += task["minutes"]
    return total


def summarize_pending_single_pass(tasks):
    """参考写法：遍历一次任务，返回各待办分类的条数与预计总分钟数。"""
    summary = {}

    for task in tasks:
        if task["done"]:
            continue

        category = task.get("category", "").strip() or "未分类"
        # 首次遇到分类时创建计数记录，随后取出同一份记录继续累加。
        stats = summary.setdefault(category, {"count": 0, "total_minutes": 0})
        stats["count"] += 1
        stats["total_minutes"] += task["minutes"]

    return summary


if __name__ == "__main__":
    print(summarize_pending(tasks))
