# 变更记录

本文件记录影响消费者接口、行为、安装、配置、协议或报告格式的变化。版本遵循 [Semantic Versioning 2.0.0](https://semver.org/)；源码 workspace 的 `0.0.0` 是不可发布占位值，制品版本由 Git history 与稳定 tag 管理。开发中的变化记入 `Unreleased`；发布准备时允许先提交目标版本章节，完整验收成功后再生成对应稳定 tag。版本章节本身不表示制品已形成，流程见 [版本治理](docs/spec/versioning.md)。

## Unreleased

### Changed

- 对外主分发包统一改为 `@xnightsky/x-agent-suite`，同步公开子路径导入、安装后公共资源定位、全局安装提示和补发身份校验；CLI 命令、私有源码根包、内部 workspace 名及 Release 附件名不变。scoped 包必须使用新构建版本，补发入口拒绝旧无 scope tarball，不修改历史标签或附件。

### Fixed

- 增加 npm 失败后的只读补发入口，下载既有 Release 主制品并复用双重哈希校验，核对稳定版本、来源提交及包身份后发布；不重建同版本、不覆盖 Release 附件，缺少凭据或校验失败时拒绝调用 npm。

## 0.7.1 - 2026-10-28

### Added

- Release 工作流在同一构建中将既有核心聚合 tarball 发布到 npm，并保留 GitHub Release 附件；使用本仓 `NPM_TOKEN`、公开访问与 provenance，不逐个发布内部 workspace，也不新增 npm 组织要求。核心制品补齐仓库来源元数据，缺少凭据或 npm 拒绝发布时显式失败；新增发布命令零网络回归和配置说明。
- 增加仓库内可复用场景资产与显式 token 验证入口，默认回归继续排除真实 provider 测试；不把集成场景资产打入公共制品。

### Fixed

- `cleanupSandbox` 在 POSIX 删除前通过不跟随叶链接的目录句柄解锁受管目录，避免只读物化目录导致 `EACCES` 与临时目录泄漏；核对 inode 后对句柄修改权限，防止检查后叶被换成链接时改写外部目标。根链接只删自身，Windows 沿用原删除逻辑，`E2E_KEEP_SANDBOX` 与有限重试策略不变；清理前须先停止目录写入进程。
- Recall 资源物化目标路径防护：`sandbox.cwd` 根与逐段父目录都以 `lstat` 判定，既有符号链接或非目录即拒绝；创建父目录成功或遇 `EEXIST` 后重新校验，堵住直接继续写入的缺口。目标叶已存在（文件/目录/链接）一律显式拒绝；物化期间须独占目录树，路径检查不提供任意并发替换下的原子隔离。
- Recall 资源来源面 fail-closed：目录资源内任何符号链接（含指向 rootDir 内）在编译期与物化前各拒绝一次，不再经 `cp` 保留链接后由 `chmod` 跟随改写链接目标；`compiled.source` 是物理绝对路径，物化前逐段 `lstat` 拒绝祖先或叶被替换成链接；`markReadOnly` 改为逐层 `lstat` 三态（链接拒绝/目录 0555/文件 0444）。顶层 `source` 指向 rootDir 内的合法链接仍按既有 realpath 语义放行。
- Recall 场景可直接声明隔离资源，无执行 Plan 时仍保持 `effects: none`，资源挂载不隐式增加模型工具权限；受信任 Profile 可显式开启隔离项目上下文发现，默认关闭。修正兼容渠道快照的协议与版本路径。

### Changed

- borrowed 测试暂不按 usage 计费分类过滤，不需要伪造订阅类型；direct 的 API 用量要求，以及 live unknown/disallowed 拒绝和 review-required 单次审批门禁保持不变。

## 0.7.0 - 2026-10-28

### Added

- 原生 `@x-agent-suite/recall`：复用 `.recall/` 目录，提供确定发现、严格 YAML v1、context 只读 provision、全量前置校验、case/repeat 独立执行和 `x-agent-suite recall` CLI；聚合包新增 `x-agent-suite/recall` 子路径与统一 `bin`。采用显式 carrier/provider/model、独立 Criterion/profile/EffectsProfile registry、effects-only Plan、文件内 `plans/context.plan`、direct 纯文本与唯一 borrowed profile，并保留 target/mode/cliRef/provision/effects 报告归因。
- 通用 `@x-agent-suite/judge`：批量 rubric 返回具名 boolean verdict，不直接出分；支持可注入 client、超时、重试及 TargetTags 驱动的 direct/borrowed 选择。通过 `x-agent-suite/judge` 子路径分发，不新增独立制品。
- TargetTags：YAML 词典、CLI/provider/provider-model/model 四层实例、home 私有实例与 live 覆盖、能力与 wire 检查、live 门禁及单/多目标决策；公共实例不携带秘密，不以标签或来源隐式授权真实调用。
- live 支持多 provider/model 可选目录、carrier 范围内的 defaults、`resolveLiveTargets` 显式选择及结构化兼容告警；token 教程同步多目标执行和模型参数透传。
- live 新增可选 `.env.auth.yaml`：按 provider ID 或 `auth.provider` 显式绑定 API key，支持 `E2E_AUTH_CONFIG_PATH`、repo/home 发现、runtime > auth-file > model-config 优先级、失败不回退及 backend/sniff 统一脱敏；配置参考与教程同步。
- `install:global` package script：显式接收正式制品目录，先校验清单、SHA-256 与路径边界，再全局安装核心 CLI；不自动构建/发布，不安装 PTY，不初始化用户配置，新增失败回归与隔离全局安装验收说明。
- Recall 单次 `--execution-params <JSON对象>` / `executionParams` API：按 case/repeat 隔离透传给已选 Profile/Adapter，不改变渠道、权限或路由；新增独立消费者入口 `x-agent-suite/profiles/pi-config`，复用原生模型配置并默认继承宿主思考档位，仅显式 `thinkingLevel` 覆盖隔离 settings。
- `x-agent-suite/assertions`：统一原有检查原语与确定性判据，旧 `criteria` 和 observation 检查入口保留兼容重导出，不保留重复实现；新增 `createJudgeAssertion`，将调用方注入的 Judge client 与每轮 `expect` 适配为 `TurnCriterion`，不可评测与缺证据显式报错。
- `x-agent-suite/profiles/pi-recall`：提供显式注册的单轮 Pi 工厂，复用 Harness 与原生配置投影；限制工具、路径、预算与子进程环境，支持调用方显式追加系统提示，不增加核心宿主契约或默认注册。

### Changed

- 多目标执行必须显式给出 carrier/provider/model 之一，不允许无参数执行全部 defaults；`LiveConfigLoad` loaded 分支新增必填 `available/defaults/warnings`，手工构造该类型的适配或测试替身需同步。
- 聚合包以统一 CLI 承接原 Runner 的 eval/run/diff 与新 Recall；Recall 不读取 `x-agent-suite.config.ts`，执行级 Plan 只声明 effects，不承载 driver、判据或 provision 配置。
- Recall Carrier 路由修正：`kind: cli`（含省略 kind）始终选择真实 CLI 的唯一 borrowed Profile，不再内建 HTTP direct；纯渠道调用须迁移为 `kind: ephemeral-client + clientRef`。borrowed 接受真实 api-payg/api-credit/api-free，不必伪造 subscription；unknown 与审批门禁不变。

### Deprecated

- 旧 `carriers.*.provider/model` 单模型格式继续兼容，但会产生 `deprecated-carrier-model` 告警；建议迁移到 `providers/default`，暂无移除日期。

### Fixed

- TargetTags 默认资源定位兼容源码仓和安装包：核心制品按白名单携带两份公共 YAML，从所属包根加载，不误读取消费者同名目录；包内资源缺失显式失败，新增隔离安装布局回归，以及隔离 home 的公共标签、Recall 前置装载和独立 CLI live 拒绝门禁的仓库外冒烟（零 token）。
- Pi live 配置不再套用 fixture 的 `reasoning:false` / `defaultThinkingLevel:"off"`；保留原生 provider ID、模型能力、思考映射与分档采样，仅在隔离目录写入已选渠道/凭据，不改真实 HOME。制品冒烟增加默认思考保真断言。
- JSON-RPC 严格按响应 ID 的类型与值配对，避免字符串 ID 错配数值请求。
- borrowed Judge 在启动期间取消或超时后，不再因延迟启动完成而继续发送请求。
- Runner 在驱动启动失败时仍执行资源清理；全局安装测试按规范路径断言，兼容 macOS 临时目录别名。
- live 策略合并不因 provider 或 provider-model 缺层而掩盖另一层的 disallowed/review-required 限制。
- 开发态 `node-pty@1.1.0` 补丁恢复 macOS prebuild 的 spawn-helper 可执行位，修复本仓 PTY 启动失败；不改变 PTY 制品的依赖形态。
- CI 集成测试步骤修正为 `pnpm ittest`。

### 升级说明

- 相对 `0.6.1` 的配置、类型替身、安装及授权注意事项见 [0.7.0 升级说明](docs/spec/versioning.md#从-061-升级到-070)。Recall/Judge 的未发布中间态不视为上一稳定版接口；YAML schema 版本不随制品版本机械递增。
- 本次按操作者明确授权 rebase 主线并重新校准 `v0.7.0`，旧标签曾指向 `b40fec7`；新标签仅在重新完成稳定制品验收后形成。已取得旧版制品的消费者须按新 manifest 的 commit 与 SHA-256 重新核对，不混用新旧 `0.7.0` 制品。此次为一次性历史修正，不改变默认的版本不可变规则。

## 0.6.1 - 2026-10-19

### Fixed

- `createSandbox` 生成的 `homeDir`/`cwd` 创建即 realpath 规范化为物理路径：`tmpdir()` 可能含符号链接段（如 macOS 的 `/var` → `/private/var`），而子进程 `process.cwd()` 恒返回物理路径，此前消费者拿 `sandbox.cwd` 与子进程上报的 cwd 做字符串比较会永不命中。契约 `SandboxContext` 不变量与 `docs/spec/sandbox.md` 同步。

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
