# Claude Code 适配笔记

> 探测版本：Claude Code 2.1.220 / 2.1.224

## 1. 假端点 wire

Claude Code 使用 Anthropic Messages SSE：`wire = "anthropic-messages"`，端点 `/v1/messages`。

API 请求路径可能带 query string（`POST /v1/messages?beta=true`）。假端点匹配时应剥离 query string，否则首请求 404，Claude 会合成一条 `There's an issue with the selected model ...` 的 assistant 文本并 `is_error: true` 收尾——新的假绿形态。

## 2. 工具命名

Claude 向模型暴露的工具名：`mcp__<server>__<tool>`，扁平 `tool_use.name`。

## 3. 隔离与 MCP 配置

Claude Code 的隔离比原设计更省事：

```bash
claude --mcp-config <file> --strict-mcp-config \
  --allowedTools "mcp__<server>__<tool>" \
  --permission-mode acceptEdits \
  -p <prompt> --output-format stream-json --verbose
```

- **无需改写 `HOME`**；
- **不要用项目级 `.mcp.json`**：会停在 `Pending approval` 状态而不连接；`--mcp-config` 指定的文件不受此限；
- **不要用 `--dangerously-skip-permissions`**：root 下被直接拒绝。

`-p` 的 prompt 必须紧跟在 `-p` 之后，否则会被 `--mcp-config` 误吞为文件路径。

## 4. 环境变量

需要注入：

```text
ANTHROPIC_BASE_URL=<baseUrl>
ANTHROPIC_AUTH_TOKEN=<apiKey>
ANTHROPIC_MODEL=fake
```

`ANTHROPIC_API_KEY` 与 `ANTHROPIC_AUTH_TOKEN` 互斥，必须在 `stripEnv` 中剥离 `ANTHROPIC_API_KEY`。

`ANTHROPIC_MODEL` 取任意字符串（含 `"fake"`）均被接受，模型名校验不存在客户端目录。

## 5. 输出事件

`--output-format stream-json` 输出：

- `assistant.message.content[].tool_use`
- `user.message.content[].tool_result`
- 末条 `result`（含 `is_error` / `permission_denials` / `usage`）

工具调用成功判定：存在对应 `tool_result` 且末条 `result.is_error === false`。

## 6. 跨会话消息（v2.1.224+）

Claude Code 2.1.224 上线官方跨会话消息：

- 每会话绑定 inbox socket（Unix socket / named pipe）；
- 导出环境变量 `CLAUDE_CODE_MESSAGING_SOCKET` + `CLAUDE_CODE_MESSAGING_TOKEN`；
- 投递语义：当接收会话空闲时，Claude Code 用该消息启动一个新 turn。

这是 Claude Code 官方支持“唤醒空闲会话”的通路，优先级高于私有 channels。

## 7. MCP 长工具调用限制

v2.1.212+ 引入：

- stdio MCP 30min 空闲超时；
- HTTP/SSE MCP 5min 空闲超时；
- 长 tool call 自动后台化（`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`）。

长轮询 `wait_for_message` 类工具需考虑这些限制。

## 8. mcp-config.json 示例

```json
{
  "mcpServers": {
    "reference": {
      "command": "node",
      "args": ["<serverEntry>"],
      "env": { "E2E_SESSION_MODE": "memory" }
    }
  }
}
```
