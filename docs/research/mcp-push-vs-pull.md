# MCP 是否支持服务端主动推送（push vs pull）调研

- 日期：2026-08-23
- 状态：已完成；未能验证的来源在文末如实列出

## 背景与问题

在"多个 AI agent 会话互发消息"的场景下，一个常见假设是：

> 如果把消息通道做成 MCP server，MCP 机制没法实现服务端主动推送（push），只能客户端主动拉取（pull），所以新消息无法实时送达 agent，只能轮询。

本报告验证并细分该假设，区分三个层次：

1. **协议层**：MCP 规范允许 server→client 方向发什么；
2. **传输层**：stdio / 旧版 SSE / Streamable HTTP 各自的通道能力；
3. **客户端层**：主流 MCP host 实际把这些消息暴露给谁（控制面 vs 模型上下文）。

## 结论速览

- 协议层**有** server→client 的推送通道：notifications（日志、list_changed、resources/updated、progress）随时可以发；Streamable HTTP（2025-03-26 ~ 2025-11-25 各版）还专门为它设计了独立的 GET SSE 流和断线重连语义。说"MCP 只能 pull"在协议层面不准确。
- 但协议**没有**"把任意业务消息塞进模型上下文"的机制。`sampling/createMessage`、`elicitation/create`、`roots/list` 这类 server 发起的**请求**，已被 SEP-2260（Final）明确规定必须嵌套在某个 client 请求的处理过程中，**禁止**独立发起。
- 真正的卡点在第三层：主流 host（Claude Code、Kimi Code 等）把标准 notification 当控制面信号用（刷新工具列表、显示日志），**不注入模型上下文、不触发 agent 新一轮推理**。tool result 只能作为 tool call 的响应返回。
- 唯一的协议内反例是 Claude Code 的私有扩展 **channels**（`claude/channel` capability + 自定义 notification），能把消息推进正在运行的会话——但这是 Claude Code 专有、research preview，且社区 issue 显示注入并不稳定。
- 2026-07-28 版规范进一步收窄：删除 GET 独立 SSE 流与断点续传，server→client 主动通道只剩 `subscriptions/listen` 的四类变更通知——方向上是**更少**的 push，不是更多。
- 对"多 agent 会话互发消息"的场景：**纯 MCP 路线不成立**。host 自身的扩展机制（插件内事件 + 本地通道）才是正解；若要复用 MCP 生态，只能用"阻塞式长轮询 tool"模式，语义上等价于 pull。

## 一、协议层：server→client 方向允许发什么

以官方 TypeScript schema（2025-06-18 版）为权威清单，server 可发出的消息全集为：

**ServerRequest（server 发起的请求，共 4 种）：**

- `ping`：双向保活，任何时候都可以发。
- `sampling/createMessage`：server 请求 client 调用 LLM 采样（"借模型"），规范要求 human-in-the-loop 审批。
- `roots/list`：server 向 client 要文件系统根目录列表。
- `elicitation/create`：server 请求用户填写结构化表单（2025-06-18 引入）。

**ServerNotification（server 发起的通知，共 7 种）：**

- `notifications/cancelled`、`notifications/progress`（依附于某个进行中的请求）
- `notifications/message`：结构化日志（syslog 级别，data 可为任意 JSON）
- `notifications/resources/updated`：需 client 先 `resources/subscribe`
- `notifications/resources/list_changed`、`notifications/tools/list_changed`、`notifications/prompts/list_changed`

**关键判读：**

1. Notifications 确实是 push：`list_changed`、`logging/message` 等不要求先有 client 请求，server 可在会话建立后随时主动发出。
2. 但没有一个标准 notification 的语义是"给模型的业务消息"。`notifications/message` 虽然 `data` 是任意 JSON，语义定位是**日志**；list_changed 系列语义是"元数据变了，请重新拉取"。
3. server 发起的请求被收紧为"必须嵌套"：SEP-2260 规定 `roots/list`、`sampling/createMessage`、`elicitation/create` **必须**关联一个发起中的 client 请求，独立流上的 standalone 请求 "MUST NOT be implemented"；仅 `ping` 豁免。
4. **2026-07-28 版是根本性重写**：删除 initialize 握手、ping、`Mcp-Session-Id`、`Last-Event-ID` 断点续传，以及 GET 独立 SSE 流；GET SSE 流由 `subscriptions/listen` 取代。server-initiated 请求模式整体重构为 `InputRequiredResult`：server 想"要东西"的唯一姿势仍是借 client 的请求顺路带。

## 二、传输层：三个 transport 的推送能力

### stdio

规范措辞从"server writes responses to stdout"改为"server sends messages to stdout"发生在 **2025-03-26** 版，消息可以是 request、notification 或 response。stdio 是全双工管道，server 随时可以向 stdout 写入 notification。

限制：没有连接/会话管理概念，server 生命周期被 client 子进程绑定；且 SEP-2260 后 server 主动**请求**仍受限。

### 旧版 HTTP+SSE（2024-11-05，已废弃）

双端点：client 用 GET 连 SSE 端点**收**消息，用 POST 端点**发**消息。SSE 流天然是 server→client 单向推送通道，server 可以随时往下写 notification。已被 Streamable HTTP 取代。

### Streamable HTTP（2025-03-26 及之后）

- **POST 响应内的 SSE 流**：server 处理一个 client 请求时，可以把响应升级为 SSE 流，在给出最终 response 前下发与该请求**相关**的请求/通知（SEP-2260 将 "SHOULD relate" 收紧为 **MUST** relate）。
- **GET 独立 SSE 流**：client 可发 GET 打开一条与任何进行中的请求**无关**的 SSE 流，server 可在上面随时发 notifications（2025-06-18 措辞还允许 requests，SEP-2260 后收窄为 notifications + ping）。
- **断线重连/会话**：SSE event 可带 `id`，client 用 `Last-Event-ID` 断点续传；`Mcp-Session-Id` 头维护有状态会话。
- **2026-07-28 版把这套全拆了**：`Mcp-Session-Id`、`Last-Event-ID`、GET 独立 SSE 流全部删除；跨请求的 server→client 下发只剩 `subscriptions/listen`。

**小结**：传输层完全支持 push（stdio 随时写 stdout；HTTP 在 2025-03-26 ~ 2025-11-25 各版有专门的 GET SSE 流，2026-07-28 起收窄为 `subscriptions/listen`）。瓶颈从来不在传输，而在于"推过去的消息能表达什么、客户端拿它干什么"。

## 三、客户端层：host 实际把通知给了谁

这是真正的卡点。

**Claude Code**

- 官方文档：支持 `list_changed` 系列通知，用于**自动刷新工具/提示/资源列表**（控制面）。
- `notifications/resources/updated` 被**静默丢弃**，AI 会话不会被告知（issue #47823；状态 closed/not_planned，未修复）。
- **Channels（私有扩展）**：server 声明 `claude/channel` capability 并用自定义 notification 把事件直接注入正在运行的会话。但它是 Claude Code 专有、research preview、需要 `--channels` 显式开启，且社区 issue 显示注入并不稳定。
- v2.1.224 上线官方跨会话消息：每会话绑定 inbox socket（Unix socket/named pipe），导出 `CLAUDE_CODE_MESSAGING_SOCKET`+`CLAUDE_CODE_MESSAGING_TOKEN`，投递语义“当接收会话空闲时，Claude Code 启动一个新 turn”。

**Kimi Code**

- 官方文档只描述了 MCP 的 **tools** 能力，对 notifications、sampling、elicitation 的处理只字未提。
- **实测**：ACP 通道与 TUI 交互通道均不把 MCP `resources/updated` 以可辨识形式注入模型上下文。
- hooks：`UserPromptSubmit` 可在已有 prompt 边界注入上下文；`Stop` block 可在活跃 turn 结束时续轮；`SessionHeartbeat` 不创建 prompt。

**pi**

- pi 核心**没有原生 MCP 支持**，且作者明确表态不会加。社区有第三方 `pi-mcp-adapter` 扩展把 MCP 工具注册为 pi 原生工具。
- pi-mcp-adapter 已支持 sampling / elicitation / list_changed，且有私有 `triggerTurn()` 通道可唤醒 agent。但 pi 真正的王牌在扩展 API 本身（`sendUserMessage`），不需要绕道 MCP。

**其他 host（Cursor / VS Code Copilot / Windsurf）**

- 未取得各家关于 notification 处理的一手文档。从 MCP 社区讨论的普遍反馈看，"大多数现有 client 忽略 server 通知、或不把它交给 agent/LLM"是共识。

**共性结论**：标准 MCP notification 在主流 host 里是**控制面信号**；能进入模型上下文的 server→client 数据只有 **tool call 的 result**——即必须模型先发起调用。这正是"MCP 只能 pull"这一说法在实践层成立的真正原因。

## 四、业界变通方案

1. **轮询工具（check_inbox / fetch_messages）**：模型被告知定期调用收件箱工具。简单可靠，但费 token、延迟取决于模型何时想起来查。
2. **长轮询/阻塞式 tool call（wait_for_message 模式）**：tool 调用挂起直到有新消息或超时，把"push 的实时性"伪装成"慢速 pull"。
3. **notification + 轮询组合**：server 发 `list_changed` 之类通知作为"有变化"的信号，client/host 再决定是否拉取。但通知不触发模型推理。
4. **host 私有扩展**：Claude Code channels 是最典型的例子——证明 push-to-model 必须 host 亲自下场做非标准扩展。
5. **协议内提案（未采纳）**：Discussion #706 提议允许 server 在 Streamable HTTP SSE 上独立发起 `sampling/createMessage`，专门解决"agent 能说话但听不见"的问题；与 SEP-2260 的方向相反，未成为标准。
6. **MCP 之外的通道**：本地 socket / 文件 watch / 自有事件总线，host 或插件层直接注入消息，不经过 MCP。

## 五、宿主侧入站通路全景（2026-08）

MCP 协议层走不通，真正的战场在「宿主各自提供了什么官方通路能把外部消息送进模型上下文 / 唤醒空闲会话」。

| 宿主            | 官方入站通路                                                                                                                             | 空闲唤醒               | 评级     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------- |
| **pi**          | 扩展 API `sendUserMessage`（`source:"extension"`，steer/followUp）                                                                       | ✅                     | 最强     |
| **Claude Code** | v2.1.224 inbox socket + `CLAUDE_CODE_MESSAGING_SOCKET`/`TOKEN`；另有 hooks `async:true`+`asyncRewake:true`                               | ✅                     | 官方支持 |
| **Codex**       | app-server JSON-RPC：`turn/start`、`turn/steer`、`thread/inject_items`、`thread/queue/add`；hooks                                        | ✅                     | 强       |
| **Kimi Code**   | 交互 TUI 仅 hooks（Stop 续轮 / UserPromptSubmit 边界注入）；`kimi web` REST 可空闲点火托管 session，但不是原 TUI companion；ACP 独立进程 | 托管会话 ✅；原 TUI ❌ | 中       |
| **Gemini CLI**  | hooks 同步执行，BeforeAgent/SessionStart 可注入上下文                                                                                    | ❌                     | 弱       |
| **Cursor**      | stop hook `followup_message`                                                                                                             | ❌                     | 弱       |
| **Windsurf**    | hooks 无注入字段                                                                                                                         | ❌                     | 最弱     |

## 六、结论与建议

**原假设的修正表述**：

> "MCP 没法 push，只能 pull" 在**传输层不准确**（stdio/Streamable HTTP 都支持 server 主动发 notification），但在**"让模型实时知道有新消息"这个语义层基本准确**：标准 notification 只到控制面，sampling/elicitation 被 SEP-2260 禁止独立发起，唯一能把数据送进模型上下文的标准路径是 tool result——必须模型先问。主流 host 都不会把 server 通知注入模型上下文或触发新一轮推理。

**对"多 agent 会话互发消息"场景的具体建议**：

1. **优先使用 host 自身的扩展机制，而非 MCP**。host 插件/扩展位拥有直接向正在运行的会话注入消息的能力，且是宿主的一等公民机制；MCP 化反而受"通知不进模型"限制。
2. 如果想让消息被**任意 MCP 生态的 agent** 消费，可以把消息通道包装成一个 MCP server，采用业界事实标准：
   - 提供 `send_message` + `wait_for_messages`（长轮询，带超时和退避）工具；
   - 可选地在有新消息时发一个 notification 作为控制面提示，但不要依赖它被注入模型；
   - 文档里明确写"实时性依赖对端 agent 调用 wait 工具"。
3. 关注 MCP 后续版本：但注意方向——2026-07-28 版是在**收窄**而非拓宽 server→client 的主动通道。

## 来源清单

- [Specification latest · index](https://modelcontextprotocol.io/specification/latest/index)
- [Transports 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Transports 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [SEP-2260](https://modelcontextprotocol.io/seps/2260-Require-Server-requests-to-be-associated-with-Client-requests)
- [SEP-2575](https://modelcontextprotocol.io/seps/2575-stateless-mcp)
- [SEP-2567](https://modelcontextprotocol.io/seps/2567-remove-sessions)
- [SEP-2322](https://modelcontextprotocol.io/seps/2322-input-required-result)
- [Claude Code MCP 文档](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [Claude Code 跨会话消息](https://code.claude.com/docs/en/messaging)
- [Kimi Code 文档 · MCP](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html)
- [Pi: The Minimal Agent Within OpenClaw](https://lucumr.pocoo.org/2026/1/31/pi/)
- [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter)
- [Codex app-server JSON-RPC](https://github.com/openai/codex)
- [A2A v1.0](https://a2a-protocol.org/)
- [Discussion #706](https://github.com/orgs/modelcontextprotocol/discussions/706)
- [Discussion #337](https://github.com/orgs/modelcontextprotocol/discussions/337)
