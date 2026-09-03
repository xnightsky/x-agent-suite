# 依赖补丁

本目录保存由 `pnpm.patchedDependencies` 管理的第三方依赖补丁。补丁必须同时记录适用范围、上游状态、验证方式和删除条件，避免长期保留无来源的 vendor 修改。

## `node-pty@1.1.0`：Windows ConPTY 清理回退

- **适用平台**：仅 Windows。补丁文件会随统一 lockfile 在所有平台安装，但修改的 `conpty_console_list_agent` 只由 `WindowsPtyAgent` 调用，Linux/macOS 不执行该路径。
- **问题**：系统 ConPTY 关闭时，辅助进程调用 `AttachConsole(shellPid)` 可能因 shell 已退出或宿主没有可附着控制台而抛出未捕获异常，向测试或应用 stderr 输出完整堆栈。
- **补丁边界**：仅捕获控制台进程列表枚举失败，并回退到 `[shellPid]`；这与父进程现有的五秒超时回退一致。补丁不切换 PTY 后端、不改变正常枚举结果，也不吞掉主 PTY 进程错误。
- **上游状态**：对应上游草案 [microsoft/node-pty#886](https://github.com/microsoft/node-pty/pull/886)。当前稳定版 `1.1.0` 尚未包含该修复。
- **许可证**：补丁目标文件保留 node-pty 原有 MIT 版权声明。
- **验证**：运行 `pnpm exec tsx --test packages/driver/tests/pty.test.ts`，确认无 `AttachConsole failed` / `conpty_console_list_agent` stderr；最终运行 `pnpm check`。
- **删除条件**：升级到包含等价正式修复的 node-pty 稳定版后，先运行上述回归测试，再删除 `patches/node-pty@1.1.0.patch`、`pnpm-workspace.yaml` 中的补丁登记和对应 lockfile 条目。
