# 包分发、安装与版本管理

> 消费者在 `package.json` 中使用稳定包名，只切换依赖来源；框架维护同一版本和构建产物，同时支持本地包、远程下载、git 源码自构建与 npm registry。

## 与当前主线的关系

版本管理现在即可开始，不以公开发布为前提。打包与远程分发属于功能主线之外的交付能力：本规范先固定接口、版本和验收规则，contracts、driver、scenario、criterion、report 等模块继续按路线图演进。

`artifacts:pack` 提供跨仓本地制品交付；Release 工作流在同一轮构建后上传 GitHub Release，并将核心 tarball 发布到 npm。工作流接入不等于已完成首次 npm 发布，实际可用版本以成功发布记录为准。workspace 源码引用只用于本仓开发，不作为稳定交付承诺；兄弟仓库消费版本化制品，不依赖本仓目录结构。

## 核心决策

### 一种开发引用，四种交付方式

本地联调可以临时用 `link:` 引用源码目录；稳定交付在本地 tarball、HTTPS tarball、git 源码自构建与 registry version 之间切换依赖值。

四种方式分两线：

- **制品交付**（本地 tarball、HTTPS tarball、registry version）：必须来自同一 commit、同一版本、同一轮构建，不分别维护源码副本或安装专用实现；跨消费方比特级一致，SHA-256 可互验。
- **源码交付**（git 源码自构建）：消费方克隆固定 commit 后用统一入口自行构建；同一 commit 必得同一版本号，但构建比特不作跨环境一致承诺，验收承诺按该路径小节的降级清单执行。

### 内部实现模块与外部分发模块分离

现有 workspace 包继续作为内部实现模块，保持职责、测试和变更的局部性。对兄弟仓库优先提供聚合分发模块 `@xnightsky/x-agent-suite`，通过子路径导出各模块能力，隐藏 workspace 内部依赖解析和安装顺序。

个人 scope `@xnightsky` 不需要创建 npm 组织。CLI 命令仍为 `x-agent-suite`，私有源码根包与内部 `@x-agent-suite/*` 名称不变；聚合包导入统一使用 `@xnightsky/x-agent-suite/<子路径>`。打包显式固定附件名为 `x-agent-suite-<version>.tgz`，避免 pnpm 的 scoped 默认文件名影响 Release、安装器和补发校验。

聚合模块只承担分发接口，不复制领域逻辑。将来确有消费者只需单包安装时，再把对应内部模块提升为独立分发模块，不提前扩大发布面。按需安装形态（pip extras 等价物、触发条件与切片纪律）的完整评估见 [`research/on-demand-install-artifact-matrix.md`](../research/on-demand-install-artifact-matrix.md)。

### 原生能力显式选择

一个只用 JSONL driver 的消费者，不应该被迫编译 `node-pty`。PTY 能力使用独立分发模块 `@x-agent-suite/pty-driver`；核心聚合包不得依赖它，需要交互式 TUI 的消费者显式安装。

## 当前形态

x-agent-suite 已拆为 12 个 workspace 包：

| 包                           | 内容                                            | 运行时依赖             | 原生依赖           |
| ---------------------------- | ----------------------------------------------- | ---------------------- | ------------------ |
| `@x-agent-suite/contracts`   | 通用类型与接缝                                  | 无                     | 无                 |
| `@x-agent-suite/driver`      | `JsonlProcess` / `PtyProcess` / 严格 LF 分帧    | `node-pty`（PTY 路径） | **有**（PTY 路径） |
| `@x-agent-suite/sandbox`     | 临时 `HOME` / `cwd` / 环境剥离                  | 无                     | 无                 |
| `@x-agent-suite/llm-fixture` | fake provider / live backend                    | `yaml`                 | 无                 |
| `@x-agent-suite/harness`     | `HarnessProfile` / driver 组合                  | workspace 包           | 无                 |
| `@x-agent-suite/observation` | 判据调度 / 聚合 / 报告与旧检查兼容入口          | workspace 包           | 无                 |
| `@x-agent-suite/matrix`      | `runMatrix` / 报告落盘                          | workspace 包           | 无                 |
| `@x-agent-suite/assertions`  | 检查原语 / 确定性判据 / Judge 薄适配            | workspace 包           | 无                 |
| `@x-agent-suite/criteria`    | 确定性判据兼容重导出                            | workspace 包           | 无                 |
| `@x-agent-suite/runner`      | ScenarioSpec 执行 / repeat / eval CLI           | workspace 包           | 无                 |
| `@x-agent-suite/recall`      | 原生 `.recall` / ExecutionPlan / CLI            | `yaml`、workspace 包   | 无                 |
| `@x-agent-suite/judge`       | 通用 AI Judge / 具名 verdict / direct、borrowed | workspace 包           | 无                 |

`@x-agent-suite/driver` 的问题：它同时包含 `JsonlProcess`（零原生）和 `PtyProcess`（需 `node-pty`）。这意味着即使 consumer 只用 headless JSONL，也要背 `node-pty` 及其编译代价。

## 打包阶段解决的问题

### 问题一：consumer 怎么拿到这个包

当前 `exports` 指向源码 TS：

```json
{
  "exports": { ".": "./src/index.ts" }
}
```

后果：

- consumer 的工具链必须能转译 `node_modules` 里的 TS。
- consumer 跑 `tsc` 时会用**它自己的 tsconfig** 检查本框架源码。

**决策：发布态 `exports` 必须指向 `dist/`，带 `types`。** 裸 TS 不进跨仓分发面。

### 问题二：原生依赖被绑在核心入口上

`@x-agent-suite/driver` 的 PTY 能力对只使用 JSONL 的 consumer 是沉没成本。`optionalDependencies` 不能解决这个问题——`npm` / `pnpm` 默认安装 `optionalDependencies`，只有显式 `--omit=optional` 才跳过，而那是 consumer 的安装命令，框架控制不了。

**决策：按依赖形态拆包。**

### 问题三：workspace tarball 不能直接组成离线安装集

`pnpm pack` 会把 `workspace:*` 正确改写为包版本。例如当前 harness tarball 会依赖 `@x-agent-suite/contracts@0.0.0` 等内部包；但在没有 registry 时，包管理器仍会按版本号尝试解析这些依赖。即使调用方同时拿到全部 `.tgz`，也不能保证它们自动互相解析。

要求每个消费者维护本地 `overrides`、安装顺序或临时 registry，会把分发复杂度泄漏到兄弟仓库。

**决策：非 registry 交付优先安装一个对内部 workspace 自包含的聚合包；消费者不得感知内部 workspace 包路径。第三方纯 JS 依赖仍按标准 package dependencies 解析，不重复打进聚合 bundle。**

## 推荐拆分

```text
@x-agent-suite/driver        → JsonlProcess / LfFramer / AsyncQueue（零原生）
@x-agent-suite/pty-driver    → PtyProcess / 屏幕缓冲（依赖 node-pty + @xterm/headless）
@x-agent-suite/harness        → 组合 driver，根据 profile 选择 jsonl / pty
x-agent-suite/*               → 聚合分发子路径，覆盖全部零原生公共模块
```

这样：

- 只用 headless JSONL 的 consumer 不装 `node-pty`。
- 需要 PTY 的 consumer 显式依赖 `@x-agent-suite/pty-driver`。
- `@x-agent-suite/harness` 通过依赖注入或 peer 机制选择具体 driver 形态，而不是把两种形态都绑进来。
- 兄弟仓库默认只安装 `@xnightsky/x-agent-suite`，不处理内部包的安装顺序。

## 统一制品模型

一次候选构建至少产生：

```text
artifacts/<version>/
  x-agent-suite-<version>.tgz
  x-agent-suite-pty-driver-<version>.tgz   # 需要 PTY 时提供
  manifest.json
  SHA256SUMS
```

`manifest.json` 至少记录：

- SemVer 与 Git commit；
- Conventional Commits 策略、上一稳定 tag 与参与本次划版的提交标题；
- Node / pnpm 兼容范围；
- 每个制品的文件名、SHA-256 与用途；
- 核心包与 PTY 包的兼容版本；
- 构建时间与构建命令标识。

tarball 只包含运行所需的 `dist/`、类型声明、README、LICENSE、精简后的 `package.json`，以及核心包的两份公共 TargetTags YAML（`config/target-tags/keys.yaml`、`config/target-tags/instances.yaml`）。资源按文件白名单复制，不能整体打包 `config/`；PTY 包不重复携带。默认资源从所属包根定位，源码态和安装态共用机制，不依赖消费者同名目录；显式路径覆盖仍有效，资源缺失或不可读即显式失败。不得包含测试、home/live 私密配置、绝对路径、源码仓临时文件或消费者专属 profile。核心包把 `yaml` 声明为普通运行时依赖并保持 external，不把其源码和 sourcemap 内容复制进聚合 bundle；安装时由 pnpm/npm 或内部 registry 按 lockfile 解析。

核心包仓库外安装冒烟不仅验证导入，还在空临时 home 中用默认路径加载公共 TargetTags，并通过合成配置调用 Recall 前置装载。随后对已安装的独立 CLI bundle 执行 `live.disallowed` 拒绝探针，并预加载禁止 `fetch` 的钩子；不传源码 `repoRoot`、不调用真实 provider，避免源码布局或用户 home 掩盖漏打包/安装态定位错误。

## 生产端如何打包

### 当前状态

仓库已经提供根级统一入口 `artifacts:pack`。它从 Git history 自动推导版本，在隔离临时目录构建核心聚合包和 PTY 包，生成 manifest 与 SHA-256，并在仓库外临时 consumer 中完成运行时导入和 TypeScript 类型冒烟。当前实现把十一个内部 workspace 模块汇入两个外部分发包：核心包将 `yaml` 声明为外部纯 JS 运行时依赖，不再把其实现或 sourcemap 源码内联进 bundle；Judge 通过 `@xnightsky/x-agent-suite/judge` 子路径进入核心包，并以 fake client 完成无 token 行为冒烟，不新增独立 tarball。PTY 包单独承载原生依赖，构建期校验其 bundle 不得内联 `LiveBackend` 类实现（跨制品 live 判定只走契约品牌字段 `LlmBackend.liveChannel`），PTY 冒烟 consumer 刻意混装核心制品，按行为断言消费者侧 `LiveBackend` 实例经 PTY 制品驱动路径时 live 分支真实生效。严格离线安装仍须预热包含 `yaml` 的 pnpm store，或使用可达的内部 registry。稳定制品全部成功后，命令为当前 HEAD 自动补 annotated SemVer tag。

源码 workspace 的 `0.0.0` 继续作为私有仓库占位值；可安装版本仅写入 staged package manifest，不修改源码 package。直接对单个 workspace 执行 `pnpm pack` 仍然不是合法交付流程。

### 统一打包命令契约

从当前干净的 HEAD 生成稳定版本；版本由最近的稳定 tag 和其后的 Conventional Commits 自动推导：

```bash
pnpm artifacts:pack

# 可选：断言自动推导结果必须是 0.1.0
pnpm artifacts:pack -- --version 0.1.0
```

默认输出：

```text
artifacts/0.1.0/
  x-agent-suite-0.1.0.tgz
  x-agent-suite-pty-driver-0.1.0.tgz
  manifest.json
  SHA256SUMS
```

`--version` 是**期望值校验**，不是临时改版本。若 Git history 推导结果不是 `0.1.0`，命令失败。稳定模式始终先运行 `pnpm check` 和仓库外安装冒烟；完整制品形成后才创建 `v0.1.0` annotated tag。命令拒绝 dirty working tree 和已存在的输出目录，避免从不同内容覆盖同名固定版本。

当前开发 HEAD 的试用包使用 snapshot 模式：

```bash
pnpm artifacts:pack -- --snapshot
```

该模式从目标版本、日期和当前 commit 计算唯一版本，例如 `0.1.0-dev.20260828.df7759b`，并写入隔离打包区；不得修改工作区中的正式版本文件。

需要把制品输出到指定目录时使用：

```bash
artifact_output="$(pwd)/artifacts/0.1.0"
pnpm artifacts:pack -- --version 0.1.0 --output "$artifact_output"
```

统一入口内部负责检查、build、聚合包生成、PTY 包生成、manifest、SHA-256、仓库外消费冒烟和稳定 tag；调用方不得分别运行若干 `pnpm pack` 后手工拼成制品集。

### 从打包到安装的完整链路

```text
干净且已提交的 HEAD
  → pnpm artifacts:pack -- --version <V>
  → artifacts/<V>/*.tgz + manifest.json + SHA256SUMS
  → 当前 HEAD 获得 annotated tag v<V>
  → 直接使用兄弟路径，或复制到消费者 vendor/
  → 消费者 package.json 使用 file:<tarball-path>
  → pnpm install + 提交 lockfile
```

## 安装方式

> 本地 tarball 与 git 源码自构建当前即可用；远程下载须确认对应 Release 已成功上传，npm 安装须确认该版本已成功发布。`link:` 源码目录引用仍是开发态联调手段，不是交付能力。核心 tarball 对内部 workspace 自包含，但仍有标准外部依赖；严格断网环境必须预热 pnpm store 或使用可达的内部 registry，不能只复制单个 core tarball 后期待首次安装完成。

### 开发态：本地源码目录引用

“本地 ref”校准为“本地源码目录引用”。它引用一个可变目录，不是版本，也不产生稳定制品身份。

`link:` 当前即可用于跨仓联调，前提有二：

- 本仓先完成 `pnpm install`（内部 workspace 包经本仓 `node_modules` 闭合解析），需要 `dist/` 产物时再执行本仓构建；
- 消费方使用能直接执行 TS 的工具链（如 tsx），或消费本仓已构建的 `dist/`。

承诺边界见下方使用限制；要形成可复现的跨仓依赖，请升级到方式一或方式三。

假设两个仓库位于同一父目录，在对方仓库执行：

```bash
pnpm add -D ../x-agent-suite
```

pnpm 从本地目录安装时会创建符号链接，等同于 `pnpm link`。对方的 `package.json` 应明确表达这种开发态语义：

```json
{
  "devDependencies": {
    "x-agent-suite": "link:../x-agent-suite"
  }
}
```

使用限制：

- x-agent-suite 目录必须先完成依赖安装和构建；修改后由其自身的 build/watch 流程更新 `dist/`。
- `link:` 不验证 tarball 内容、版本改写、依赖完备性、校验和或离线安装，因此不能替代打包验收。
- 除非 CI 也明确检出两个仓库并保持相同相对路径，否则不把 `link:` 和由它产生的 lockfile 变更提交到共享分支。
- 联调结束后必须恢复为下列任一版本化交付方式，才能形成可复现的跨仓依赖。

### 交付方式一：本地打包制品（tarball）

**前置步骤：先按[生产端如何打包](#生产端如何打包)生成并校验完整制品集。**

本方式用于本机开发、受控离线环境、兄弟仓库联调和发布前验收。它只消费生产端统一打包命令产生的 `artifacts/<version>/`，不在对方仓库重新打包。所谓受控离线，是指目标环境已经通过 lockfile 预热包含 `yaml` 的 pnpm store，或能够访问内部 registry；制品集只负责 x-agent-suite 自身两个 tarball，不复制第三方包。

#### 路径 A：同机兄弟仓库直接引用

假设两个仓库位于同一父目录，对方 `package.json` 可以直接指向 x-agent-suite 的本地输出：

```json
{
  "devDependencies": {
    "@xnightsky/x-agent-suite": "file:../x-agent-suite/artifacts/0.1.0/x-agent-suite-0.1.0.tgz",
    "@x-agent-suite/pty-driver": "file:../x-agent-suite/artifacts/0.1.0/x-agent-suite-pty-driver-0.1.0.tgz"
  }
}
```

这种方式不复制文件，但依赖两个仓库的相对位置，只适合本机联调或明确使用相同 checkout 布局的 CI。

#### 路径 B：复制到对方仓库

对方也可以把整组制品复制或下载到自己的 `vendor/x-agent-suite/0.1.0/`。`vendor/` 不是 x-agent-suite 自动生成的目录，必须由人工交接或对方 CI 的制品准备步骤填充。

```json
{
  "devDependencies": {
    "@xnightsky/x-agent-suite": "file:./vendor/x-agent-suite/0.1.0/x-agent-suite-0.1.0.tgz",
    "@x-agent-suite/pty-driver": "file:./vendor/x-agent-suite/0.1.0/x-agent-suite-pty-driver-0.1.0.tgz"
  }
}
```

两条路径都必须先用同一制品集中的 `SHA256SUMS` 校验 tarball，再在对方仓库执行 `pnpm install`。只使用核心能力时删除 PTY 依赖。`artifacts/` 在 x-agent-suite 中被 Git 忽略；`vendor/` 是否提交由对方策略决定，不提交时 CI 必须先恢复同一版本和校验和。不得用 `pnpm link` 代替制品验收。

### 交付方式二：远程 tarball（尚未开通）

源码仓库 <https://github.com/xnightsky/x-agent-suite> 仅提供源码，不能作为 pnpm 依赖直接安装（理由见交付方式三）；远程制品上传尚未执行，当前可用交付方式为本地 tarball（方式一）与 git 源码自构建（方式三）。本节固定的是制品存储就绪后的目标接口，下文 URL 均为示意。

就绪后用于需要从内部制品存储获取固定版本的兄弟仓库：

```bash
# 在对方仓库根目录执行
pnpm add -D https://artifacts.example/x-agent-suite/0.1.0/x-agent-suite-0.1.0.tgz
```

对应的 `package.json`：

```json
{
  "devDependencies": {
    "@xnightsky/x-agent-suite": "https://artifacts.example/x-agent-suite/0.1.0/x-agent-suite-0.1.0.tgz",
    "@x-agent-suite/pty-driver": "https://artifacts.example/x-agent-suite/0.1.0/x-agent-suite-pty-driver-0.1.0.tgz"
  }
}
```

也可以先下载并校验，再按本地方式安装：

```bash
curl -fL <artifact-url> -o x-agent-suite-0.1.0.tgz
sha256sum -c SHA256SUMS
pnpm add -D ./x-agent-suite-0.1.0.tgz
```

只使用核心能力时删除 PTY 依赖。正式地址、鉴权方式和保留周期由制品存储决定。凭证不得写入 URL、package.json、lockfile 或仓库文档；私有下载优先使用短期凭证或包管理器认证配置。对方提交 lockfile，CI 通过相同 URL 和完整性记录复现安装。

### 交付方式三：git 源码自构建（验收承诺降级）

用于需要审阅或修改源码、制品分发通道不可用，或已经取得源码与完整依赖缓存后自行构建的兄弟仓库。严格断网环境不能从 `git clone` 和空 pnpm store 起步：必须事先取得固定 commit 的源码，并预热 lockfile 所需的完整 pnpm store，或能够访问内部 registry。

**直接以 git URL 作 pnpm 依赖不可用**：聚合包是 `artifacts:pack` 打包时在隔离区现造的，源码树中不存在；源码版本号为 `0.0.0` 占位、内部依赖为 `workspace:*`、仓内无 `dist/` 构建产物。合法形态是消费方克隆固定 commit 后用统一入口自构建，再按方式一引用产出的本地 tarball：

```bash
git clone https://github.com/xnightsky/x-agent-suite
cd x-agent-suite
git checkout <完整 commit SHA>
corepack pnpm install --frozen-lockfile
pnpm artifacts:pack -- --snapshot
```

消费方自构建使用 snapshot 模式；稳定模式会为 HEAD 补 annotated tag，属发布侧动作，不应发生在消费方克隆中。

与制品方式的差异（降级项，选用即显式接受）：

- 版本号由 git history 推导，同一 commit 必得同一版本号；但构建比特不作跨环境一致承诺（node/pnpm 版本与平台差异），`SHA256SUMS` 只在本次构建内自洽，不能与其他消费方的构建互相校验。
- 构建责任与构建环境（node/pnpm 版本、`pnpm check` 通过）转移到消费方侧。
- 依赖身份真相源是 pinned commit；lockfile 记录的是本地 tarball 路径与本机 SHA-256，CI 复现需重复同一克隆与构建流程。
- 核心包与 PTY 包必须来自同一次自构建，不与其他来源混用。

选型建议：能用制品方式（一/二/四）时不选本方式；本方式的价值在源码可见性与自构建兜底，不在便捷。

### 交付方式四：npm registry（核心聚合包）

当前自动发布只覆盖主分发包 `@xnightsky/x-agent-suite`，不逐个发布内部 workspace，不要求创建 npm 组织。PTY 制品仍随 GitHub Release 交付，本次不发布到 npm；需要 PTY 时使用同版本的完整 tarball 制品集，不把本节当作 PTY 的 registry 安装承诺。

#### 维护者配置与发布

1. 在 npm 创建具有包发布写权限、允许 Bypass 2FA 的 granular access token；首次包尚不存在时，可临时使用短有效期的 All Packages Token，但须接受其对账号可访问包的写权限。
2. 在当前 GitHub 仓库的 `Settings → Secrets and variables → Actions → Repository secrets` 保存 `NPM_TOKEN`。不要放到另一个仓库、提交到源码或输出到日志。首次发布后，新建仅授权 `@xnightsky/x-agent-suite` 的 Token，更新同名 Secret 并撤销临时 Token。
3. 按版本治理准备 changelog 与干净 release commit；经明确授权后推送稳定 annotated `v<version>` tag。既有 tag 不会自动获得这次工作流修改，不移动旧 tag 来补发。
4. `.github/workflows/release.yml` 校验 tag 与默认分支来源，执行检查、构建和安装冒烟，生成完整制品集并上传 GitHub Release。
5. 同一 job 直接执行 `npm publish artifacts/<V>/x-agent-suite-<V>.tgz --access public --provenance --registry https://registry.npmjs.org`，不从仓库根或 workspace 重新打包。`setup-node` 配置 npm registry，只有发布步骤接收 `NODE_AUTH_TOKEN`，`id-token: write` 用于来源证明。

根 package 的 `private: true` 和 `0.0.0` 占位保持不变；实际 npm 包名与版本来自 staged manifest，核心包的 `repository.url` 与 GitHub 来源证明保持一致。首次成功发布时 npm 自动创建包，包名是否允许注册与 Token 权限由 npm 校验。

缺少 Token、认证失败、包名冲突或版本已存在时，npm 步骤显式失败，不忽略错误。GitHub Release 先于 npm 创建，npm 失败不会撤销已有 Release；须分别检查两个渠道。npm 已发布版本不可覆盖，重跑前先核对该版本是否已成功发布；内容有改动必须生成新版本。

若 GitHub Release 已成功、只有 npm 失败，更新凭据后不要直接重跑整个构建 job。经授权可从默认分支手动触发 `.github/workflows/npm-republish.yml`，输入不含 `v` 的稳定版本，例如已成功上传的 scoped 版本。该入口只读既有 Release，校验 annotated tag 可达默认分支、清单版本与提交、manifest/core 双重 SHA-256，以及 tarball 内主包身份；全部通过后才发布同一文件，不重新构建、不移动标签、不覆盖附件、不执行包生命周期脚本。补发来源证明记录的是恢复工作流，原制品源码提交仍由 tag 与 manifest 核对。

补发仅接受 tarball 内包名 `@xnightsky/x-agent-suite`，拒绝历史无 scope 主包，避免重新创建已弃用的旧包。改名须在新版本重新构建，不修改既有 tarball、tag 或附件。

```bash
gh workflow run npm-republish.yml --ref main -f version=0.7.2 # 示例，替换为已有的 scoped Release 版本
```

#### 消费者安装

以下 `0.1.0` 仅为版本格式示例，替换为 npm 上已成功发布的实际版本：

```bash
pnpm add -D --save-exact @xnightsky/x-agent-suite@0.1.0
```

对应的 `package.json` 必须钉住明确版本，不使用 `latest`：

```json
{
  "devDependencies": {
    "@xnightsky/x-agent-suite": "0.1.0"
  }
}
```

对方的 lockfile 钉住 registry 解析结果。npm 只改变解析与下载入口，不改变模块接口、子路径、运行行为或测试口径。发布复用已完成本地安装验收的同一 tarball，不另构建一份 npm 专用产物。

## 兄弟仓库的依赖约定

- 包应放在 `devDependencies`，因为它服务于测试与验收，不进入消费者生产运行依赖。
- `@xnightsky/x-agent-suite` 安装时会按 package manifest 解析纯 JS 依赖 `yaml`；消费者不单独声明它，也不把它当作第三个 x-agent-suite 制品维护。
- 稳定交付只选一种来源：本地 `file:` tarball、HTTPS tarball、git 源码自构建（产物以本地 tarball 引用）或 registry version，不混合核心包与 PTY 包的来源。
- `@xnightsky/x-agent-suite` 与 `@x-agent-suite/pty-driver` 必须使用相同版本；不需要 PTY 时只声明核心包。
- 提交 `package.json` 与 lockfile；CI 使用 `pnpm install --frozen-lockfile`，不得临时改写依赖版本。
- 不声明 `@x-agent-suite/*` 内部 workspace 包，不配置它们的路径、安装顺序或 `overrides`。
- `link:` 仅用于本地联调；不使用 `workspace:`、`link:`、git URL 直连、分支名或浮动的“最新制品”作为跨仓稳定依赖。
- 消费者自己的 profile、scenario、判据和运行脚本留在消费者仓库；本包不规定其目录结构。

对方仓库的最小安装闭环是：按所选来源填写 `devDependencies`，运行 `pnpm install` 并提交 lockfile；CI 只根据这两个文件恢复依赖。API 使用与业务侧组合不属于安装来源差异，另行维护使用文档。

## CLI 安装约定

`@xnightsky/x-agent-suite` 聚合包已声明 `bin`，作为项目内开发依赖使用，不要求全局安装。

同一入口支持原 Runner 与原生 Recall：

```bash
pnpm exec x-agent-suite eval <config-module>
pnpm exec x-agent-suite recall (--carrier <id> | --provider <id> | --model <id>) [--live-config <yaml>] [--registry <module.ts>] [--plan <yaml>] [--execution-params <json-object>] [YAML|目录]
```

`@xnightsky/x-agent-suite/recall` 同一子路径导出显式 target 装载/执行、独立 registry、effects-only Plan 和场景资源物化 API，并复用聚合包内现有 llm-fixture live resolver/TargetTags 与 harness hooks。统一 CLI 不再读取 `x-agent-suite.config.ts`；消费者 Criterion/profile/EffectsProfile 仍通过显式 `--registry` 提供。

`@xnightsky/x-agent-suite/profiles/pi-config` 是独立消费者配置投影入口：源码在根 `profiles/`，不放入 `packages/*/src/`，不内建注册执行器，不给 Harness 契约添加 Pi 字段。核心制品显式打包该入口 JS/声明，并继续按白名单携带公共 `config/target-tags/{keys,instances}.yaml`；不打包任何私密 live/auth/宿主配置。仓库外安装冒烟覆盖入口导入/类型、隔离 settings 继承 high、单次覆盖 low、模型思考映射和宿主文件不变；只用合成配置，零 provider 请求，不新增 token 冒烟。

`@xnightsky/x-agent-suite/assertions` 在核心聚合包内分发，不新增第三个 tarball；原有 `criteria` 和 observation 检查入口仍可使用。`@xnightsky/x-agent-suite/profiles/pi-recall` 同样显式打包 JS/声明，消费者自行注册 `createPiRecallDriver`，不会因 carrier 名自动启用。仓库外安装冒烟使用 fake Judge 与 fake CLI 验证适配、配置继承和清理，不接真实 provider。

需要任意目录可调用的全局 CLI 时，使用 `pnpm run install:global -- <制品目录>`：校验正式 manifest 与校验和后只安装核心包，不隐式构建、不发布、不初始化用户配置。全局 bin/PATH 须由执行者准备；详细前置、跨仓路径规则和验收边界见[全局 CLI 安装](./global-cli-install.md)。

## 版本管理

Git history 与稳定 tag 是版本真相源，核心包和 PTY 包采用 lockstep；源码 workspace 的 `0.0.0` 不改。完整递增规则、changelog 发布准备、tag 时机、固定版本重打、snapshot 和 `0.6.1 → 0.7.0` 升级说明见 [版本治理与发布准备](./versioning.md)。

## 制品验证

每次形成候选制品后，在仓库外的新临时项目中执行：

1. 从本地 tarball 安装核心包，并确认包管理器按 manifest 安装 `yaml`；
2. 检查 core 的 JS 与 sourcemap 不再包含 `yaml` 源码；
3. TypeScript 编译所有公开子路径的最小示例；
4. 运行 JSONL / sandbox / fixture / matrix 冒烟测试；
5. 在仓库外调用无参数 `loadTargetTagCatalog()`，确认包内词典和实例可加载，并保留 fake client 的 Judge 行为冒烟；
6. 安装 PTY tarball，并在支持的平台运行 PTY 冒烟测试；
7. 开通远程分发时，通过临时 HTTP 地址重复远程 tarball 安装；
8. 发布 registry 前，通过临时 registry 重复按包名安装；
9. 检查 tarball 内容、版本、commit 与 SHA-256 一致。

只有 workspace 测试通过，不能替代制品安装验证。

## 阶段推进

| 阶段           | 交付                                                               | 是否阻塞当前功能主线         |
| -------------- | ------------------------------------------------------------------ | ---------------------------- |
| 文档与版本基线 | 本文、`0.1.0` 起始策略、根 changelog                               | 已完成                       |
| 本地打包       | `dist/`、聚合包、PTY 拆分、`artifacts:pack`、本地 tarball 冒烟测试 | 已完成（含 YAML 外置）       |
| git 源码交付   | 消费方克隆固定 commit，统一入口自构建，降级承诺成文                | 已完成（本文）               |
| 远程 GET       | 上传同一 tarball、manifest 与校验和，验证私有下载                  | 否，本地打包后按需做         |
| registry       | 核心主包复用同一 tarball 发布 npm；独立 PTY 不在本次范围           | 工作流已接入，以发布记录为准 |

## 验收条件

- 各交付方式使用相同包名、子路径和版本语义；`link:` 源码目录引用明确标记为非交付方式，git 源码自构建的降级承诺显式成文。
- `pnpm artifacts:pack` 从 Git history 推导版本，校验干净提交后生成完整制品集并补 annotated tag。
- 本地 tarball 的 `file:` 路径能追溯到同一次 `artifacts:pack` 输出，不出现来源不明的 `vendor/` 文件。
- 本地 tarball 与远程 tarball 的 SHA-256 相同；git 源码自构建只承诺同 commit 同版本号，不承诺跨环境同比特。
- 仅依赖核心聚合包的 consumer，安装时只增加纯 JS `yaml` 依赖，不触发 C++ 编译。
- core 的 bundle 与 sourcemap 不复制 `yaml` 源码，许可证由独立安装的 `yaml` 包自行携带。
- PTY 能力通过单独包 `@x-agent-suite/pty-driver` 提供。
- consumer 不配置内部 workspace 包的路径、override 或安装顺序。
- 所有对外 `exports` 指向 `dist/`，带类型声明。
- consumer 不转译 `node_modules` 中的 TypeScript 源码。
- version、tag、manifest 与 tarball 相互一致，changelog 覆盖消费者可见变化。
- `pnpm check` 与仓库外安装冒烟测试全部通过。

## 外部依据

- [Semantic Versioning 2.0.0](https://semver.org/)
- [pnpm workspace protocol、pack 版本改写与 release workflow](https://pnpm.io/workspaces)
- [pnpm pack](https://pnpm.io/cli/pack)
- [pnpm 支持的安装来源](https://pnpm.io/cli/add)
- [pnpm 本地 tarball、目录与远程 tarball 语义](https://pnpm.io/package-sources)
- [npm package spec：本地与远程 tarball](https://docs.npmjs.com/cli/v11/using-npm/package-spec/)
