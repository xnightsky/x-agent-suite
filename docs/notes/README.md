# 宿主 CLI 适配笔记

x-agent-suite 本身是通用框架，不认识任何具体 CLI。但这些笔记记录我们在真实 CLI 上踩过的坑，供实现 `HarnessProfile` 时参考。

> 笔记里的 CLI 名、版本号、路径和上游链接都属于「消费者示例」范畴，不进入框架源码。

## 目录

| 文档                     | 内容                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| [kimi.md](./kimi.md)     | Kimi Code：TUI 空闲点火边界、双 TUI PTY 互通、插件安装与入口校验     |
| [codex.md](./codex.md)   | Codex：Responses API、命名空间、审批放行、stdin 阻塞                 |
| [claude.md](./claude.md) | Claude Code：stream-json、tool_use/tool_result 配对、mcp-config 隔离 |
| [gemini.md](./gemini.md) | Gemini CLI：folder trust、loopback、auth selectedType                |
| [pi.md](./pi.md)         | pi：RPC 协议、mcp-adapter 缓存、Windows spawn                        |
