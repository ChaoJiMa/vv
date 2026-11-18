# Agent Practice

前端开发转 Python / Agent 开发的独立练习项目。

建议放置位置：`D:\vv\agent-practice`。

## 先看这三处

1. [完整课程](docs/course.md)：8 个阶段、D1–D56 每课的学习内容、项目任务和验收标准。编号是主题顺序，不要求按自然日完成。
2. [学习流程](docs/study-workflow.md)：每次怎样学习、作答、求助、批改以及按实际表现调整下一步。
3. [当前计划](docs/current-plan.md)：打开本项目后实际要做的下一题和验收条件。

完整课程包含 56 个主题，具体练习随学习进度展开。当前练习是[按分类统计剩余任务](exercises/day06/category_summary.py)。

## 从当前任务开始

当前练习使用 Python 标准库。项目建议使用 Python 3.10 或更高版本。

在 PowerShell 中进入项目：

```powershell
Set-Location D:\vv\agent-practice
py -3 --version
py -3 -B exercises\day06\category_summary.py
```

如果电脑没有 `py` 命令，但有 `python` 命令，可以使用：

```powershell
python --version
python -B exercises\day06\category_summary.py
```

直接打开对应的 `.py` 文件：顶部中文注释包含本题要求、目标输出和验收条件，下方就是代码区。
预测输出、类型判断、解释和运行结果统一填写在同一文件的“作答记录”注释中，每题都有具体待填写项；代码写在下方代码区。
在 `summarize_pending()` 中按类别合计待办条数和预计分钟数，再核对缺少分类、空列表和全部已完成的情况。

`exercises/day01/task_info.py` 中的第 1–5 项已有运行证据，第 6–7 项对应能力在多任务看板中复查。看板的 A–H 用例已通过，小结见同文件的作答记录。

## 项目内容

| 位置 | 用途 |
| --- | --- |
| `exercises/day01/` | D1 讲义、8 道练习及同文件作答、项目任务 |
| `exercises/day04/task_board.py` | 多任务看板：状态、筛选与统计 |
| `exercises/day05/task_update.py` | 按编号标记完成 |
| `exercises/day05/task_reopen.py` | 可选复习：按编号撤销完成状态 |
| `exercises/day06/category_summary.py` | 当前练习：按分类统计剩余任务 |
| `docs/course.md` | D1–D56 完整课程：每课知识、任务、验收、阶段成果 |
| `docs/study-workflow.md` | 每次学习、提交、反馈和动态调整的执行流程 |
| `docs/roadmap.md` | 求职导向的 8 阶段、56 个参考主题与调整原则 |
| `docs/feedback.md` | 每次反馈后的验收、进度记录与调整规则 |
| `docs/current-plan.md` | 当前要做什么、如何验收，以及下一步条件 |
| `docs/reviews.md` | 学习反馈与计划调整历史 |
| `progress.json` | 能力、实际进度和学习反馈记录 |
| `project/README.md` | 后续任务助手的阶段成果约定 |

## 后续约定

后续主题沿用 `exercises/day02/`、`exercises/day03/` 等目录名；`day` 仅是编号，不表示必须一天完成一课。
路线依次覆盖 Python、命令行任务管理、后端、全栈联调、模型、工具调用、检索与可靠性、权限及求职作品。D1–D56 是参考主题编号，实际学习可以合并或补练，不要求 8 个自然周完成。

已有编程经验可以加速已掌握的部分，但学习进度按实际代码和验收结果推进。
学习安排按每天约 2–4 小时、工作间隙可中断设计，主要服务转岗求职和面试。先看 [当前计划](docs/current-plan.md)，原始题单可按诊断结果减量，不需要机械完成所有同类题。

在可访问本项目的聊天中，直接说“看下我的进度”或“我做完第几题了，帮我批改并调整下一次计划”即可。助手会读取本地作答，也可以核对你粘贴的代码和运行结果，再更新进度、反馈历史和当前计划；你不需要手工维护 JSON。
每次反馈会说明已掌握内容、卡点、验收依据和下一次安排。已掌握内容通过诊断后压缩，未掌握内容拆小补练；面试表达只围绕已学内容展开。

这些操作在你发起交互时执行，文件不会在后台自动同步；在无法访问本机文件的聊天中，需要提供相关内容，不能直接更新本地记录。

本项目尚未在你的电脑上安装依赖或创建虚拟环境，也不包含任何模型密钥。
