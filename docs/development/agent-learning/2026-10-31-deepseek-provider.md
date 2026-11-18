# 小贝客服接入 DeepSeek 与 GPT-6.1 Sol

- 日期：2026-10-31。
- 范围：agent-learning 的模型客户端、启动配置、离线验证及使用说明。
- 状态：模型适配、Sol兼容网关配置与虚构报告在线验证已完成；真实用户报告及生产环境未验收。

## 需求与原因

用户要求将当前Codex中的GPT-6.1 Sol用于AI客服，并同时接入DeepSeek。原终端只固定连接智谱。本次补充独立模型出口与明确切换，不借用Codex的登录状态；用户提供的DeepSeek凭据只保存在Git忽略的本机配置中，不写入代码、文档、测试或历史。

## 方案与改动

增加`REPORT_MODEL_PROVIDER=zhipu|deepseek|openai`，默认保持智谱兼容；DeepSeek使用`DEEPSEEK_API_KEY`与`DEEPSEEK_MODEL`，Sol使用`OPENAI_API_KEY`与`OPENAI_MODEL=gpt-6.1-sol`。初次接入时各固定官方出口，本机选择已实连的DeepSeek；后续按用户要求增加显式OpenAI兼容网关配置，现状见下方同日补充。始终不继承自定义鉴权头或其他厂商密钥。

`report_model.py`新增两种适配器：DeepSeek通过OpenAI SDK兼容chat/completions并关闭思考；Sol通过官方Responses API，以low推理、8192 tokens、90秒及store=false运行。Sol每次从已校验问题与本地工具执行摘要重新推理，不续接原生响应链或回传推理项，具体取舍见[模型协议](../../interfaces/agent-learning/model-providers.md)。响应中的思维链和其他外部工具结果不进入会话。

`main.py`按厂商取独立密钥并显示当前厂商与型号，关闭SDK敏感日志；`report_analysis.py`识别两个SDK的固定失败分类。自动重试、环境代理和重定向均关闭；模型失败只回退本地，不跨厂商转发。业务身份、统计事实投影、封闭客服知识和加密历史保持原有边界。同步requirements、环境示例、README、接口和文档索引，没有提交、推送或部署。

## 初次接入验证（历史）

| 检查 | 命令或方式 | 实际结果 |
|---|---|---|
| 依赖 | 本项目虚拟环境执行`python -m pip install -r requirements.txt`、`python -m pip check` | 安装完成，无依赖冲突 |
| 离线回归 | `.\.venv\Scripts\python.exe -m unittest discover -s tests -q` | 157项通过，包括11项新增厂商测试；不读取本机.env，不连接外网 |
| SDK内存协议 | 真实OpenAI SDK与httpx.MockTransport | DeepSeek与Sol完整虚构工具循环成功；固定官方地址、密钥隔离、JSON参数、异常分类、无重试、拒答/截断、推理不回传及隐私问题零请求通过 |
| DeepSeek实连 | 通用人工客服问句；虚构报告的统计分析 | 首次客服路由1次、统计分析6次完成受控查询与带来源结论；请求头隔离调整后另1次客服路由成功，共8次请求，没有读取或发送真实报告、Java凭据或历史 |
| Sol实连 | 只检查本机.env与当前环境是否配置OPENAI_API_KEY，不输出内容 | 未配置，因此未调用OpenAI线上API，不能声称账号可用性或在线工具质量已验收 |
| 文件检查 | Python AST、文档本地链接、凭据格式扫描、尾部空白、`git diff --check`及`git check-ignore` | 本次11个源码/文档文件检查通过，无密钥格式；本机.env受Git忽略，当前运行厂商仍为DeepSeek |

## 使用与限制

### 同日补充：客服切换为Sol

用户明确要求“客服模型切换为6.1sol”。本轮仅检查配置是否存在，不输出凭据；确认本机.env已有独立OPENAI_API_KEY，原有效厂商为deepseek。将被Git忽略的本机配置改为 `REPORT_EXTERNAL_MODEL=on`、`REPORT_MODEL_PROVIDER=openai`、`OPENAI_MODEL=gpt-6.1-sol`，复用已有Responses适配。模型启动时读取配置，因此旧终端需要重启；客服固定短句仍走原有本地知识。

此补充不更改共享默认配置、其他厂商凭据、代理或出口规则，不提交或部署。读取官方GPT-6.1 Sol模型说明核对目标名称，保持用户指定的 `gpt-6.1-sol`，没有替换型号；运行配置仍使用已实现的Responses适配。

| 检查 | 命令或方式 | 实际结果 |
|---|---|---|
| 本机运行配置 | dotenv只读核对非敏感选择项；`git check-ignore .env` | external=on、provider=openai、model=gpt-6.1-sol；.env仍被忽略；原有OpenAI和DeepSeek凭据保持不变，当前进程没有覆盖这些选择项的环境变量 |
| 厂商适配回归 | `.\.venv\Scripts\python.exe -X utf8 -m unittest discover -s tests -p test_model_provider.py -q` | 本轮11项通过，使用虚构凭据与内存HTTP，不连接真实服务 |
| Sol在线语义客服 | 仅使用本地构造的虚构报告，向OpenAI发送通用人工联系问句 | 1次请求出现APIConnectionError，未收到有效模型答复；停止后续虚构报告请求，无自动重试，未读取Java账号或真实报告 |
| 无凭据网络检查 | trust_env=false，GET固定官方 `/v1/models`，10秒连接超时 | ConnectTimeout，未收到HTTP状态；当前进程未配置HTTP(S)/ALL代理环境变量。这只证明本轮直连失败，不能推断key无效或模型无权限 |
| 文档与配置静态检查 | 配置选择项、Git忽略、修改文档的链接和空白检查 | 有效配置核对一致，.env仍被Git忽略；5份文档、33个本地链接、尾部空白与密钥字面量检查通过 |

本次切换时需重启`agent-learning/main.py`读取Sol配置；当时官方地址直连失败，模型分支回退本地，不自动转回DeepSeek。用户随后指定兼容网关，已通过下节的在线验证，当前使用该网关。密钥仅保存在本机.env中，本项目不代为管理厂商密钥。

当前仍是单用户终端原型。后续网关验证覆盖Sol客服路由、模块总结与具体指标工具循环，使用虚构报告，不能代表真实报告或生产环境验收。`store=false`不构成服务商零留存承诺。本次验证未发送真实个人报告、业务凭据，也未增加客服办理或外部写操作。

### 同日补充：接入用户指定OpenAI兼容网关

用户提供自有HTTP API基础地址，要求作为Sol的请求地址。此前代码固定官方出口，忽略OPENAI_BASE_URL，因此仅修改本机配置不足以生效。本轮增加显式基础地址参数和终端配置入口：未设置沿用官方地址，配置时使用指定网关，仍只用独立OPENAI_API_KEY，不继承自定义鉴权头或业务凭据，不自动重定向或转发其他厂商。

地址仅允许HTTP(S)、合法主机与端口，拒绝内嵌凭据、查询串、片段及控制字符；在业务登录前检查。继续使用Responses协议，先验证网关是否兼容，再进行虚构报告测试；真实用户报告不参与验证。网关实际地址仅配置在被Git忽略的.env，公共示例使用虚构域名。

普通Responses请求成功，但初始JSON路由返回400；确认网关需要在user输入中显式提示JSON后，适配器仅在JSON模式首个user输入前插入固定消息 `Return a JSON object.`，原问题、投影及调用方消息不变。非JSON工具请求不插入；保留本地严格校验，不因400自动重试或降级协议。自定义地址启动时显示“OpenAI兼容网关”，避免误称官方出口。

| 检查 | 命令或方式 | 实际结果 |
|---|---|---|
| 可达性与模型列表 | 不附凭据及使用独立模型凭据GET网关 `/v1/models` | 分别返回401与200；鉴权后的列表包含 `gpt-6.1-sol` |
| 客服及整份报告实连 | 最终适配器、虚构两模块报告；语义客服路由及模块小结后独立整体总结 | 客服1次、模块及整体总结2次，共3次请求成功并通过本地校验 |
| 具体指标实连 | 最终适配器、虚构字段与本地工具 | 4次请求、3次工具调用完成，事实来源、最终答案及会话上下文校验通过 |
| 最终离线回归 | `.\.venv\Scripts\python.exe -X utf8 -m unittest discover -s tests -q` | 194项通过，包括5项新增网关/JSON兼容性测试；最新启动网关提示断言也通过 |
| 最终静态检查 | 变更源码AST、文件空白、密钥字面量、本地Markdown链接及有效配置/Git忽略 | 9份文件检查通过，3个Python文件AST解析通过，33个本地链接有效；当前有效配置为Sol与指定网关，独立模型凭据存在且.env仍被忽略，未输出凭据 |

在线验证只加载本机模型配置并构造虚构报告，没有Java登录、真实报告或Codex凭据访问。实际网关地址和凭据仅在被Git忽略的.env中维护；当前HTTP网关传输不加密。配置在启动时加载，旧终端需退出后重新运行。
