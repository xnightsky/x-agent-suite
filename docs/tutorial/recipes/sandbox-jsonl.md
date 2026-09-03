# Sandbox → JsonlProcess

这一条演示如何在临时 HOME/cwd 中启动一个输出 JSONL 的通用子进程，并保证进程与目录都被清理。

## 运行

```bash
pnpm tutorial:sandbox
```

源码：[`examples/tutorial/02-sandbox-jsonl.test.ts`](../../../examples/tutorial/02-sandbox-jsonl.test.ts)。虽然会启动 Node 子进程，它仍是 `*.test.ts`：验证对象是通用进程基座，不是真实宿主 CLI。

## 预期结果

`TUTORIAL_SUMMARY` 应包含：

- `cwdMatches: true`：子进程确实运行在隔离 cwd；
- `record.kind: "ready"`：stdout 被按 JSONL 解析；
- `cleaned: true`：HOME 与 cwd 均已移除。

## 代码怎么流动

1. `createSandbox()` 生成临时 HOME、cwd 和干净环境表。
2. `JsonlProcess` 使用显式 `command/args/cwd/env` 拉起子进程。
3. `lines()` 只消费 stdout 的完整 JSON 行；stderr 保留为诊断信息。
4. `finally` 先关进程，再执行 `cleanupSandbox()`。
5. 清理后重新检查路径，避免“命令成功但现场泄漏”的假绿。

## 换成消费者实现

将内联 Node 脚本替换为消费者自己的**通用 JSONL 测试进程**，并在外层实现 `AgentDriver`：

- 把宿主原始记录映射成 `DriverEvent`；
- 聚合文本与结构化工具调用为 `Observation`；
- 为退出、超时、坏 JSON 和 stderr 增加带上下文错误；
- 保持 `close()` 幂等。

如果替换后拉起的是消费者注册的真实 Agent CLI，这个用例就升级为 `*.ittest.ts`，应进入 `pnpm itest`，而不是继续留在单元层。

## 常见误区

- sandbox 只隔离路径与环境变量，不自动禁止公网或系统级文件访问。
- 不要把 prompt 拼进 shell 字符串；应使用 `args` 数组传参。
- 不要根据退出码推断工具成功，必须从结构化事件归一 `status`。
