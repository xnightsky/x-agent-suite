# 测试分层规范

本规范统一全仓所有 `*test*` 文件的命名、位置和默认回归范围。核心判断只有两个：**验证对象是否为真实宿主 CLI**，以及**是否会访问真实 provider 并消耗 token**；不是按是否起子进程分类。

规则按 x-agent-suite 的包结构、执行代价和领域中立边界制定。

## 两个验证层 + 一个风险修饰

| 层级           | 判定标准                                                                  | 文件名              | 默认命令        | 进入 `pnpm check` |
| -------------- | ------------------------------------------------------------------------- | ------------------- | --------------- | ----------------- |
| 单元测试       | 纯 fake、进程内组件、loopback 假端点、通用测试子进程；不拉真实宿主 CLI    | `*.test.ts`         | `pnpm test`     | 是                |
| 集成测试       | 拉起真实宿主 CLI，以 sandbox + 假端点验证 harness/真实宿主路径，零 token  | `*.ittest.ts`       | `pnpm itest`    | 是                |
| token 风险车道 | live 模式访问真实 provider，产生真实 token、费用或账号风险；是 itest 子集 | `*.token.ittest.ts` | `itest:token:*` | 否                |

“起子进程”不是升级集成测试的条件。例如 `JsonlProcess`、通用 Node 测试 CLI、loopback HTTP server 和合成 TUI/PTY 都可以是 `*.test.ts`；只有替换为消费者注册的真实宿主 CLI 后，才成为 `*.ittest.ts`。

## 位置

- 包单元测试：`packages/<package>/tests/*.test.ts`。
- 仓库脚本契约测试：`scripts/tests/*.test.ts`。
- 真实宿主集成测试：`packages/<package>/tests/*.ittest.ts` 或 `examples/tutorial/*.ittest.ts`；默认 runner 打平发现各包 tests 与教程目录顶层文件。
- token 测试默认可以与普通 itest 平铺为 `packages/<package>/tests/<name>.token.ittest.ts`，便于按包和文件名全局观察。用例较多或需要权限/责任分组时，可选用 `tests/token/` 子目录；目录不是安全边界。
- 教程可执行验证：仍按同一判定表命名；token 例可平铺在 `examples/tutorial/`，辅助模块可以使用普通 `*.ts`。

## 命令与默认回归

```bash
pnpm test   # 单元测试：纯 fake / loopback / 通用测试进程
pnpm itest  # 集成测试：真实宿主 + 假端点，仍为零 token
pnpm check  # boundary + typecheck + test + itest
```

`*.token.ittest.ts` 不进 `pnpm test`、`pnpm itest`、`pnpm check` 任何默认回归。`pnpm itest` 通过 `scripts/run-itests.ts` 按完整后缀排除 token 文件，安全性不依赖目录形状。每个 token 集合必须增加精确指向单文件或明确 allowlist 的 `itest:token:*` 脚本；当前教程入口为 `pnpm itest:token:tutorial` 与 `pnpm itest:token:pi-pty`（均精确指向单个 token 文件）。

PTY、headless、sandbox 是机制，smoke 是抽样范围，contract 是验证目的：这些词可以出现在文件 stem、测试标题和 catalog，但不形成新的终止后缀。为何不继续细分，见[测试文件命名调研](../research/test-file-naming-taxonomy.md)。

## token 级安全门

token 测试必须同时满足：

1. live 配置经 `.env.e2e.yaml` 发现链读取（repo 根 > `~/` > `~/.config/x-agent-suite/`，见 [llm-fixture 规范](./llm-fixture.md)）；repo 内文件由 `.env*` 规则忽略，禁止提交。
2. 命令必须显式运行，测试本身还要检查单次授权开关；缺配置、缺凭据或缺宿主时显式 skip。
3. 使用专用 API key、企业凭据或专用测试账号，限制费用、token、并发、速率和总超时。
4. 创建最小权限、可丢弃的 sandbox，并在成功、失败和 skip 路径清理现场。
5. 所有错误、skip 原因和报告在输出前经过 `redactLiveSecrets`。
6. 若借用本机真实宿主登录态，必须在测试头和运行命令旁明确标出账号与条款风险，不得作为默认 fallback。

## 教程文件如何分类

| 教程机制                                  | 分类依据                      | 后缀                |
| ----------------------------------------- | ----------------------------- | ------------------- |
| Mock、checks、report、matrix              | 纯内存/文件输出               | `*.test.ts`         |
| Sandbox + 通用 JSONL 子进程               | 通用测试进程，不是真实宿主    | `*.test.ts`         |
| FakeProviderBackend loopback              | 假端点、零 token              | `*.test.ts`         |
| 合成 headless profile / 合成 TUI PTY      | 通用测试宿主、零 token        | `*.test.ts`         |
| 消费者注册的真实 headless/TUI 宿主 + fake | 验证真实宿主 CLI 路径         | `*.ittest.ts`       |
| 真实 provider 对照                        | 真实请求、token/费用/账号风险 | `*.token.ittest.ts` |

这意味着教程示例不能用无语义的可执行文件名绕开测试分层；详细教程、recipe catalog、支持矩阵和命令必须链接到同一个分层后的测试文件。
