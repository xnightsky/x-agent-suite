# 变更记录

本文件记录影响消费者接口、行为、安装、配置、协议或报告格式的变化。版本遵循 [Semantic Versioning 2.0.0](https://semver.org/)；源码 workspace 的 `0.0.0` 是不可发布占位值，制品版本由 Git history 与稳定 tag 管理。历史章节与本仓稳定 tag 一一对应，不记录未发布的版本号。

## 0.6.0 - 2026-09-13

### Added

- provision 参考实现（`x-agent-suite/sandbox`）：`provisionSandbox` 把能力包 / fixture 目录铺进沙箱宿主可见位置（copy 默认 / symlink 显式，home / cwd 双基准，越界显式抛错），配套 `sandboxHomePath`；headless `createHarnessDriver` 新增 `sandboxSetup` 钩子（时机：sandbox 创建 → writeConfig → provision → spawn，与 PTY driver 对齐），安装态能力评测打通。
- repeat 统计（`x-agent-suite/runner`）：`runScenarioRepeat` / `summarizeRepeat` 产出 `RepeatStats`（稳定率 + 聚合分均值/极值）；`ScenarioReportRow` 新增可选 `repeat` 字段，md 报告新增「稳定率」列；CLI config 新增 `repeat` 旋钮。
- 报告 diff（`x-agent-suite/observation` + runner CLI）：`diffScenarioReports` 纯函数以 lens 注入聚合视图（泛型核心不绑 artifact 形状），产出维度级变化清单；CLI 新增 `x-agent-suite diff <基线|目录> <候选|目录>` 子命令（按场景配对、NEW/REMOVED 标注、只读退出码恒 0）。契约新增 `ReportDocument`（JSON 报告读取面）。
- 教程：harness-runner（合成 headless 接 runner）、pi-pty-runner（真实 PTY 经 runner，门控 `E2E_PI_PTY`）、provision-skill（安装态能力包）三个 recipe。

## 0.5.0 - 2026-09-13

### Added

- 聚合打分机 `resolveAggregate`（`x-agent-suite/observation`）：维度三态（hit/miss/absent）、缺席映射（zero/pass/fail）、knockout 短路、负分维度、coverage 披露、weight 默认 1、threshold 出口门槛；配套契约 `AggregationSpec` / `DimensionSpec` / `AggregateResult`。
- 判据调度 `runCriteria`（`x-agent-suite/observation`）：按 expect 块把判据集分发到各轮/会话并收集 `CriterionOutcome`，引用完整性与重复注册显式抛错；同一入口支持离线判分（对已有 Observation 复跑判定，不起 driver）。
- 最小领域中立判据集（`x-agent-suite/criteria`）：`textContains` / `textNotContains` / `toolCall`（metric 名分别为 `text-contains` / `text-not-contains` / `tool-call`）；expect 形状非法抛 TypeError（配置错误不等于评测失败）。
- 场景运行器（`x-agent-suite/runner`）：`createRegistry` 内存注册表（契约写侧 + 读侧查找）；`runScenarioSpec` 执行 `ScenarioSpec`（逐轮驱动 → 会话观测 → 判据调度 → 可选聚合 → ScenarioResult；三级轮超时、基础设施失败显式抛错、finally close）；CLI `x-agent-suite eval <config-module>`（config 为代码模块；退出码只反映基础设施失败，行为结论看报告）。`ScenarioSpec` 新增可选 `aggregate` 字段作为聚合声明载体。
- 聚合分发包新增 `x-agent-suite/criteria` 与 `x-agent-suite/runner` 子路径。
- 教程：criteria-aggregation 与 scenario-runner 两个 recipe；根 README 新增「流水线阶段」槽位表（每段可替换的默认实现与合法替换值）。

### Fixed

- `runScenarioSpec` 透传 driver 提供的 `Observation.metadata` 至轮切片（此前静默丢弃，领域证据自由区在 runner 链路断裂）。

## 0.4.0 - 2026-09-10

### Added

- `FixtureTurn` 新增两个可选修饰：`delayMs`（选定轮次后、分发 wire 前统一推迟响应，支撑「宿主运行中」窗口等时序场景）与 `whenText`（请求体原文内容命中优先于轮次计数，解决多轮对话中后续轮不再新增 tool result 时计数无法区分轮次的问题）。两者均为可选字段且不改变 toolCall/text 恰居其一校验，未声明的既有脚本行为完全不变。

## 0.3.2 - 2026-09-07

### Fixed

- 回退 0.3.1 的 win32 `taskkill` 拆卸改写：该路径复刻 node-pty 内部清理，但 @lydell fork 的原生 `kill` 签名不同（无 `useConptyDll` 参数），消费者侧全部 PTY 用例被 `Usage: pty.kill(id)` 打挂。`AttachConsole failed` 噪音的正确修法是消费者仓 pnpm patch `@lydell/node-pty`（对齐上游 1.2.0 已合入的 try/catch），框架不改写拆卸路径。

## 0.3.1 - 2026-09-07

### Fixed

- ~~win32 下 `PtyProcess.close()` 改走 `taskkill /T /F`~~（**已召回**：在 @lydell fork 上回归，0.3.2 回退；请勿使用 0.3.1 的 pty-driver 制品）。

## 0.3.0 - 2026-09-07

### Added

- harness 新增 `resolveLocalBinCommand`：win32 下包管理器把仓库本地 `.bin` 置于 PATH 首位、全局前缀布局推导失效时的兜底座——沿 `node_modules` 定位调用方本地包并读其 `bin` 声明，用当前 node 拉起；不可用时抛 `HarnessUnavailableError` 供 preflight 降级 skip。
- harness 新增 `ensureJsonEntry`：共享 JSON 配置的「读-校验-跳过」播种原语——条目一致则跳过不写、缺失则合并写入（保留兄弟键）、不一致显式报错，消灭多端并发读-改-写的丢失更新与半截文件窗口。
- harness 新增 PTY 屏幕镜像件：`attachScreenMirror` 订阅多端屏幕变化、节流后脱敏重绘分屏帧到 stderr（verbose 诊断），配套纯函数 `composeMirrorFrame` / `computeMirrorLayout` / `displayWidth` / `fitToWidth` / `parseSttySize` / `detectTerminalSize`；`PtyAgentDriver` 新增诊断访问器 `screenSource()` 返回屏幕只读视图（PTY 未拉起时为 null），消费者不再需要探 driver 内部句柄。以上同时从 `x-agent-suite/harness` 与 `@x-agent-suite/pty-driver` 制品导出。
- 教程新增 Pi live PTY token 用例（`examples/tutorial/11-pi-live-pty.token.ittest.ts`，精确入口 `pnpm itest:token:pi-pty`）：PtyAgentDriver live 分支把 `from: harness` 借用的指定 provider 渠道与凭据注入沙盒，驱动真实 Pi TUI 打真实端点；catalog/组合/工具表同步登记该能力。

## 0.2.0 - 2026-09-04

### Added

- `from: harness` 渠道借用支持 `provider` 选择器（多 provider 宿主）：yaml 声明 `provider` 即借用该 provider 的渠道与凭据，不声明则维持宿主默认 provider 行为；`provider` 字段从「借用凭据时不可覆盖的端点字段」改为借用目标选择器。hint 与宿主默认 provider 不一致时不带宿主默认 model，须显式声明 `model`；hint 不存在于宿主配置与内置表时显式 missing，不回退默认 provider。`borrowChannel` 钩子签名增加可选第三参 `options.provider`，向后兼容。

### Fixed

- 宿主 E anthropic-messages 借用渠道 baseUrl 归一补 `/v1`：内置表与 models 配置的 anthropic-messages 条目按宿主约定不带版本前缀（宿主运行时自拼 `/v1/messages`），与本框架「baseUrl 含版本前缀」约定不一致，实调会 404；归一后原值经 `harnessBaseUrl` 保留，供回写宿主配置使用。

## 0.1.2 - 2026-09-04

### Added

- live 私密配置区新增 home 级发现位 `~/.env.e2e.yaml`：位于 repo 级与历史路径 `~/.config/x-agent-suite/` 之间，跨仓库共享；`LiveConfigSource` 新增 `"home-dot"` 成员（对穷举该联合类型的消费方属 additive 类型变更）。
- 文档化 live 渠道解析完整优先级链：env 字段覆盖 > `E2E_LIVE_CONFIG_PATH` 显式文件 > repo `.env.e2e.yaml` > `~/.env.e2e.yaml` > 历史 home 路径 > 声明内 `from: harness` 借用宿主默认渠道 > 代码显式 `LiveBackend` channel，见 `docs/spec/llm-fixture.md`。

### Fixed

- 宿主 E 渠道借用支持内置 provider 兜底：settings 默认 provider 不落盘用户 models 配置时（宿主内置注册表渠道），由 harness 包内置注册表快照解析 baseUrl/wire（按 `BOUNDARY-DEBT(harness)` 模式标注）；裸 `from: harness` 声明因此可解析出宿主默认渠道，消费者无需再自写解析器。用户 models 配置中的同名条目恒优先于快照。

## 0.1.1 - 2026-09-04

### Fixed

- 消除跨制品 `LiveBackend` 类身份依赖：`LlmBackend` 契约新增 `liveChannel` 品牌字段（`start()` 后可读），harness live 分支改为结构化判定。修复 pty-driver 制品把 `LiveBackend` 内联进 bundle 后，消费者从核心包创建的实例在 `instanceof` 检查中恒为 false、live 分支（`liveEnv` / `ctx.live`）静默失效的问题。PTY 制品新增构建期完整性守卫（禁止内联 `LiveBackend`）与跨制品行为冒烟。

## 0.1.0 - 2026-09-04

### Added

- 首个公开发布：通用 Agent 测试套件框架，核心聚合包 `x-agent-suite` 承载 contracts / driver / sandbox / llm-fixture / harness / observation / matrix 七个子路径，PTY 能力由独立制品 `@x-agent-suite/pty-driver` 分发；统一入口 `artifacts:pack` 从 Git history 推导 lockstep 版本、构建 tarball、生成清单与校验和，并执行仓库外安装冒烟。
