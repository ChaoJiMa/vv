# Python 模型接入协议

- 日期：2026-10-31；2026-11-10补充本应用ChatGPT计划授权。
- 范围：Python 调用外部模型；不新增或修改 Java 业务接口。

## 配置与调用方

2026-11-10结构整理后，`runtime.config.ModelSettings.from_env`统一解析厂商、型号、授权方式、官方/网关地址及显式代理，入口负责加载.env；配置repr排除密钥和代理。`runtime.models.prepare_account/create_model_client`统一装配：main显式允许交互授权并在Java登录前完成，evaluate_customer及bulk默认禁止交互。账号管理入口显式选择OpenAI/ChatGPT授权，不受当前问答厂商影响，切回API Key或其他厂商后仍可管理原会话。敏感日志配置移至runtime.logging，脚本不再导入main。HTTP方法、模型参数、SDK零重试、凭据隔离与退出释放规则均保持。

后续兼容复查：账号管理入口还需显式固定官方base_url，忽略仅属于聊天API Key路线的自定义网关，避免切换网关后注销受阻；ModelSettings的覆盖只由该程序入口传入，普通问答和评测仍校验操作者实际配置，不把账号令牌交给网关。模拟CLI注销回归通过，当前486项离线通过、35轮固定脚本差分一致；本轮不做真实注销或重复推理。上文及后文的3组4轮实连是相应历史源码版本的证据，不代替此小修后的全量或最新实连覆盖。

`main.py` 读取 `REPORT_EXTERNAL_MODEL`，仅 `on` 时创建模型客户端。`REPORT_MODEL_PROVIDER` 默认 `zhipu`，支持 `zhipu`、`deepseek`、`openai`；开启模型时未知值在业务登录前拒绝。API Key路线密钥缺失或型号为空不创建模型连接；ChatGPT账号路线无需API Key，必须完成本应用独立授权。关闭模型时无需任何模型密钥。

| 厂商 | 密钥 | 型号及默认值 | HTTP 出口 |
|---|---|---|---|
| 智谱 | `ZHIPU_API_KEY` | `ZHIPU_MODEL`，默认 `glm-5.3-flash` | `POST https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| DeepSeek | `DEEPSEEK_API_KEY` | `DEEPSEEK_MODEL`，默认 `deepseek-flash` | `POST https://api.deepseek.com/chat/completions` |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL`，默认 `gpt-6.1-sol` | 默认 `POST https://api.openai.com/v1/responses`；可配置兼容网关 |

API Key路线使用所选厂商的 `Authorization: Bearer <模型密钥>`；ChatGPT账号路线使用本应用OAuth access token。模型客户端不读取Java登录token、手机号或验证码，不共享业务客户端的Cookie与请求头。智谱与DeepSeek出口固定；OpenAI仅在API Key模式允许启动配置 `OPENAI_BASE_URL` 指定兼容网关。DeepSeek密钥只发送至DeepSeek。SDK适配器不继承 `OPENAI_CUSTOM_HEADERS`、其他项目的组织/项目头或Codex登录状态。

`OpenAIResponsesClient(api_key, http_client, base_url=...)` 只使用显式地址；省略或空值回退官方基础地址。`main.py`读取 `OPENAI_BASE_URL` 后通过 `openai_base_url()` 校验，再传给客户端；直接构造适配器时不会额外读取环境变量。仅接受HTTP(S)、合法主机与端口，拒绝内嵌凭据、查询串、片段、反斜线、空白及控制字符，清理首尾普通空格与末尾斜线。错误只输出固定说明，在业务登录前终止。基础地址由操作者配置，模型与用户问题不能改变。HTTP按指定地址使用，传输未加密。

## ChatGPT账号授权与订阅额度

本机`OPENAI_AUTH_MODE=chatgpt`使用`integrations.chatgpt_auth.ChatGPTAccount`和`integrations.model.ChatGPTPlanClient`；不读取`OPENAI_API_KEY`或Codex凭据。未配置时兼容旧API Key调用者，显式`api_key`可继续原路线。账号模式在Java登录前校验官方基础地址，并完成本应用浏览器授权；Java业务登录、报告选择与token没有变化。此模式用于当前Windows本地原型，远程或付费托管资格仍需另行确认。

| 步骤 | 方法与端点 | 参数位置与校验 |
|---|---|---|
| 浏览器授权 | GET `https://auth.openai.com/api/accounts/authorize` | 查询参数：首次`client_id=dynamic_agent_client`与固定应用名，后续复用签发client_id；稳定`ext_agent_host_id`、随机state/nonce、S256 PKCE、scope、resource及精确loopback redirect_uri |
| 回调 | GET `http://127.0.0.1:<临时端口>/auth/callback` | 检查Host、单值参数及一次性state；动态注册必须返回签发client_id，重新授权禁止替换client_id；拒绝、超时或错误不交换code |
| 换取令牌 | POST `https://auth.openai.com/api/accounts/oauth/token` | 表单：authorization_code、签发client_id、code、原code_verifier/redirect_uri和resource；不用client secret |
| OIDC校验 | GET `https://auth.openai.com/.well-known/openid-configuration`及其固定官方JWKS | 校验签名、issuer/audience、exp/iat/sub与nonce；重新授权/刷新返回身份须匹配已选注册；不信任未验证JWT身份 |
| 刷新 | POST上述token端点 | 表单：refresh_token、原client_id、grant_type=refresh_token、resource；不重发scope。SQLite事务串行读取与轮换，整组加密替换，不重试 |
| 注销 | POST发现文档中的官方revocation_endpoint | 表单：token、token_type_hint=refresh_token、client_id；HTTP200确认，其他结果标记未确认，仍清本机令牌，保留注册与host ID |
| 推理 | POST `https://api.openai.com/v1/responses` | Authorization只使用本应用OAuth access token，必须已授予`chatgpt.tokens.use.direct`和`resource.invoke`；官方HTTPS出口固定 |

请求scope为`openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`，resource为`https://api.openai.com/v1`。本机随机账号选择页仅监听127.0.0.1，不记录请求URL或授权码。300秒有界等待；身份校验与订阅权限成功后才启用账号，权限未授予保留注册并禁止推理。凭据和host映射经Windows DPAPI加密存入本应用独立SQLite，无明文备用文件；后台评测不打开浏览器。账号管理脚本仅用于本机维护，不作为客户问答命令展示。

账号推理使用`store=false, stream=true`，input为消息数组，system转developer，本地函数schema放入`report_assistant` namespace；移除预览不支持的max_output_tokens，其余引用/隐私/数值检查和工具预算保持。流只接受完整`response.completed`，失败、断流、未知工具namespace或未完成函数不执行；SDK零重试，原30/90秒预算及4096事件/2000000字节读取上限生效。流式服务失败映射固定SDK服务错误，接入已有回退和评测保护，不输出远端错误正文。无服务端输出硬上限，因此客户端限制不能保证服务端额度精确封顶。API Key路线仍沿用下述非流式协议，不自动混用。

官方依据：[注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[账号与会话](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)。真实账号是否具备计划权限及所选模型访问能力，以本人授权和实际完整请求结果为准；离线测试不能证明。

2026-11-10本人完成授权后，本应用gpt-6.1-sol固定无报告短句取得完整响应，授权验证进程正常退出且无stderr；无需API项目充值或API Key回退即可完成该次请求。随后同版本74d0f3125547be42运行3组虚构案例4轮问答，12次请求全部成功通过自动检查并逐轮开发复核：客服语义路由1次、模块/整体总结3次、两个周期的指标与追问各4次（各含3个受控函数工具）。单轮耗时6.141至28.313秒；这些是端到端回合耗时，不能当作每次模型请求延迟或线上吞吐基准。程序semantic_review仍为pending，未做全量或真实Java报告验收，未读取任何个人报告或Codex缓存。证据位于.eval/chatgpt-account-20261110/的独立relogin及smoke目录，同一开发记录说明具体范围。

## DeepSeek 参数与响应

`report_assistant.integrations.model.DeepSeekClient` 将 `chat.completions.create` 的受控参数交给官方 OpenAI SDK。请求 JSON 包含 `model`、`messages`、`stream=false`、`thinking={"type":"disabled"}`；具体问题使用 `max_tokens=1800`、SDK `timeout=30.0`，整份报告的模块小结及整体总结使用8192、90秒。timeout为网络选项，不进入JSON。路由及无工具的结论传 `response_format={"type":"json_object"}`；工具阶段另传 `tools` 和 `tool_choice="auto"`。

最小结构示例（全部为虚构值）：

```json
{
  "model": "deepseek-flash",
  "messages": [{"role": "user", "content": "请协助说明服务办理方式"}],
  "stream": false,
  "thinking": {"type": "disabled"},
  "max_tokens": 1800
}
```

示例仅说明协议结构；实际请求在消息中附加程序固定的系统约束。HTTP 成功后，调用方读取 `choices[0].finish_reason` 及 `choices[0].message.content/tool_calls`；空 choices、截断或过滤不视为完整回答。模型工具名、参数、来源及回答仍由原有策略校验，HTTP 200 不等于报告分析成功。

DeepSeek 思考模式需要不同的上下文处理，本适配器明确拒绝开启；不转发 `reasoning_content` 或模型原始响应。客服主题由本地固定知识生成回复，报告继续经过既有个人信息过滤与事实投影，详见 [问答协议](java-business-api.md)。

整份报告按当前模板顺序分批总结，每次JSON请求只附本批模块的脱敏事实；最后一次请求只附通过本地校验的小结和引用，不重发原始报告或旧聊天。每批最多8个模块、256个字段、100000字符，最多32批加1次整体总结；需要语义路由时再加1次，总上限34次。具体指标问答仍为原有7次请求预算。Sol沿用下述Responses适配，模块流程不使用函数调用或响应续接。

2026-11-19更新整体总结协议。汇总请求的模块小结仅含 `module_ref`、`name` 和已核验 `text`。`key_facts` 使用 `module_ref` 标识所属小结。模型返回 `text` 和 `module_refs`，程序将所选模块绑定到其小结已经通过校验的字段来源，重复模块引用去重。缺少模块引用、格式无效或引用本轮未核验模块时，程序保留已核验的模块小结，丢弃汇总草稿，并在现有私有诊断记录汇总阶段及固定原因。这类汇总引用回退沿用现有请求预算，正常汇总仍须通过数字、范围、来源和正文校验。

全部已登记事实缺失、为空或展示未确认的小结只输出本地人工核实指引。此类小结保留于客户模块列表，其引用与字段不进入整体总结请求或可用来源。若已读取的小结均需人工核实，省略整体总结请求。可确认的结果（包括明确的零和空记录列表）仍参与总结。

已登记的失信案件履行字段在明细结构校验通过后，可以将带固定字段前缀、单个句末句号或已确认同义表达的完整状态归一到客服使用的状态词。数字、掩码、问句和复合说明保留原有未识别分类。履行分类日志使用同一规则。小结中明确指向履行的核实套话可用同模块已读事实局部替换，替换后继续核对原有数字、来源和范围。

报告问答的引用用于内部检查，用户只看到结果及解释，不追加字段清单、已读未读范围或统一免责声明。已核实的主评分事实可附presentation，提供当前页面分数、等级、区间和客服说明；具体规则及数据结构见[问答协议](java-business-api.md)。不同厂商共用该本地校验与展示逻辑，不由模型猜测分档或照抄代码规则。

2026-11-02补充本地校验：数字、百分比、完整日期和明确滚动周期分别核对。周期沿用既有本地别名（例如近1年等同近12个月、近1月等同近30天），不能借周期数字声称报告条数，也不将自然月替换为滚动周期。“手机号在网时长/时间/运营商”等固定指标短语允许提问；实际号码、已知私人值及其他个人信息标签仍查原文，字段过滤规则保持原约束。追问改换周期时重新读取来源，不复述未引用的旧周期数字。

2026-11-18补充结构化时长校验。已投影且实际引用的对象及列表可提供具名时长角色，值须为完整年/月时长，列表各行须提供一致值和边界。对象直接字段使用明确的中文时长标签，`duration` 键只在外层自身具名为时长时绑定外层指标。总结继承已展示小结与原角色的交集。维护诊断使用同一来源提取规则，沿用既有加密格式。遇到无法核实的时长，模块提示词要求省略该表述并概括其他已确认事实。

2026-11-19补充。已登记的履行列表事实可携带 `detail_coverage`，取值为 `no_records`（空列表）、`unreported`（有记录但全空）、`partial`（部分提供）或 `complete`（全部提供）。前两种事实状态为 `empty`，后两种为 `provided` 并保留明确逐条位置和值。手机号检测按已核实规则投影为“一致”或“不一致”，无实际检测值时保留缺失状态。申请小结采用本模块已核验的实际统计结果纠正明确的笼统缺失分句，新增展示值使用有效的同窗口引用，整体总结按已展示小结校验。相关验证见[开发记录](../../development/agent-learning/2026-11-19-overview-result-coverage.md)。

## GPT-6.1 Sol 的 Responses 适配

`OpenAIResponsesClient` 把现有受控消息转换为 `input`，固定传 `model=gpt-6.1-sol`（默认配置）、`reasoning={"effort":"low"}`、`max_output_tokens=8192`、`stream=false`、`store=false`。网络超时尊重调用方的SDK选项：路由及具体问题每次30秒，整份报告的模块小结与整体总结每次90秒；未传timeout时默认90秒。此为逐请求网络预算，不是整轮问答总时限，timeout不进入JSON。不发送不受支持的 `thinking`、`max_tokens` 或 `temperature`。路由与最终无工具结论使用 `text.format.type=json_object`；函数定义转换为 Responses 的平铺格式，设置 `strict=true` 和 `tool_choice=auto`。

JSON模式在首个user输入前插入程序固定消息 `Return a JSON object.`，使兼容网关能识别格式要求；原问题和投影JSON保持原样，调用方列表不被修改，不增加工具权限或引入网关回包。非JSON的工具阶段不插入该提示。网关初测普通请求成功而原JSON路由返回400，加入固定输入提示后路由和完整模块总结通过；运行时不会收到400后自动重试或关闭JSON校验。

原生 Responses 工具续接需要保留推理项。本项目不保留或回传推理内容，因此每个请求独立推理：把此前经本地检查并执行的调用重建为 assistant 普通 JSON 消息 `executed_tool_calls`，结果重建为 user 普通 JSON 消息 `executed_tool_result`。这些消息只含程序生成引用、已批准参数和受控结果；不是 `function_call_output`，不引用 `previous_response_id`，不发送模型原始 output、响应ID、明文或加密 reasoning item。当前请求仍通过原生函数工具请求下一次查询或提交结论。其真实语义稳定性与额外推理成本需要在线评估。

适配器读取 `status=completed` 的响应，只提取 `message` 中的 `output_text` 及 `function_call` 的 `call_id/name/arguments`。空输出、非completed状态、服务错误或拒答回到原有不完整回答/本地查询路径。思维链不进入返回的兼容消息、后续请求或本地历史；本地仍负责工具预算、统计投影、来源与数字校验。`store=false` 是响应存储设置，不代表服务商零留存保证。

## 失败与生命周期

HTTP 客户端关闭环境代理和重定向，SDK `max_retries=0`。超时、连接错误及 HTTP 服务错误映射为内部固定类别，对客户仅显示未完成提示；异常正文不会显示、写入历史或重新发送。不向其他厂商自动转发请求。`ExitStack` 在结束、提前退出或异常时关闭 SDK 与传输连接。

### Python 本地失败诊断（不是新增模型或 Java 接口）

`Conversation` 在模型、路由、工具、来源及回答校验失败时，先调用 `HistoryStore.append_diagnostic`，写入当前 Windows 用户 DPAPI 加密的 SQLite 独立 `diagnostics` 表。新记录为 v2，仅含 UTC 时间、封闭 `reason`、实际执行范围 `route`、可选的 `OverviewValidationError` 固定标签与 `code/stage/batch/position/subreason`、模型服务错误的整数 `status_code`。`subreason` 仅对已知时长或范围失败使用封闭代码，其他失败为 `null`；旧 v1 记录没有此字段，读取时不推断历史子原因。语义路由请求失败记为 `routing`；纯“分析每个模块”直接归入整份报告，模型选整体分析后即使本地关键词未识别，也记实际的 `full_report` 分支。`reason=service` 的 401、429、5xx 可据状态码区分。所选模块回退的结构值占位、投影拒绝和超出预览上限另记固定类别；本地回退处理抛出异常时记 `local_processing`，同一轮可有多条诊断事件。不保存原始 SDK 异常、响应正文、URL、模型草稿、用户问题、答案或报告绑定值。客户只收到未完成提示或经本地核实的回退内容；`/history` 只读取原问答表。维护脚本 `scripts/inspect_failure_diagnostics.py` 使用只读连接解密展示固定诊断类别及已知子原因，写入失败时本轮停止。具体的 focused 回答校验目前只归类为 `answer`，尚不能从日志直接定位到每条自然语言断言；旧会话失败也不会自动补记。

2026-11-16 使用虚构报告、临时 DPAPI 数据库和内存 HTTP 完成 609 项离线回归；本轮没有请求真实模型或 Java 报告正文。

2026-11-17补充：诊断读写均严格要求非时长失败的 `subreason=null`，时长失败必须使用固定字符串子码。年份期间在模块及整体总结阶段均需完整绑定具名指标；整体总结仅按已展示小结及其来源组核对原样区间，不追加原报告年份。验证记录见 [每个模块分析失败修复](../../development/agent-learning/2026-11-17-each-module-analysis-failure.md)。

## 验证范围

2026-10-31初次接入时，新增真实OpenAI SDK加内存HTTP测试，覆盖两个固定官方出口、Sol Responses参数与推理丢弃、JSON与工具协议、完整虚构报告分析、隐私问题零请求、401/429/500/302、超时、连接失败及无自动重试，157项离线回归通过。DeepSeek已实连客服路由及虚构报告；当时未配置独立OpenAI API key，Sol仅完成内存协议测试。

同日用户进一步要求客服切换为Sol，本机运行配置已设为 `openai/gpt-6.1-sol`，独立OpenAI key已存在；重跑11项厂商适配测试通过。实际语义客服请求出现连接失败，无凭据的固定官方地址连通性检查同样ConnectTimeout；未收到HTTP响应，无法据此确认key有效性或模型访问权限，未继续虚构报告请求。未读取用户真实报告，未更改HTTP出口、代理策略或自动转给其他厂商。实际验证细节见 [开发记录](../../development/agent-learning/2026-10-31-deepseek-provider.md)。

同日后续按用户给定兼容网关配置 `OPENAI_BASE_URL`，网关鉴权与Sol型号检查通过。修复JSON输入提示兼容性后，最终语义客服路由与虚构报告模块小结、整体总结共3次请求通过本地校验；具体指标问答另以4次请求、3次工具调用完成并通过校验。194项离线回归通过，包括地址参数校验、HTTP网关、重定向与失败不换出口、凭据隔离及JSON输入完整性。实际网关地址只在本机.env中维护，未读取真实报告或调用Java业务接口。

同日进一步调整客服展示后，207项离线回归通过；以虚构69.5分报告实连Sol网关，5次请求完成问答并通过来源、展示分数、等级和客服正文检查，没有读取真实报告。后续本地文案补充与等级标签限制以最终离线回归确认，详见[客服表达记录](../../development/agent-learning/2026-10-30-xiaobei-service-conversation.md)。

2026-11-18补充：目录指代或位置选择覆盖当前全部模块时，失败诊断与客户回退均按 `full_report` 处理；整份分析失败不发布局部预览，不产生预览截断或结构值占位降级事件。只有真实模块子集继续限量预览。该行为不改变中文时长或其他来源校验的通过条件。

2026-11-18详细诊断扩展：带有`validation.evidence`的记录使用v3，其他新记录继续v2，读取兼容v1/v2/v3。证据含`request_count/elapsed_ms/retry_used/attempts`；最多2条attempt，每条提供固定阶段、批次、位置、分类和可选observation。observation只含字符/来源计数、规范化统计周期、来源类型/状态及受限时长角色（月数、边界、单位、中文或数字写法、同指标及同值匹配），不接收任意文本。最多12条来源、12个回答时长、每来源12个时长，超量标记truncated；读写两端共用白名单校验。该字段仅用于本机维护，不进入客户回答、历史展示或模型请求，也不增加模型纠错次数。实现与验证见[私有诊断记录](../../development/agent-learning/2026-11-16-private-failure-diagnostics.md)。

2026-11-19 增加本地 `module_availability` 事件，使用 v4 加密记录。整份或所选范围成功生成模块小结后，记录有缺口的模块。每轮最多一条，`availability` 保存模板版本、最多96个模块的所选范围位置、已登记模块编号、容器状态、登记字段数、字段读取与展示状态计数，以及未支持展示规则计数。每模块最多检查256项。独立模块容器只在登记路径同属该数字模块根时检查。来源与展示各自计数，可以发现字段缺失时页面仍显示默认值，也可以发现已有值但无法展示。记录只含固定状态和统计元数据。维护脚本兼容 v1 至 v4。该事件沿用独立加密诊断事务，在保存问答前写入。

带有履行证据的 `module_availability` 记录使用 v5。模块行可附 `performance`，其中 `human_review` 表示该模块已展示小结是否提到人工客服，`fields` 保存已读取的登记履行字段诊断。每个字段含 `source/result/coverage/rows/truncated`，分别为固定的取值状态、展示状态、明细覆盖、分型计数和截断标记。每字段只统计前256条投影后的明细，覆盖状态仍按实际完整列表判定。已填但不在业务展示词表中的内容按类型计数。读写共用结构校验，维护工具兼容 v1 至 v5。

带有 `restriction_dates` 的 `module_availability` 记录使用 v6，同一事件可继续附带履行证据。日期项按已登记来源组和立案、发布角色记录字段级 `source/result`、最多前256条明细的 `rows` 分类计数及 `truncated`。读取与写入均核验固定值域，维护工具兼容 v1 至 v6。计数包括缺字段、空值、空白或占位、有效日期、未确认格式和异常结构。

非银行申请原值柱状图的总次数字段在投影层单独支持，已登记同路径档位模块仍使用档位显示。模块小结修正受明确的同一周期和事实来源约束。普通限高案件的日期修正须能证明已引用的是同一条普通记录。社交风险仅在标签名与状态数组可以逐行配对时使用本地已核实的原名和对应状态，额外的「均为疑似标签」概括在整份及所选模块展示中移除。

复查后，普通单条限高记录的明确立案和发布时间分别按字段角色校对。v6 日期来源组补齐模块63、127和174。整体总结避免重新生成已由小结提供的独立周期次数、案件日期和标签状态。具体问答在完整标签问题且引用正好绑定标签名及状态字段时可用同一逐条结果，其他具体问题仍按其实际引用处理。
