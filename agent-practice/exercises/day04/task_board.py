# 综合练习：多任务看板（组合 D4–D6，复查状态判断）
#
# 适合你当前的练法：你已有函数、输入、条件和循环经验，主要补 Python 写法。
# 本题从一个任务扩展到多个任务，不重复写一套输入校验题。
# 预计 60–90 分钟，可分两次做；题目、语法提示、作答和代码都在本文件。
# 启动（在 D:\vv\agent-practice 中）：py -3 -B exercises\day04\task_board.py
# 没有 py 时：python -B exercises\day04\task_board.py
# 下方包含题目数据和当前实现，按验收用例核对输出。
#
# Python 语法速查（先看需要的部分，以下不是本题完整答案）：
# 1. 列表对应 JS 数组，字典对应按键取值的对象：
#    books = [{"name": "Python 手册", "read": False}]
#    books[0] 是第一个字典；books[0]["name"] 取书名，不用 books[0].name。
#    len(books) 对应 JS 的 books.length；books.append(新字典) 添加元素。
# 2. Python 字典字段名和布尔值：用 "read" 等字符串键，用 True / False。
#    原数据中 done 已经是 bool，不再从 y/n 转换。
# 3. 遍历列表的元素：
#    for book in books:                 # 对应 JS for (const book of books)
#        print(book["name"])
#    不要写 for book in len(books)；len() 返回整数，不能直接这样遍历。
# 4. if not book["read"]: 判断未读；and / or / not 对应 && / || / !。
#    total += value 对应 total = total + value；统计变量要在遍历前初始化。
# 5. f-string：文字写在花括号外，表达式写在里面：
#    name = "Python 手册"
#    price = 30
#    print(f"书名：{name}，价格：{price}")
#    print(f"书名：{book['name']}")      # 外双引号、字段键用单引号，兼容 Python 3.10
#    不用 "价格：" + price 拼字符串和整数。
# 6. 空列表 [] 可以直接遍历，循环执行零次；先置零的统计应自然保留为 0。
#    本题先用普通 for / if；暂不要求列表推导式、filter、map 或类。
#
# 输入数据：下方 tasks 是唯一的数据来源，保证字段齐全、id 唯一、时间合法。
# planned_minutes 是正整数，spent_minutes 是非负整数，done 是 bool。
# 本题不要求坏数据校验、文件读写、排序、数据库或第三方依赖。
#
# 任务要求：
# 1. 读取一次展示模式，去掉两端空白并忽略大小写：
#    all = 全部；todo = 未完成；done = 已完成。
#    无效模式提示“模式只能为 all、todo 或 done”，结束程序，不展示看板。
# 2. 按 tasks 原顺序展示符合模式的任务。每行包含：
#    id、title、预计分钟数、实际分钟数、状态、剩余或超出分钟数。
#    不能修改原 tasks 或任务的 done 值来完成筛选。
# 3. 为每个展示的任务计算状态（复查旧题第6项）：
#    done 为 True → 已完成，优先于时间比较；
#    done 为 False 且实际 < 预计 → 进行中；
#    done 为 False 且实际 == 预计 → 已到预计时间；
#    done 为 False 且实际 > 预计 → 超时未完成。
#    时间差按你上题的逻辑：非负显示剩余，负数显示超出多少，不显示负剩余。
# 4. 汇总“当前展示的任务”：数量、预计总分钟数、实际总分钟数。
#    todo 模式不能把隐藏的已完成任务算进统计。不要写死总数或按固定索引处理三项。
# 5. 没有匹配任务时显示“暂无符合条件的任务”，三个汇总值都是 0。
#    tasks = [] 也要正常运行，不访问 tasks[0] 等不存在的位置。
#
# 默认数据 + all 的目标示例（文字标签清楚即可，不逐字卡冒号和空格）：
# 任务看板（all）
# 1 | 学习 Python | 预计60 | 实际25 | 进行中 | 剩余35分钟
# 2 | 整理笔记   | 预计30 | 实际30 | 已完成 | 剩余0分钟
# 3 | 编写练习   | 预计20 | 实际35 | 超时未完成 | 超出15分钟
# 当前任务数：3
# 预计总时间：110分钟
# 实际总时间：90分钟
#
# 验收用例（每次独立启动；改测试数据前保留默认值，测完恢复）：
# A. 默认数据，输入 " ALL " → 展示1/2/3，状态如上，统计3 / 110 / 90。
# B. 默认数据，输入 todo → 仅1/3，统计2 / 80 / 60。
# C. 默认数据，输入 done → 仅2，统计1 / 30 / 30。
# D. tasks 临时改为 []，输入 all → 暂无符合条件的任务，统计0 / 0 / 0。
# E. 所有 done 临时改为 True，输入 todo → 无匹配，统计0 / 0 / 0。
# F. 默认数据，输入 other → 明确错误，无看板、无汇总。
# G. 只将任务2实际时间改为45，任务3实际时间改为20，输入 all →
#    任务2仍“已完成”并超出15；任务3“已到预计时间”且剩余0；统计3 / 110 / 90。
# H. 默认数据追加 {"id": 4, "title": "复盘", "planned_minutes": 10,
#    "spent_minutes": 0, "done": False}，输入 todo → 展示1/3/4，统计3 / 90 / 60。
#    追加后仍正确说明没有把逻辑写死为三项；筛选前后原数据应一致。
#
# 建议拆分：
# 第一段：先实现 all 模式的遍历、时间差和四种状态。
# 第二段：加入模式筛选、汇总和空结果处理，验证 A–H。
# 可从第一段就提交检查，不用等全部完成；不要导入会交互运行的旧 task_info.py。
# 函数可以用，但本题不强制拆函数，也不预填具体筛选或统计算法。
#
# 作答记录（直接在这里写，已运行输出不用逐行抄）：
# 已完成到哪一步：待填写。
# 一个实际遇到的语法问题及修正原因：待填写。
# 已验证哪些用例、还有哪个卡点：待填写。
# 简短面试表达：为什么 todo 模式的总时间不能直接统计整个 tasks？待填写。
# 如参考提示或答案，记下位置；之后用新的数据变式复测，不要求背标准术语。
# 小结（助手整理）
# A–H 功能用例通过。默认输入 `todo` 时只显示任务 1 和 3，共 2 项，预计 80 分钟，实际 60 分钟。
# `getlist()` 每调用一次就会打印匹配的任务。之前汇总时再次调用这个函数，导致任务重复打印。
# 保存一次筛选结果为 `matched_tasks`，再传给 `total()`，合计就对应当前显示的任务。
# Python 用 `len(tasks)` 求列表长度，枚举的中文显示文字通过 `status.value` 取得。
#
# ===== 输入数据与代码区：保留作答，在下方实现 =====

import sys
from enum import Enum

# 一个任务用字典描述，多项任务按顺序保存在列表中。
tasks = [
    {"id": 1, "title": "学习 Python", "planned_minutes": 60, "spent_minutes": 25, "done": False},
    {"id": 2, "title": "整理笔记", "planned_minutes": 30, "spent_minutes": 30, "done": True},
    {"id": 3, "title": "编写练习", "planned_minutes": 20, "spent_minutes": 35, "done": False},
]

view = input("展示模式（all / todo / done）：").strip().lower()
if view not in ("all", "todo", "done"):
    print("模式只能为 all、todo 或 done")
    sys.exit(1)


def getlist(data, value):
    # 按展示模式筛选任务并打印匹配项，返回同一批任务供汇总使用。
    l = []
    for task in data:
        if value == "todo" and task["done"]:
            continue
        if value == "done" and not task["done"]:
            continue
        l.append(task)
        status = setdone(task["done"], task["planned_minutes"], task["spent_minutes"])
        time = timedif(task['planned_minutes'], task['spent_minutes'])
        print(f"{task['id']} {task['title']} {task['planned_minutes']} {task['spent_minutes']} {status.value} {time}")
    return l


class TaskStatus(Enum):
    # 枚举值是看板上的状态文字，任务的 done 字段仍用布尔值表示是否完成。
    COMPLETED = "已完成"
    IN_PROGRESS = "进行中"
    AT_LIMIT = "已到预计时间"
    OVERDUE = "超时未完成"


def setdone(data, planned_minutes, spent_minutes):
    # data 是任务的完成标记。先判断完成，再用时间关系返回状态枚举。
    if data:
        return TaskStatus.COMPLETED
    if planned_minutes > spent_minutes:
        return TaskStatus.IN_PROGRESS
    if planned_minutes == spent_minutes:
        return TaskStatus.AT_LIMIT
    if planned_minutes < spent_minutes:
        return TaskStatus.OVERDUE


def timedif(planned_minutes, spent_minutes):
    # 根据预计和实际分钟数返回展示文字，超出时显示正数。
    if planned_minutes > spent_minutes:
        return f"剩余{planned_minutes - spent_minutes}分钟"
    if planned_minutes == spent_minutes:
        return f"剩余0分钟"
    if planned_minutes < spent_minutes:
        return f"超出{spent_minutes - planned_minutes}分钟"


def total(data):
    # data 是已展示的任务列表，只统计这批任务，空列表打印零值。
    planned_minutes = 0
    spent_minutes = 0
    for task in data:
        planned_minutes += task['planned_minutes']
        spent_minutes += task['spent_minutes']
    print(f"合计任务数:{len(data)} 预计总时间:{planned_minutes} 实际总时间:{spent_minutes}")


matched_tasks = getlist(tasks, view)

if not matched_tasks:
    print("暂无符合条件的任务")

total(matched_tasks)
