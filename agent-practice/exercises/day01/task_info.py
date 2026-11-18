import sys

# 综合挑战：交互式任务概览（D1 验收，提前组合 D2/D3）
#
# 为什么升级：
# 你已写完 8 道基础题，变量计算和更新在变式检查中正确。
# 本题用真实输入、类型转换和分支验证迁移能力，不再重复练固定数据输出。
# 下方旧骨架保留给你改造，不包含完整解答。
#
# 新语法速查（先理解，再独立做下面的任务）：
# 1. input("提示文字") 类似浏览器 prompt，返回 str，而不是数字。
#    示例：age_text = input("年龄：")
#          age = int(age_text)
# 2. text.strip() 去掉字符串两端空白；text.lower() 转为小写。
# 3. f"年龄：{age}" 类似 JS 模板字符串，花括号中可写表达式。
# 4. Python 条件不用 JS 的花括号，冒号后用缩进：
#    if temperature > 30:
#        print("炎热")
#    elif temperature == 30:
#        print("临界值")
#    else:
#        print("未超过阈值")
# 5. 比较用 ==、>、<；组合条件用 and / or，取反用 not。
#    bool("n") 仍为 True，因为它是非空字符串；不要这样解析完成状态。
#
# 题目要求：
# 1. 用 input() 依次读取四项：任务标题、预计分钟数、实际分钟数、完成标记。
#    分类 category 保持“Agent 开发”，不需要额外输入。
# 2. 标题去除两端空白；两个分钟数字符串转换为 int。
#    本轮保证时间输入是 int() 可转换的整数字符串，不要求处理 abc 等文本。
# 3. 完成标记去除两端空白并忽略大小写：y 表示 True，n 表示 False。
#    其他标记提示“完成标记只能为 y 或 n”，不输出正常任务概览。
# 4. 空白标题、预计分钟数 <= 0、实际分钟数 < 0 时分别给出明确错误提示，
#    不输出正常任务概览。每个错误用例只放一处错误，不要求同时列举多个错误。
# 5. 有效输入计算 remaining_minutes = 预计用时 - 实际用时。
#    非负时展示剩余分钟数；为负时展示超出预计多少分钟，不能显示负的剩余时间。
# 6. 状态规则：
#    - 已完成优先显示“已完成”，即使实际用时超出预计。
#    - 未完成且实际用时小于预计：显示“进行中”。
#    - 未完成且实际用时等于预计：显示“已到预计时间”。
#    - 未完成且实际用时大于预计：显示“超时未完成”。
# 7. 有效输入打印标题、分类、预计/实际时间、剩余或超出时间、布尔完成值、状态。
#    信息及计算正确、标签清楚即可，不逐字符检查中文冒号和空格。
#
# 目标示例：
# 输入依次为“  学习 Python 基础  ”、“60”、“25”、“ n ”时：
# 任务概览
# 任务名称：学习 Python 基础
# 所属分类：Agent 开发
# 预计用时：60 分钟
# 实际用时：25 分钟
# 剩余时间：35 分钟
# 是否完成：False
# 状态：进行中
#
# 验收用例（四项按输入顺序列出，可手动重复运行，不需要先学循环）：
# A. “  学习 Python 基础  ” / 60 / 25 / “ n ” → 去掉标题空白，剩余 35，False，进行中。
# B. 学习 / 60 / 75 / n → 超出 15，False，超时未完成。
# C. 学习 / 60 / 75 / Y → 超出 15，True，已完成（检查分支优先级）。
# D. 学习 / 60 / 60 / n → 剩余 0，False，已到预计时间。
# E. “   ” / 60 / 25 / n → 标题错误提示，无正常概览。
# F. 学习 / 0 / 25 / n → 预计时间错误提示，无正常概览。
# G. 学习 / 60 / -1 / n → 实际时间错误提示，无正常概览。
# H. 学习 / 60 / 25 / maybe → 完成标记错误提示，无正常概览。
# 每组都从输入计算，不为用例写死答案；无需函数、列表、字典、依赖或模型。
# 语法不熟可看上方速查；业务分支和转换由你自己组合，不预填答案。
#
# 作答记录（直接在本文件填写，不用重复抄所有输出）：
# 最容易出错的一个边界及原因：待填写。
# 预计时间和完成状态分别怎样从字符串转换：待填写。
# 卡点或借助了哪些提示：可选填写。
#
# 下方保留旧版起点：把常量赋值改成读取输入，再完成校验、分支与输出。
# 下方为起始代码和你的代码区：
task_title = "学习 Python 基础"
category = "Agent 开发"
planned_minutes = 60
spent_minutes = 25
completed = False

# TODO：输出其他任务信息。使用变量，不要写死计算结果。
# 1. 用 input() 依次读取四项：任务标题、预计分钟数、实际分钟数、完成标记。
#    分类 category 保持“Agent 开发”，不需要额外输入。
task_title = input('任务标题:').strip()


def nottitle(data):
    # 标题经过空白清理，空字符串时提示并结束本次运行。
    if not data:
        print('任务标题不能为空')
        sys.exit()


nottitle(task_title)
planned_minutes = int(input('预计分钟数:'))
spent_minutes = int(input('实际分钟数:'))


def minutes(desc, data, minimum):
    # desc 用于错误提示，data 和 minimum 均为分钟数，返回是否达到下限。
    if data < minimum:
        print(f"{desc}需要大于等于{minimum}")
        return False
    return True


planned_valid = minutes('预计分钟数', planned_minutes, 1)
spent_valid = minutes('实际分钟数', spent_minutes, 0)

if not planned_valid or not spent_valid:
    sys.exit()

while True:
    completed = input("完成标记：").strip()
    if completed.lower() == 'y':
        completed = True
        print(completed)
        break
    if completed.lower() == 'n':
        completed = False
        print(completed)
        break
    else:
        print("完成标记只能为 y 或 n")
remaining_minutes = planned_minutes - spent_minutes


def remaining(data):
    # data 是预计减实际的分钟数，负差值取绝对值作为超出的分钟数。
    if data >= 0:
        print(f"剩余分钟数：{data}")
    else:
        print(f"超出预计分钟数：{abs(data)}")


remaining(remaining_minutes)
# TODO：计算剩余时间。
print("任务概览")
# 2. 标题去除两端空白；两个分钟数字符串转换为 int。
#    本轮保证时间输入是 int() 可转换的整数字符串，不要求处理 abc 等文本。
# 3. 完成标记去除两端空白并忽略大小写：y 表示 True，n 表示 False。
#    其他标记提示“完成标记只能为 y 或 n”，不输出正常任务概览。
# 4. 空白标题、预计分钟数 <= 0、实际分钟数 < 0 时分别给出明确错误提示，
#    不输出正常任务概览。每个错误用例只放一处错误，不要求同时列举多个错误。
# 5. 有效输入计算 remaining_minutes = 预计用时 - 实际用时。
#    非负时展示剩余分钟数；为负时展示超出预计多少分钟，不能显示负的剩余时间。
