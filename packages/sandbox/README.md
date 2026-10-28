# @x-agent-suite/sandbox

为单个 harness 创建隔离沙箱：临时 HOME / cwd / env。

## 用途与边界

- 负责：临时 `homeDir` / `cwd`、环境变量收敛（剥离代理与声明项）、按需创建配置目录与 runtime 目录、结束后清理。
- 不负责：宿主配置内容（由消费者 profile 自行写入）、配置目录键名的语义（只按声明创建）、被测系统识别。

## API

```ts
import { createSandbox, cleanupSandbox } from "@x-agent-suite/sandbox";

const sandbox = await createSandbox({
  stripEnv: ["CUSTOM_PROXY"],
  env: { FAKE_API_KEY: "x" },
  configDirs: ["kimiHome"],
  configFile: true,
  runtimeDir: true,
});
try {
  // ... 运行被测 Agent
} finally {
  await cleanupSandbox(sandbox);
}
```

## 公开入口

入口为 [`src/index.ts`](./src/index.ts)：`createSandbox`、`cleanupSandbox`、`provisionSandbox`、`sandboxHomePath`，以及 `SandboxContext` / `CreateSandboxOptions` / `ProvisionEntry` 类型。

## 设计纪律

- `homeDir` 与 `cwd` 均为 `mkdtemp` 生成的唯一目录。
- 内置剥离所有代理变量（`http_proxy` / `https_proxy` 等）。
- 具体宿主的专用配置目录通过 `configDirs` 自由区表达，本包不解释键名。
- `E2E_KEEP_SANDBOX=1` 时保留目录供事后诊断。

## 依赖与边界

- 依赖：[`@x-agent-suite/contracts`](../contracts/README.md)（`SandboxContext` 等类型）。
- 被 [`@x-agent-suite/harness`](../harness/README.md) 依赖；也可单独用于任何起子进程的测试。

## 分发形态

本包是 workspace 私有实现模块（`private: true`），不单独发布 npm。消费者使用核心聚合子路径 `x-agent-suite/sandbox`；分发白名单与独立 PTY 制品的区别见 [打包与分发](../../docs/spec/packaging.md)。

## 命令（在仓库根执行）

```bash
pnpm --filter @x-agent-suite/sandbox test       # 包级单元测试
pnpm --filter @x-agent-suite/sandbox typecheck  # 包级类型检查
pnpm test                                       # 全仓单元测试（收口见 pnpm check）
```

## 文档

- [`docs/spec/sandbox.md`](../../docs/spec/sandbox.md)：沙箱契约与不变量。
- [`examples/tutorial/02-sandbox-jsonl.test.ts`](../../examples/tutorial/02-sandbox-jsonl.test.ts)：沙箱 + JSONL 子进程示例。
