# 项目开发文档

开发规范位于根目录 [AGENTS.md](../AGENTS.md) 和
[project-dev skill](../.agents/skills/project-dev/SKILL.md)。本次及后续开发统一记录需求、
改动、接口影响和实际验证结果；同一需求继续更新原记录。

## 项目公共规范

| 文档 | 内容 |
|---|---|
| [Git 提交与合并规范](conventions/git-workflow.md) | 全项目提交格式、暂存快照检查、PR/MR 完整差异及分支合并门禁 |
| [统一提交规范开发记录](development/project/2026-10-30-git-workflow.md) | 规范来源、接入入口、验证结果及执行边界 |

## 报告助手

| 文档 | 内容 |
|---|---|
| [运行说明](../agent-learning/README.md) | 启动、配置、本地问答和现有功能限制 |
| [现有能力整理](development/agent-learning/2026-10-30-local-assistant-baseline.md) | 本地字段查询、模型消息限制与加密历史的实现快照 |
| [Java 登录开发记录](development/agent-learning/2026-10-30-java-login.md) | 登录封装、测试服务实连结果、报告重选提示排查和离线验证 |
| [多版本报告接入记录](development/agent-learning/2026-10-30-multiple-report-themes.md) | 12 种报告主题的目录匹配、字段与规则隔离、路径支持及验证边界 |
| [自然问法与本地追问记录](development/agent-learning/2026-10-30-natural-questions.md) | 口语和字段别名识别、总次数口径、时间追问、候选选择与83项回归 |
| [AI分析策略与隐私出口](development/agent-learning/2026-10-30-ai-analysis-strategy.md) | AI理解及工具选择、统计事实投影、整体分析超时、短编号及固定协议文本重合误拦截、预算收尾与本地兜底、离线及实连验证 |
| [报告模型数据范围](development/agent-learning/2026-10-31-report-data-scope.md) | 仅过滤姓名、证件、手机号、地址，开放其他报告文字与脱敏明细、字段说明及离线验证 |
| [整份报告按模块总结](development/agent-learning/2026-10-31-module-overview.md) | 从报告首模块顺序归纳、独立整体总结、完整字段投影、取消字段清单及验证范围 |
| [小贝客服与解读话术](development/agent-learning/2026-10-30-xiaobei-service-conversation.md) | 客服主题、隐藏内部字段与依据、分数及当前模板区间解释、离线与Sol验证 |
| [客服持续模拟评测](development/agent-learning/2026-10-31-customer-evaluation.md) | 共享规则、逐题记录、校验误判及页面显示修正、简明客服与明细归纳、同版本连续验证 |
| [万次不同问题模拟](development/agent-learning/2026-11-02-ten-thousand-evaluation.md) | 原版10000会话、精准回答修复；自然表达、职责整理与账号授权，复查486项离线通过及35轮差分一致，分版本实连范围见记录 |
| [DeepSeek与GPT-6.1 Sol接入](development/agent-learning/2026-10-31-deepseek-provider.md) | 厂商切换、独立密钥、自定义网关、Responses与JSON兼容、Sol在线验证 |
| [注释和规范建设记录](development/agent-learning/2026-10-30-comments-and-skill.md) | 中文注释、项目级 skill 及验证证据 |
| [Java 接口对接说明](interfaces/agent-learning/java-business-api.md) | 验证码、登录、报告列表及正文接口契约 |
| [Python模型接入说明](interfaces/agent-learning/model-providers.md) | 智谱、DeepSeek与Sol的配置、HTTP协议、工具调用及失败回退 |

## 历史资料

已有邻里互助设计与计划仍保存在 `superpowers/specs/` 和 `superpowers/plans/`，保留原路径。
报告助手的已有开发记录仅覆盖已核实内容，没有追溯补写其他项目的历史实现或验证结论。

## 邻里互助

- [会话隔离与图片生命周期](development/neighbor-help/2026-11-03-session-images.md)
- [图片绑定及读取协议](interfaces/neighbor-help/images.md)
- [前端体验优化记录](development/neighbor-help/2026-11-03-frontend-ux.md)
- [前端导航与浏览恢复约定](interfaces/neighbor-help/frontend-navigation.md)
- [注册、邀请码与住址展示约定](interfaces/neighbor-help/registration.md)
- [简洁线性图标调整](development/neighbor-help/2026-11-03-linear-icons.md)
- [原布局下的糖果胶质视觉调整](development/neighbor-help/2026-11-03-gummy-theme.md)
