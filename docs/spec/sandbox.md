# 无 Docker 隔离环境

跑真实 CLI 时，必须做到**一个 harness 一个隔离沙箱**，不能互相污染配置、缓存或 API key。本方案不使用 Docker，依赖进程级隔离 + 临时文件系统 + 可选 bubblewrap。

## 设计目标

- 一个 harness 进程只能看到自己的配置、缓存和临时项目。
- 不同测试用例并发执行时互不干扰。
- 测试结束后清理所有临时资源（除非显式保留用于诊断）。
- 不依赖 Docker，兼容 Linux / macOS / Windows（bwrap 仅 Linux 可选）。

## SandboxContext

```ts
export interface SandboxContext {
  /** 作为子进程 HOME 的临时目录 */
  homeDir: string;
  /** 子进程工作目录（项目根） */
  cwd: string;
  /** 配置文件型宿主使用的目录（如 codexHome / kimiHome） */
  configDirs?: Record<string, string>;
  /** 独立配置文件路径（如 --mcp-config 指定的文件） */
  configFilePath?: string;
  /** 需要临时 runtime 目录时的路径 */
  runtimeDir?: string;
  /** 本次测试合并后的环境变量 */
  env: NodeJS.ProcessEnv;
  /** 唯一标识，用于日志与诊断 */
  id: string;
}
```

创建流程：

1. `id = randomUUID()`。
2. `homeDir = mkdtemp(join(tmpdir(), `xas-sandbox-home-${id}-`))`。
3. `cwd = mkdtemp(join(tmpdir(), `xas-sandbox-cwd-${id}-`))`。
4. 按需创建 `configDirs`、`configFilePath`、`runtimeDir`。
5. 合并 `process.env` 与调用方注入变量，再执行剥离并写入受保护的 HOME 系列变量。

## 子进程环境注入

`JsonlProcess` 启动 harness 时强制设置：

- `HOME = sandbox.homeDir`
- Windows 额外设置：
  - `USERPROFILE = sandbox.homeDir`
  - `APPDATA = join(sandbox.homeDir, 'AppData', 'Roaming')`
  - `LOCALAPPDATA = join(sandbox.homeDir, 'AppData', 'Local')`
- `cwd = sandbox.cwd`

禁止子进程继承主进程 `HOME` 指向的真实用户目录。

## 环境变量剥离

真实 harness 可能读取宿主私有环境变量（如配置目录、身份目录），必须显式剥离，否则临时 `HOME` 会被覆盖。

每个 `HarnessProfile` 声明 `stripEnv`：

```ts
export interface HarnessProfile {
  // ...
  stripEnv: readonly string[];
}
```

**代理变量剥离是硬要求**：某些 CLI 会读 `http_proxy` / `https_proxy` 并把对本地假端点的请求发往代理，导致连接失败。剥离变量比设 `no_proxy` 更可靠。

`createSandbox` 流程：

1. 合并 `process.env` 与调用方注入的 backend / 内部变量；
2. 删除全部代理变量与 `stripEnv` 声明项；
3. 最后设置 `HOME` / `USERPROFILE` / `APPDATA` / `LOCALAPPDATA`。

调用方注入的 `env` 不能恢复已剥离变量，也不能覆盖临时 HOME；这是安全优先级，不是普通配置优先级。

## 配置写入

每个 `HarnessProfile.writeConfig` 负责把 MCP / 模型配置写到 sandbox，并写入该宿主的**门槛放行项**（如关闭 folder trust、允许工具列表等）。

隔离支点因宿主而异：

| 宿主类型       | 隔离支点                              | 是否需改 `HOME` |
| -------------- | ------------------------------------- | --------------- |
| 配置目录型     | `*_HOME` 环境变量指向 sandbox 子目录  | 不需            |
| 独立配置文件型 | `--config <file>` 指定 sandbox 内文件 | 不需            |
| user 级配置型  | 临时 `HOME` + `~/<app>/settings.json` | **需要**        |

## 并发隔离

- 临时目录名带 UUID。
- 假端点启动随机端口（`port: 0`，绑 `127.0.0.1`）。
- 同一 harness 的多个测试用例可并行，因为每个 sandbox 完全独立。

## 清理策略

```ts
const sandbox = await createSandbox();
try {
  await runHarnessTest(sandbox);
} finally {
  await cleanupSandbox(sandbox);
}
```

若 `E2E_KEEP_SANDBOX=1`，清理前打印路径并跳过删除。

## 崩溃隔离

单个 scenario 崩溃不应导致整个测试进程退出：

- `node:test` 的 `test()` 本身隔离单个用例；
- matrix 脚本或 harness preflight 循环中，单个 harness 启动/运行失败时记录错误、关闭 sandbox、继续执行后续 carrier。

## 可选加固：bubblewrap（Linux only）

默认关闭，通过 `E2E_USE_BWRAP=1` 开启。限制：

- 仅 Linux 可用；
- 失败时自动降级到临时 HOME 方案；
- 不启用网络隔离（需要 localhost 访问假端点）。

## 文件清单

```text
packages/sandbox/src/
├── create.ts       # createSandbox
└── cleanup.ts      # cleanupSandbox
```

## 验收标准

- `createSandbox` 生成的 `homeDir`/`cwd` 互不重复。
- 子进程 `process.env.HOME` 等于 sandbox homeDir。
- 即使调用方在 `env` 中重新注入，`stripEnv` 声明项和代理变量仍不存在。
- 测试结束后临时目录被删除（`E2E_KEEP_SANDBOX=0`）。
- 单个 scenario 失败不影响其他 scenario 执行。
