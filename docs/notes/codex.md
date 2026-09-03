# Codex CLI 适配笔记

> 探测版本：Codex CLI 0.147.0 / 0.149.0

## 1. 假端点 wire

Codex 必须使用 OpenAI **Responses** SSE（`/v1/responses`）。`wire_api = "chat"` 已在 0.147 被移除，配置它会直接报错：

```text
Error loading config.toml: `wire_api = "chat"` is no longer supported.
How to fix: set `wire_api = "responses"`
```

因此 `FakeProviderBackend` 必须实现 Responses API 事件流：

```text
response.created
→ response.output_item.done
→ response.completed
```

## 2. 工具命名

Codex 向模型暴露的工具形态：

```json
{
  "type": "namespace",
  "name": "mcp__<server>",
  "description": "...",
  "tools": [{ "type": "function", "name": "<tool>", "parameters": {/* ... */} }]
}
```

假响应 item 必须带 `namespace` 字段：

```json
{
  "type": "function_call",
  "call_id": "call_1",
  "namespace": "mcp__<server>",
  "name": "<tool>",
  "arguments": "{\"...\":\"...\"}",
  "status": "completed"
}
```

如果 `name` 直接写裸名、写 `mcp__<server>__<tool>`、或把真实工具名塞进 arguments，三种都失败。

## 3. 调用失败仍 exit 0（假绿）

发送不被识别的 tool 名时，Codex 仅在 stderr 打一行：

```text
ERROR codex_core::tools::router: error=unsupported call: <name>
```

并向对话注入 `function_call_output: "unsupported call: ..."`，随后正常收尾、**进程 exit 0**。

**断言绝不能只看退出码或末条文本**，必须查结构化事件的 `status` 字段与 MCP 侧实际状态。

## 4. 审批放行

默认审批策略下，MCP 工具调用被记为：

```json
{
  "type": "mcp_tool_call",
  "status": "failed",
  "error": { "message": "user cancelled MCP tool call" }
}
```

`approval_policy = "never"` 与 per-tool `approval = "never"` 均**未能**放行。实测可行的是：

```bash
codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox <prompt>
```

## 5. MCP server 等待

Codex `exec` 对可选 MCP server 不保证等 initialize + tools/list 完成就发首轮模型请求。首轮请求与 MCP 注册并发，若 fake provider 的 tool_call 到达时 Codex 工具注册表尚无该工具，会报 `unsupported call` 并被 skip 闸门吸收。

修复：profile 的 `mcp_servers.<name>` 段加 `required = true`（0.149.0 验证接受），强制 Codex 等该 server initialize + tools/list 完成才发首轮请求。

## 6. stdin 阻塞

`codex exec` 在 stdin 为 pipe 且 prompt 已作 argv 传入时仍会阻塞等 stdin EOF：

```text
Reading additional input from stdin...
```

修复：`JsonlProcess` 启动后即关闭 stdin（`closeStdinAfterStart`）。

## 7. 隔离

Codex 使用 `CODEX_HOME` 环境变量指向临时目录，`config.toml` 写在该目录下。不需要改写 `HOME`。

临时 `HOME` 指向 `/tmp` 子目录时，Codex 会打一行 warning：

```text
Refusing to create helper binaries under temporary dir
```

不影响功能，解析输出时忽略即可。

## 8. 代理变量

Codex 会读 `http_proxy` / `https_proxy` 并把对本地假端点的请求发往代理，导致 `TypeError: fetch failed`。必须在 `stripEnv` 中剥离代理变量。

## 9. config.toml 示例

```toml
model = "fake"
model_provider = "fakeprov"

[model_providers.fakeprov]
name = "fake"
base_url = "http://127.0.0.1:<port>/v1"
env_key = "FAKE_API_KEY"
wire_api = "responses"

[mcp_servers.reference]
command = "node"
args = ["<serverEntry>"]
required = true

[mcp_servers.reference.env]
E2E_SESSION_MODE = "memory"
```

## 10. 关键输出事件

Codex `--json` 输出 JSONL，关键事件：

```json
{
  "type": "item.completed",
  "item": {
    "type": "mcp_tool_call",
    "server": "...",
    "tool": "...",
    "arguments": {...},
    "result": {...},
    "status": "completed"
  }
}
```

`status` 取值 `completed` / `failed`，断言以此为准。
