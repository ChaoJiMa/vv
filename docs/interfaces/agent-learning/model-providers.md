# Python 模型接入协议

- 日期：2026-10-31。
- 范围：Python 调用外部模型；不新增或修改 Java 业务接口。

## 配置与调用方

`main.py` 读取 `REPORT_EXTERNAL_MODEL`，仅 `on` 时创建模型客户端。`REPORT_MODEL_PROVIDER` 默认 `zhipu`，支持 `zhipu`、`deepseek`、`openai`；开启模型时未知值在业务登录前拒绝。密钥缺失或型号为空不创建模型连接。关闭模型时无需任何模型密钥。

| 厂商 | 密钥 | 型号及默认值 | HTTP 出口 |
|---|---|---|---|
| 智谱 | `ZHIPU_API_KEY` | `ZHIPU_MODEL`，默认 `glm-5.3-flash` | `POST https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| DeepSeek | `DEEPSEEK_API_KEY` | `DEEPSEEK_MODEL`，默认 `deepseek-flash` | `POST https://api.deepseek.com/chat/completions` |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL`，默认 `gpt-6.1-sol` | 默认 `POST https://api.openai.com/v1/responses`；可配置兼容网关 |

各客户端使用所选厂商的 `Authorization: Bearer <模型密钥>`。模型客户端不读取Java登录token、手机号或验证码，不共享业务客户端的Cookie与请求头。智谱与DeepSeek出口固定；OpenAI允许启动配置 `OPENAI_BASE_URL` 指定兼容网关。DeepSeek密钥只发送至DeepSeek。两个OpenAI SDK适配器的请求头由显式模型key构造，不继承 `OPENAI_CUSTOM_HEADERS`、其他项目的组织/项目头或Codex登录状态。

`OpenAIResponsesClient(api_key, http_client, base_url=...)` 只使用显式地址；省略或空值回退官方基础地址。`main.py`读取 `OPENAI_BASE_URL` 后通过 `openai_base_url()` 校验，再传给客户端；直接构造适配器时不会额外读取环境变量。仅接受HTTP(S)、合法主机与端口，拒绝内嵌凭据、查询串、片段、反斜线、空白及控制字符，清理首尾普通空格与末尾斜线。错误只输出固定说明，在业务登录前终止。基础地址由操作者配置，模型与用户问题不能改变。HTTP按指定地址使用，传输未加密。

## DeepSeek 参数与响应

`report_model.DeepSeekClient` 将 `chat.completions.create` 的受控参数交给官方 OpenAI SDK。请求 JSON 包含 `model`、`messages`、`stream=false`、`thinking={"type":"disabled"}`；具体问题使用 `max_tokens=1800`、SDK `timeout=30.0`，整份报告的模块小结及整体总结使用8192、90秒。timeout为网络选项，不进入JSON。路由及无工具的结论传 `response_format={"type":"json_object"}`；工具阶段另传 `tools` 和 `tool_choice="auto"`。

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

报告问答的引用用于内部检查，用户只看到结果及解释，不追加字段清单、已读未读范围或统一免责声明。已核实的主评分事实可附presentation，提供当前页面分数、等级、区间和客服说明；具体规则及数据结构见[问答协议](java-business-api.md)。不同厂商共用该本地校验与展示逻辑，不由模型猜测分档或照抄代码规则。

2026-11-02补充本地校验：数字、百分比、完整日期和明确滚动周期分别核对。周期沿用既有本地别名（例如近1年等同近12个月、近1月等同近30天），不能借周期数字声称报告条数，也不将自然月替换为滚动周期。“手机号在网时长/时间/运营商”等固定指标短语允许提问；实际号码、已知私人值及其他个人信息标签仍查原文，字段过滤规则保持原约束。追问改换周期时重新读取来源，不复述未引用的旧周期数字。

## GPT-6.1 Sol 的 Responses 适配

`OpenAIResponsesClient` 把现有受控消息转换为 `input`，固定传 `model=gpt-6.1-sol`（默认配置）、`reasoning={"effort":"low"}`、`max_output_tokens=8192`、`stream=false`、`store=false`。网络超时尊重调用方的SDK选项：路由及具体问题每次30秒，整份报告的模块小结与整体总结每次90秒；未传timeout时默认90秒。此为逐请求网络预算，不是整轮问答总时限，timeout不进入JSON。不发送不受支持的 `thinking`、`max_tokens` 或 `temperature`。路由与最终无工具结论使用 `text.format.type=json_object`；函数定义转换为 Responses 的平铺格式，设置 `strict=true` 和 `tool_choice=auto`。

JSON模式在首个user输入前插入程序固定消息 `Return a JSON object.`，使兼容网关能识别格式要求；原问题和投影JSON保持原样，调用方列表不被修改，不增加工具权限或引入网关回包。非JSON的工具阶段不插入该提示。网关初测普通请求成功而原JSON路由返回400，加入固定输入提示后路由和完整模块总结通过；运行时不会收到400后自动重试或关闭JSON校验。

原生 Responses 工具续接需要保留推理项。本项目不保留或回传推理内容，因此每个请求独立推理：把此前经本地检查并执行的调用重建为 assistant 普通 JSON 消息 `executed_tool_calls`，结果重建为 user 普通 JSON 消息 `executed_tool_result`。这些消息只含程序生成引用、已批准参数和受控结果；不是 `function_call_output`，不引用 `previous_response_id`，不发送模型原始 output、响应ID、明文或加密 reasoning item。当前请求仍通过原生函数工具请求下一次查询或提交结论。其真实语义稳定性与额外推理成本需要在线评估。

适配器读取 `status=completed` 的响应，只提取 `message` 中的 `output_text` 及 `function_call` 的 `call_id/name/arguments`。空输出、非completed状态、服务错误或拒答回到原有不完整回答/本地查询路径。思维链不进入返回的兼容消息、后续请求或本地历史；本地仍负责工具预算、统计投影、来源与数字校验。`store=false` 是响应存储设置，不代表服务商零留存保证。

## 失败与生命周期

HTTP 客户端关闭环境代理和重定向，SDK `max_retries=0`。超时、连接错误及 HTTP 服务错误映射到原有固定提示；异常正文不会显示、写入历史或重新发送。不向其他厂商自动转发请求。`ExitStack` 在结束、提前退出或异常时关闭 SDK 与传输连接。

## 验证范围

2026-10-31初次接入时，新增真实OpenAI SDK加内存HTTP测试，覆盖两个固定官方出口、Sol Responses参数与推理丢弃、JSON与工具协议、完整虚构报告分析、隐私问题零请求、401/429/500/302、超时、连接失败及无自动重试，157项离线回归通过。DeepSeek已实连客服路由及虚构报告；当时未配置独立OpenAI API key，Sol仅完成内存协议测试。

同日用户进一步要求客服切换为Sol，本机运行配置已设为 `openai/gpt-6.1-sol`，独立OpenAI key已存在；重跑11项厂商适配测试通过。实际语义客服请求出现连接失败，无凭据的固定官方地址连通性检查同样ConnectTimeout；未收到HTTP响应，无法据此确认key有效性或模型访问权限，未继续虚构报告请求。未读取用户真实报告，未更改HTTP出口、代理策略或自动转给其他厂商。实际验证细节见 [开发记录](../../development/agent-learning/2026-10-31-deepseek-provider.md)。

同日后续按用户给定兼容网关配置 `OPENAI_BASE_URL`，网关鉴权与Sol型号检查通过。修复JSON输入提示兼容性后，最终语义客服路由与虚构报告模块小结、整体总结共3次请求通过本地校验；具体指标问答另以4次请求、3次工具调用完成并通过校验。194项离线回归通过，包括地址参数校验、HTTP网关、重定向与失败不换出口、凭据隔离及JSON输入完整性。实际网关地址只在本机.env中维护，未读取真实报告或调用Java业务接口。

同日进一步调整客服展示后，207项离线回归通过；以虚构69.5分报告实连Sol网关，5次请求完成问答并通过来源、展示分数、等级和客服正文检查，没有读取真实报告。后续本地文案补充与等级标签限制以最终离线回归确认，详见[客服表达记录](../../development/agent-learning/2026-10-30-xiaobei-service-conversation.md)。
