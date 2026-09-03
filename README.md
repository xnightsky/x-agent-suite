# x-agent-suite

通用 Agent 测试套件框架：为多种 Agent（自研 Agent、通用 Agent、编程 Agent）提供可复用的多轮行为评估基础设施。

> 目标：把多类真实评测实践中已验证的跨宿主测试能力，按领域中立原则抽取为可供不同消费者复用的独立框架。

## 核心纪律

- **领域中立**：框架不认识任何具体被测系统。
- **零内建判据**：判据由消费者注册。
- **零内建 scenario**：scenario 由消费者注册。
- **三个合法出口**：`metadata` / `evidence` 自由区、失败类别注册、插件注册表。

## 包结构

```text
packages/
  contracts/      # 类型契约
  driver/         # AgentDriver / LongLivedAgentDriver 接口 + 子进程基座
  sandbox/        # 临时 HOME / cwd / env 隔离
  llm-fixture/    # fake provider + live backend
  harness/        # HarnessProfile + 一次性/长驻 driver
  observation/    # Observation / 评分 / 报告
  matrix/         # 矩阵对照 CLI / API
```

## 开发

```bash
pnpm install
pnpm test    # 纯 fake / loopback / 通用子进程，零 token
pnpm itest   # 真实宿主 CLI + 假端点，零 token
pnpm check   # boundary + typecheck + test + itest；不含 token 级

# 从 Git history 自动推导版本，生成本地 tarball 并补稳定 tag
pnpm artifacts:pack
```

测试按验证对象和代价分层，而不是按是否起子进程分层；会访问真实 provider 的 `*.token.ittest.ts` 可以平铺或按需分组，但默认 runner 始终按后缀排除，只能显式运行。完整规则见[测试分层规范](docs/spec/testing.md)。

## 如何使用

先从 [`docs/tutorial/`](docs/tutorial/README.md) 建立完整玩法：按目标选择模块、运行离线示例，再用组合矩阵替换成消费者自己的 driver、profile、scenario 和 criterion。

```bash
pnpm tutorial        # Mock → Observation → Checks → Report
pnpm tutorial:check  # 全部安全离线教程
pnpm tutorial:pty:pi # 真实 Pi + fake provider；默认 skip，零 token
```

真实 provider 对照文件为 `examples/tutorial/10-live-smoke.token.ittest.ts`，只允许通过精确的 `pnpm itest:token:tutorial` 显式运行，且测试内部仍要求单次授权值。

当前是库级组合入口；运行时 Registry、Scenario DSL runner 和统一 CLI 仍在路线图阶段。

兄弟仓库的本地 tarball、git 源码自构建、远程 GET、未来 registry 安装配置，以及固定版本重打方式，见 [`docs/spec/packaging.md`](docs/spec/packaging.md)。`artifacts/` 是本地交付输出并已加入 `.gitignore`。

## 真实测试姿态：隔离 × 载具 × 凭证

模块组合轴选「用什么测」（见[组合手册](docs/tutorial/combinations.md)，机器可读版为 [`catalog.json`](docs/tutorial/catalog.json)）；真实测试还有三根**执行姿态轴**，选「在哪跑、打谁、用什么凭证」：

| 姿态轴 | 可选值                                 | 默认 |
| ------ | -------------------------------------- | ---- |
| 后端   | fake（假端点）/ live（真实端点）       | fake |
| 隔离   | 沙箱（隔离 HOME/cwd/环境剥离）/ 非沙箱 | 沙箱 |
| 凭证   | 无 / 第二套专用凭证 / 借用本机登录态   | 无   |

fake 是减少对真实环境访问的降噪机制，不是验收终点；最终验收面是 live。同一套 scenario 与判据不随姿态变化，只换后端、隔离和凭证来源。安全规则挂在**姿态轴的取值**上，不挂在具体机制上：后端取 `live` 自动落入 token 层，隔离取 `非沙箱` 自带副作用风险，两者独立成闸。

| 组合（后端 × 隔离 × 载具）  | 什么时候用                                                             | 怎么用                                                                                      | 风险                                            | 闸门与分层                                                   |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| fake × 沙箱 × harness       | 默认回归主链：协议、工具轮、Observation 归一                           | `pnpm test`；[headless-fixture](docs/tutorial/recipes/headless-fixture.md)                  | 无真实外访                                      | 默认允许                                                     |
| fake × 沙箱 × PTY           | TUI 交互门槛回归：审批框、首次信任、独占输入                           | `pnpm tutorial:pty`；真实宿主走 [pi-pty itest](docs/tutorial/recipes/pi-pty-integration.md) | PTY 原生依赖编译；屏幕时序漂移                  | `*.ittest.ts` 分层，前置缺失显式 skip，零 token              |
| fake × 非沙箱 × harness/PTY | 调试 driver 机制本身（对着真实安装的宿主，不碰真 provider）            | 手工临时运行，无默认入口                                                                    | 副作用直达真实 HOME 与配置                      | **当前无显式闸门**，仅限本地调试，不得进共享回归             |
| live × 沙箱 × harness       | 真实模型最小对照：wire 保真、限额、脱敏链路                            | `itest:token:*` 显式入口；[live-token-smoke](docs/tutorial/recipes/live-token-smoke.md)     | token 与费用；凭证泄漏                          | token 后缀排除 + 显式授权 + `redactLiveSecrets` + 限额       |
| live × 沙箱 × PTY           | **最终验收面**：真实 TUI + 真实端点，环境仍隔离                        | token 显式入口（按宿主落地时添加精确脚本）                                                  | 同上，叠加 PTY 时序与原生依赖                   | 同 live 闸门，叠加 PTY 前提（ptyArgs、ready/prompt pattern） |
| live × 非沙箱 × 任意        | 仅当验收目标就是宿主与真实配置的交互（如真实插件安装、真实登录态刷新） | 手工、逐次授权                                                                              | **最高**：真凭证 × 真环境，误操作可损坏本机配置 | 建议后端与隔离双显式武装；定位为调试/专项，非常态回归        |

live 组合的凭证按三级阶梯解析，有下级就不用上级：

1. **无**：fake 后端不需要任何凭证。
2. **第二套专用凭证（推荐）**：用户显式提供的测试专用 API key / 测试账号，独立配额、可吊销；经 `.env.e2e.yaml`（已 gitignore）注入。
3. **借用本机登录态（兜底）**：宿主仅订阅制 OAuth、无 API key 可发时的唯一选择；属高风险路径，必须显式配置与授权，借用结果只读、带 source 审计、输出一律脱敏。

## 状态

v0 · 内部版本化阶段。基础模块与本地制品打包已可用，远程上传和 registry 发布尚未执行；框架能力继续按路线图演进。

> [!CAUTION]
> **AI CLI 自动化风险：风险自担！！！**
>
> 本项目会启动并驱动第三方 AI CLI。官方 CLI 提供 headless/CI 能力不等于你的订阅、OAuth/session token 或目标服务条款允许所有自动化用途；误用可能导致 token/session 撤销、权益受限、账号暂停，以及本机文件或凭据被工具误用。
>
> - **中·默认启用**：`fixture` 使用 loopback fake provider 和临时 HOME/cwd，不消耗真实模型额度；这只降低账号风险，不是完整的网络或文件系统隔离。
> - **中高·需显式授权**：`live`（`E2E_LLM_MODE=live`）会发起真实请求，产生数据出站、费用和限额风险。
> - **高危·需显式授权**：`credential: harness` 会读取本机 CLI 凭据，`from: harness` 在未显式配置凭据时还会隐式进入该路径。当前 live 子进程不应被视为已清理继承环境中的认证变量。
> - **高危·禁止**：逆向 OAuth、把消费者订阅 token 发给第三方 endpoint、轮换/共享账号绕过配额，以及用 Kimi Code 订阅进行无人值守/批处理。
> - **高危·需隔离授权**：`--yolo`、绕过审批/沙箱或自动接受编辑等 profile 仅可在可丢弃、最小权限且禁止公网出站的沙箱中运行。
>
> “授权”是指运行责任人对单次高危操作的明确批准，不代表厂商许可，也不能覆盖“禁止”项。live 默认关闭；确需启用时，优先使用专用 API key/企业凭据和专用测试账号，并限制费用、token、并发、速率和总超时。当前风险点及上游官方依据见 [AI CLI 风险评估](docs/research/ai-cli-account-session-risk.md)。
