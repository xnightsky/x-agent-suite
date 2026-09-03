# @x-agent-suite/sandbox

为单个 harness 创建隔离沙箱：临时 HOME / cwd / env。

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
// ... 运行被测 Agent
await cleanupSandbox(sandbox);
```

## 设计纪律

- `homeDir` 与 `cwd` 均为 `mkdtemp` 生成的唯一目录。
- 内置剥离所有代理变量（`http_proxy` / `https_proxy` 等）。
- 具体宿主的专用配置目录通过 `configDirs` 自由区表达，本包不解释键名。
- `E2E_KEEP_SANDBOX=1` 时保留目录供事后诊断。
