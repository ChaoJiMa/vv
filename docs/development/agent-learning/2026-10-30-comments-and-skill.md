# 详细中文注释与项目级开发规范

- 日期：2026-10-30。
- 范围：报告助手 Python 注释、根目录开发规范 skill、开发与接口文档。
- 状态：已完成，本轮离线回归、代码结构检查及文档校验均通过。

## 需求

用户明确继续调用 Java 现有接口，要求代码注释详细、每次开发有文档记录，
并提供开发规范 skill；进一步明确规范应为项目级，放在工作区最外层。
用户提供 `D:\skill-repo` 作为可参考资料。

## 方案与改动

规范源文件位于根目录 `.agents/skills/project-dev/`，由根目录 `AGENTS.md` 引用；
不安装为用户全局 skill。根目录 `docs/` 统一存放开发记录与接口文档。

| 位置 | 内容 |
|---|---|
| `AGENTS.md` | 项目级入口，约定开发记录、接口文档、中文注释和验证留档 |
| `.agents/skills/project-dev/SKILL.md` | 开发流程、文档同步、详细注释、验证和交付要求 |
| `references/records.md` | 开发记录及接口文档最小内容与归档方式 |
| `references/report-assistant.md` | 按需加载的报告助手职责与数据处理约束 |
| `docs/README.md` | 文档索引，保留原有邻里互助历史资料位置 |
| `docs/development/agent-learning/` | 补录本地助手能力、Java 登录开发和本次规范建设 |
| `docs/interfaces/agent-learning/java-business-api.md` | 四个 Java 接口的参数位置、凭证、响应及验证范围 |

本次补充 9 个 Python 文件的中文模块、类、方法及关键分支说明：
`main.py`、`report_auth.py`、`report_http.py`、`report_api.py`、`report_session.py`、
`report_privacy.py`、`report_tools.py`、`local_history.py`、`scripts/import_report_fields.py`。
注释解释调用顺序、Java/Python 职责、字段及 token 语义、异常处理与资源释放。

参考 `D:\skill-repo` 中 `backend/bugfix` 的根因定位、`backend/code-style` 的注释与范围控制、
`backend/backend-release-docs` 的契约核实和同功能持续维护、`frontend/frontend-change` 的项目适配思路。
采用适合当前项目的内容；Java 专属分层、发布命令及独立任务评审门禁未移植到本项目规范。

## 验证结果

以下检查在本轮注释与规范建设完成后实际执行，未复用之前的通过结论。

| 检查 | 命令或方式 | 实际结果 |
|---|---|---|
| 离线回归 | 在 `agent-learning/` 执行 `.\.venv\Scripts\python.exe -m unittest discover -s tests -v` | 44 项通过，0.409 秒；使用虚构数据和内存 HTTP |
| Python 结构对比 | 修改前后均解析 AST，移除模块、类、函数文档字符串后比较结构摘要 | 9 个 Python 文件一致，业务语法结构未变；文档字符串元数据按需求更新 |
| Skill 校验 | 使用系统 Python 的 UTF-8 模式执行 `skill-creator` 自带 `quick_validate.py`，目标为根目录 `.agents/skills/project-dev` | 输出 `Skill is valid!` |
| 文档和文件检查 | 逐项检查本次 20 个文件的行末空白、未完成模板及 18 个本地 Markdown 链接 | 全部通过，子项目临时 skill 空目录已移除 |
| 当前范围差异检查 | `git diff --check -- AGENTS.md .agents docs/README.md docs/development/agent-learning docs/interfaces/agent-learning agent-learning` | 通过；新增未跟踪文件另由上项逐文件检查覆盖 |

曾执行全仓 `git diff --check`，发现其他任务已有的 `neighbor-help/worker/schema.sql:208` 文件末尾空行；
本次未修改该文件，随后限定本次范围检查。没有把全仓检查写成通过。

## 使用与边界

后续修改先读取根目录 `AGENTS.md`，按其中链接加载项目 skill，也可显式使用 `$project-dev`。
当前记录不授权推送、合并或发布。本轮不改变 Java 接口调用架构，不重复实连测试服务。
