# D1：变量、基本类型与输出

本单元包含 8 道练习和 1 个项目任务，按当前计划选择题目，不要求一次全部完成。
直接打开对应 `.py` 文件，题目要求、目标输出、验收和作答区都在同一个文件中。
只使用变量、基本类型、运算和 `print()`，暂不涉及函数、字典和 Agent 工具调用。

## 语法速查

```python
# 定义变量不需要 let 或 const
name = "小明"
age = 25
height = 1.75
is_student = False

print("姓名：", name)
print(type(age))  # <class 'int'>

total = 20 + 10
remaining = 60 - total
print(remaining)
```

| Python | 含义 | 前端对照 |
| --- | --- | --- |
| `str` | 字符串 | JS 的 string |
| `int` | 整数 | JS 普通数字没有单独的 int 类型 |
| `float` | 浮点数 | JS 普通数字也使用浮点数表示 |
| `bool` | 布尔值 | JS 的 boolean；Python 写 `True` / `False` |
| `# 注释` | 单行注释 | JS 的 `// 注释` |
| `print()` | 向终端输出 | 类似 `console.log()` |

`print("预计：", 30, "分钟")` 会把多个内容用空格隔开。
运算可使用 `+`、`-`、`*`、`/`，今天主要用加减法。

## 题目导航

完整单题要求以对应文件顶部的中文注释为准，直接在下方编写代码。
预测、类型判断、解释和运行核对统一填写在对应题目文件的“作答记录”注释区，每题已列出具体填写项。

| 题目 | 文件 |
| --- | --- |
| 第 1 题：预测输出 | [q01_output.py](q01_output.py) |
| 第 2 题：识别类型 | [q02_types.py](q02_types.py) |
| 第 3 题：给变量赋值 | [q03_values.py](q03_values.py) |
| 第 4 题：修复前端写法 | [q04_fix.py](q04_fix.py) |
| 第 5 题：计算预计时长 | [q05_total.py](q05_total.py) |
| 第 6 题：变量更新 | [q06_state.py](q06_state.py) |
| 第 7 题：两项任务摘要 | [q07_summary.py](q07_summary.py) |
| 第 8 题：任务状态更新 | [q08_update.py](q08_update.py) |
| 综合挑战：交互式任务概览（提前组合 D2/D3） | [task_info.py](task_info.py) |

## 作答与提交

第 1、2 题已有作答已原样复制到对应题目文件的注释中，后续直接在那里修正。
重复的独立作答文件已清理；批改直接读取题目文件中的代码和全部作答。
做完后可以直接说“检查我完成的第几题”，助手会查看本地代码与注释。

具体先做哪些题见 [当前计划](../../docs/current-plan.md)；调整文件布局不代表完成题目或通过验收。
