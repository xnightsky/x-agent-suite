# Gemini CLI 适配笔记

> 探测版本：Gemini CLI 0.42.0 / 0.56.0

## 1. 假端点 wire

Gemini 使用 `generateContent` / `streamGenerateContent`：`wire = "gemini-generate"`。

`GOOGLE_GEMINI_BASE_URL` 官方要求 HTTPS，**除非指向 loopback**（`localhost` / `127.0.0.1` / `[::1]`）。因此假端点必须绑 `127.0.0.1`。

## 2. 工具命名

Gemini 向模型暴露的工具名：`mcp_<server>_<tool>`，扁平 `functionCall.name`。

## 3. folder trust 是硬门槛

未关闭 `security.folderTrust` 时，`gemini mcp list` 恒为 `Disconnected`，且 MCP 子进程**根本不会被 spawn**（用 marker 文件确认过）。

- `--skip-trust` 对 MCP 发现**无效**；
- 有效解法：`settings.json` 中设 `security.folderTrust.enabled = false`，或预写 `~/.gemini/trustedFolders.json`：

```json
{ "/abs/path/to/sandbox/cwd": "TRUST_FOLDER" }
```

`gemini mcp add` 默认写**项目级** `.gemini/settings.json`，但 `gemini mcp list` 读不到；必须 `--scope user` 写入 `~/.gemini/settings.json` 才被识别。

## 4. 认证方式（0.56.0 新增）

0.56.0 起 `performInitialAuth` 直接读 `settings.merged.security.auth.selectedType`，未设置时报 `Invalid auth method selected.` 并静默收尾（exit 0，新的假绿形态）。

修复：`writeConfig` 写：

```json
{
  "security": {
    "auth": { "selectedType": "gemini-api-key" },
    "folderTrust": { "enabled": false }
  },
  "mcpServers": { ... }
}
```

同时沙箱注入 dummy `GEMINI_API_KEY`。

## 5. win32 入口路径（0.56.0）

0.56.0 的 package.json `bin` 指向 `bundle/gemini.js`，旧版 `dist/index.js` 已不存在。profile 的 `win32.binPath` 应设为 `bundle/gemini.js`。

## 6. 代理变量

Gemini CLI 会读取 `http_proxy` / `https_proxy` 环境变量，导致连本地假端点失败。必须在 `stripEnv` 中剥离代理变量。

## 7. 隔离

Gemini 需要改写 `HOME`，让 `~/.gemini/settings.json` 指向 sandbox 内的临时目录。

## 8. settings.json 示例

```json
{
  "security": {
    "auth": { "selectedType": "gemini-api-key" },
    "folderTrust": { "enabled": false }
  },
  "mcpServers": {
    "reference": {
      "command": "node",
      "args": ["<serverEntry>"],
      "env": { "E2E_SESSION_MODE": "memory" },
      "trust": true
    }
  }
}
```

## 9. 输出事件

Gemini `-o stream-json` 输出 `tool_use` / `tool_result` / `result`。工具调用成功判定：`tool_result.status === "success"`。
