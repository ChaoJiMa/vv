# 第 8 题：任务状态更新
#
# 输入数据：下方已提供任务名称、初始完成状态和实际用时。
# 题目要求：先输出初始数据，再复用同名变量将状态改为 True、实际用时改为 45，
# 最后输出更新后的数据。这里只手动改变变量，不需要 if 或函数。
# 目标输出（共六行）：
# 任务： 完成 Python 第一天练习
# 是否完成： False
# 实际用时： 0 分钟
# 任务： 完成 Python 第一天练习
# 是否完成： True
# 实际用时： 45 分钟
#
# 验收：先后状态符合目标；更新的是原来的变量，不是直接打印写死的结果。
# 作答记录（直接在这里填写）：
# 实际输出：待填写。
# 复用了哪些变量、分别如何更新：待填写。
# 小结（助手整理）
# 同一任务先输出「未完成、实际用时 0 分钟」，再次输出时是「已完成、实际用时 45 分钟」。
# 两次展示读取相同的变量，第二次读取更新后的 `completed=True` 和 `spent_minutes=45`。
# 下方为起始代码和你的代码区：
task_name = "完成 Python 第一天练习"
completed = False
spent_minutes = 0

# TODO：输出初始状态。
print(task_name)
print('是否完成:', completed)
print(f"实际用时{spent_minutes}分钟")
# TODO：复用变量更新状态和实际用时。
completed = True
spent_minutes = 45
# TODO：输出更新后的状态。
print(task_name)
print("是否完成:", completed)
print(f"实际用时{spent_minutes}分钟")
