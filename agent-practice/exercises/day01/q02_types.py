# 第 2 题：识别类型
#
# 题目要求：
# 1. 先判断下方四个变量的类型，在本文件的“作答记录”中填写 Python 类型名。
# 2. 在 TODO 处补上四条 print(type(...))，分别核对四个变量。
# 3. 运行本文件，用实际结果检查并修正自己的判断。
# 目标输出：四行类型信息，顺序为 title、duration、progress、completed。
# 验收：判断与实际类型一致，能区分字符串、整数、浮点数和布尔值。
# 本题不预填类型答案，请先自己判断。
#
# 作答记录（直接在这里填写，原判断已保留）：
# title：string
# duration：number int
# progress：number int
# completed：boolean
# 运行后的核对或修正：str int float bool。
# 实际类型输出（按变量顺序填写）：str int float bool。
# 简短复测：先判断 40、"40"、40.0 的类型，再运行核对：int str float。
#
# 下方为起始代码和你的代码区：
title = "整理笔记"
duration = 45
progress = 0.5
completed = False

# TODO：使用 print(type(...)) 查看上述四个变量。
print(type(title))
# <class 'str'>
print(type(duration))
# <class 'int'>
print(type(progress))
# <class 'float'>
print(type(completed))
# <class 'bool'>
