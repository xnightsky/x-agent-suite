# 包分发、安装与版本管理

> 消费者在 `package.json` 中使用稳定包名，只切换依赖来源；框架维护同一版本和构建产物，同时支持本地包、远程下载、git 源码自构建与未来 registry。

## 与当前主线的关系

版本管理现在即可开始，不以公开发布为前提。打包与远程分发属于功能主线之外的交付能力：本规范先固定接口、版本和验收规则，contracts、driver、scenario、criterion、report 等模块继续按路线图演进。

`artifacts:pack` 已提供跨仓本地制品交付；远程上传与 registry 发布仍按需演进。workspace 源码引用只用于本仓开发，不作为稳定交付承诺；兄弟仓库消费版本化制品，不依赖本仓目录结构。

## 核心决策

### 一种开发引用，四种交付方式

本地联调可以临时用 `link:` 引用源码目录；稳定交付在本地 tarball、HTTPS tarball、git 源码自构建与 registry version 之间切换依赖值。

四种方式分两线：

- **制品交付**（本地 tarball、HTTPS tarball、registry version）：必须来自同一 commit、同一版本、同一轮构建，不分别维护源码副本或安装专用实现；跨消费方比特级一致，SHA-256 可互验。
- **源码交付**（git 源码自构建）：消费方克隆固定 commit 后用统一入口自行构建；同一 commit 必得同一版本号，但构建比特不作跨环境一致承诺，验收承诺按该路径小节的降级清单执行。

### 内部实现模块与外部分发模块分离

现有 workspace 包继续作为内部实现模块，保持职责、测试和变更的局部性。对兄弟仓库优先提供聚合分发模块 `x-agent-suite`，通过子路径导出各模块能力，隐藏 workspace 内部依赖解析和安装顺序。

聚合模块只承担分发接口，不复制领域逻辑。将来确有消费者只需单包安装时，再把对应内部模块提升为独立分发模块，不提前扩大发布面。

### 原生能力显式选择

一个只用 JSONL driver 的消费者，不应该被迫编译 `node-pty`。PTY 能力使用独立分发模块 `@x-agent-suite/pty-driver`；核心聚合包不得依赖它，需要交互式 TUI 的消费者显式安装。

## 当前形态

x-agent-suite 已拆为 7 个 workspace 包：

| 包                           | 内容                                         | 运行时依赖             | 原生依赖           |
| ---------------------------- | -------------------------------------------- | ---------------------- | ------------------ |
| `@x-agent-suite/contracts`   | 通用类型与接缝                               | 无                     | 无                 |
| `@x-agent-suite/driver`      | `JsonlProcess` / `PtyProcess` / 严格 LF 分帧 | `node-pty`（PTY 路径） | **有**（PTY 路径） |
| `@x-agent-suite/sandbox`     | 临时 `HOME` / `cwd` / 环境剥离               | 无                     | 无                 |
| `@x-agent-suite/llm-fixture` | fake provider / live backend                 | `yaml`                 | 无                 |
| `@x-agent-suite/harness`     | `HarnessProfile` / driver 组合               | workspace 包           | 无                 |
| `@x-agent-suite/observation` | checks / report                              | workspace 包           | 无                 |
| `@x-agent-suite/matrix`      | `runMatrix` / 报告落盘                       | workspace 包           | 无                 |

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
- 兄弟仓库默认只安装 `x-agent-suite`，不处理内部包的安装顺序。

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

tarball 只包含运行所需的 `dist/`、类型声明、README、LICENSE 与精简后的 `package.json`。不得包含测试、私密配置、绝对路径、源码仓临时文件或消费者专属 profile。核心包把 `yaml` 声明为普通运行时依赖并保持 external，不把其源码和 sourcemap 内容复制进聚合 bundle；安装时由 pnpm/npm 或内部 registry 按 lockfile 解析。

## 生产端如何打包

### 当前状态

仓库已经提供根级统一入口 `artifacts:pack`。它从 Git history 自动推导版本，在隔离临时目录构建核心聚合包和 PTY 包，生成 manifest 与 SHA-256，并在仓库外临时 consumer 中完成运行时导入和 TypeScript 类型冒烟。当前实现把七个内部 workspace 模块汇入两个外部分发包：核心包将 `yaml` 声明为外部纯 JS 运行时依赖，不再把其实现或 sourcemap 源码内联进 bundle；PTY 包单独承载原生依赖。严格离线安装仍须预热包含 `yaml` 的 pnpm store，或使用可达的内部 registry。稳定制品全部成功后，命令为当前 HEAD 自动补 annotated SemVer tag。

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

> 本地 tarball 与 git 源码自构建当前即可用；远程 tarball 接口已固定、制品存储尚未开通；registry 配置是未来发布时保持不变的目标接口。`link:` 源码目录引用仍是开发态联调手段，不是交付能力。核心 tarball 对内部 workspace 自包含，但仍有 `yaml` 这一标准外部依赖；严格断网环境必须预热 pnpm store 或使用可达的内部 registry，不能只复制单个 core tarball 后期待首次安装完成。

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
    "x-agent-suite": "file:../x-agent-suite/artifacts/0.1.0/x-agent-suite-0.1.0.tgz",
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
    "x-agent-suite": "file:./vendor/x-agent-suite/0.1.0/x-agent-suite-0.1.0.tgz",
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
    "x-agent-suite": "https://artifacts.example/x-agent-suite/0.1.0/x-agent-suite-0.1.0.tgz",
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

### 交付方式四：未来 package registry

registry 就绪后发布同版本、同内容的制品：

```bash
pnpm add -D x-agent-suite@0.1.0
pnpm add -D @x-agent-suite/pty-driver@0.1.0
```

对应的 `package.json` 必须钉住明确版本，不使用 `latest`：

```json
{
  "devDependencies": {
    "x-agent-suite": "0.1.0",
    "@x-agent-suite/pty-driver": "0.1.0"
  }
}
```

只使用核心能力时删除 PTY 依赖。对方的 lockfile 钉住 registry 解析结果。registry 只改变解析与下载入口，不改变模块接口、子路径、运行行为或测试口径。本地与远程 tarball 是 publish 前的真实安装验收面，避免出现“workspace 通过、发布包不可用”。

## 兄弟仓库的依赖约定

- 包应放在 `devDependencies`，因为它服务于测试与验收，不进入消费者生产运行依赖。
- `x-agent-suite` 安装时会按 package manifest 解析纯 JS 依赖 `yaml`；消费者不单独声明它，也不把它当作第三个 x-agent-suite 制品维护。
- 稳定交付只选一种来源：本地 `file:` tarball、HTTPS tarball、git 源码自构建（产物以本地 tarball 引用）或 registry version，不混合核心包与 PTY 包的来源。
- `x-agent-suite` 与 `@x-agent-suite/pty-driver` 必须使用相同版本；不需要 PTY 时只声明核心包。
- 提交 `package.json` 与 lockfile；CI 使用 `pnpm install --frozen-lockfile`，不得临时改写依赖版本。
- 不声明 `@x-agent-suite/*` 内部 workspace 包，不配置它们的路径、安装顺序或 `overrides`。
- `link:` 仅用于本地联调；不使用 `workspace:`、`link:`、git URL 直连、分支名或浮动的“最新制品”作为跨仓稳定依赖。
- 消费者自己的 profile、scenario、判据和运行脚本留在消费者仓库；本包不规定其目录结构。

对方仓库的最小安装闭环是：按所选来源填写 `devDependencies`，运行 `pnpm install` 并提交 lockfile；CI 只根据这两个文件恢复依赖。API 使用与业务侧组合不属于安装来源差异，另行维护使用文档。

## CLI 安装约定

在路线图阶段 2 的 CLI 出现前，`x-agent-suite` 是项目内开发依赖，不提供全局安装承诺。

CLI 落地后由同一聚合包声明 `bin`，推荐项目内执行：

```bash
pnpm exec x-agent-suite run <scenario>
```

若以后确实需要全局软件安装，可复用同一 tarball 或 registry 包执行 `pnpm add -g`；全局安装是额外验收面，不反向改变库接口。

## 版本管理

### 起始版本与版本策略

- `0.0.0` 仅是仓库占位版本，不作为可安装制品版本。
- 首个版本化基线使用 `0.1.0`。
- 初期两个对外分发包采用 **lockstep versioning**：聚合包与 PTY 包使用同一版本；内部 workspace 仍是不可发布实现模块。
- 版本身份独立于公开发布；本地 tarball、远程制品同样必须有正式版本。
- 在多包兼容关系尚未形成真实独立演进需求前，不采用 independent versioning。

### `0.y.z` 期间的递增规则

本库遵循 SemVer 2.0.0，并对 major-zero 阶段收紧约定：

| 变更                             | 版本递增   | 示例                                |
| -------------------------------- | ---------- | ----------------------------------- |
| 破坏公共接口、改变协议或删除能力 | MINOR      | `0.1.0` → `0.2.0`                   |
| 向后兼容的新功能                 | MINOR      | `0.2.0` → `0.3.0`                   |
| 向后兼容的修复、性能或内部重构   | PATCH      | `0.2.0` → `0.2.1`                   |
| 仅 docs/style/test/chore         | 不单独发版 | 保留到下一次可发布变更              |
| 候选验证                         | prerelease | `0.3.0-alpha.0` → `beta.0` → `rc.0` |

`1.0.0` 表示公共接口进入稳定承诺期；至少应满足：主线验收闭环、两个独立消费者验证、安装制品稳定、破坏性接口已有迁移纪律。

### 单一版本真相源

- Git history 与当前提交上的稳定 tag 是版本真相源；根 package 和内部 workspace 的 `0.0.0` 只是不可发布占位值。
- Git tag 使用 `v<version>`，例如 `v0.1.0`；本次已获授权，稳定 `artifacts:pack` 成功后自动创建 annotated tag。
- 核心包、PTY 包、artifact 目录、tarball 文件名与 manifest 必须使用同一推导版本。
- `CHANGELOG.md` 归集消费者可见变化，不承担机器版本真相源。
- 一个版本一旦形成可消费制品，其内容不得覆盖或替换；任何修改都产生新版本。
- Git commit 写入 manifest，不塞入 SemVer build metadata，避免同版本出现多个内容。

### 固定版本与 HEAD 对齐

稳定版本 `V` 必须与一个干净的 release commit 一一对应，`v<V>` annotated tag 指向该提交。首次形成制品时 tag 不是前置条件，而是完整验收成功后的原子收口；重打历史固定版本时 tag 是首选构建来源，完整 commit SHA 仅用于恢复异常历史。

| 目标                         | 正确构建来源                         | 制品版本示例                 |
| ---------------------------- | ------------------------------------ | ---------------------------- |
| 重打已发布稳定版             | 对应 `v<V>` 或其完整 release commit  | `0.1.0`                      |
| 把当前 HEAD 形成新稳定版     | 先提交功能与 changelog，再从该提交打 | `0.2.0`                      |
| 共享尚未发布的当前 HEAD      | 干净且已提交的 HEAD                  | `0.1.0-dev.20260828.df7759b` |
| 工作区含未提交或未跟踪的变更 | **不得形成共享制品**                 | —                            |
| 从旧稳定线修复               | 从旧 release commit 分支出的新提交   | `0.1.0` → `0.1.1`            |

当源码占位 version 与当前 HEAD 不对应时：

- 要打既有固定版本，切到该版本的 release commit/tag 后打包，不从当前 HEAD 强行覆盖版本号；
- 要把当前 HEAD 打成稳定版本，先完成行为与 changelog 提交，再由 Git history 推导 lockstep 制品版本；
- 只需要给兄弟仓库试用当前 HEAD，则打唯一 snapshot，不冒充既有稳定版本。

固定版本的推荐过程：

1. 选择 `v<V>` 对应的 release commit，确认 changelog 覆盖该版本的消费者可见变化；
2. 确认该提交的工作树干净，并运行 `pnpm check`；
3. 从该 tag 或完整 commit 创建隔离的 detached worktree；
4. 在隔离目录执行 frozen install、构建、pack 和仓库外安装冒烟测试；
5. manifest 记录 `version: V`、完整 commit 和 `dirty: false`，再生成 SHA-256；
6. 只有同一 tag/commit 可以重打同版本；不同 commit 必须形成新版本。

重打固定历史版本使用隔离 worktree，避免当前 HEAD 污染目标版本：

```bash
release_ref=v0.1.0 # 没有 tag 时使用完整 commit SHA
artifact_output="$(pwd)/artifacts/0.1.0"
release_root="$(mktemp -d)"
release_dir="$release_root/repo"
git worktree add --detach "$release_dir" "$release_ref"
(
  cd "$release_dir"
  corepack pnpm install --frozen-lockfile
  pnpm check
  pnpm artifacts:pack -- --version 0.1.0 --output "$artifact_output"
)
git worktree remove "$release_dir"
rmdir "$release_root"
```

### 开发 HEAD 的 snapshot 版本

snapshot 只允许来自干净且已提交的 HEAD，格式为 `<自动推导稳定版本>-dev.<YYYYMMDD>.<short-sha>`。例如首次基线是 `0.1.0-dev.20260828.df7759b`；已有稳定版后，由后续 Git history 自动选择 `0.1.1-dev...` 或 `0.2.0-dev...`。日期便于排序，commit 负责唯一定位源码。

- snapshot 的版本改写应发生在隔离打包区，不要求把每个 snapshot version 提交回主分支；manifest 仍记录完整 commit。
- snapshot 不创建稳定 tag，不使用 registry 的 `latest`，也不得覆盖同名 tarball。
- 兄弟仓库必须钉住完整 tarball URL/路径和 SHA-256，不能依赖“最新 snapshot”浮动别名。
- dirty working tree 没有可复现的 commit 身份；需要共享时先形成提交，再生成 snapshot。
- snapshot 验证通过不等于正式发布；转稳定版时仍需独立的版本准备提交和完整制品验收。

### 变更记录

采用根级 `CHANGELOG.md` 记录 lockstep 版本变化，不为七个内部模块分别维护重复 changelog。每个版本按需包含：

- Added：新增能力；
- Changed：接口或行为变化；
- Fixed：修复；
- Deprecated / Removed：弃用与移除；
- Breaking：破坏性变化与迁移说明；
- Boundary debt：新增或回收的重要边界债务。

影响消费者接口、行为、安装、配置、协议或报告格式的变更必须进入 changelog；纯测试重构、无行为格式化可省略。

### 版本流程

版本化、形成制品、上传远端和发布 registry 是四个独立动作：

1. 按 Conventional Commits 提交行为与 changelog；
2. `artifacts:pack` 从最近稳定 tag 后的提交自动判断 SemVer 级别；
3. 命令运行 `pnpm check`、构建与仓库外安装冒烟；
4. 从同一 commit 生成 tarball、manifest 与 SHA256SUMS；
5. 全部成功后自动创建 annotated `v<version>` tag；
6. 按需要停在本地，另行授权后再上传远端制品存储、push tag 或发布 registry。

当前自动规则只覆盖单一 lockstep 制品线，不引入 Changesets。将来出现并行 release line、prerelease channel 或独立包版本后，再评估专用发布工具。

## 制品验证

每次形成候选制品后，在仓库外的新临时项目中执行：

1. 从本地 tarball 安装核心包，并确认包管理器按 manifest 安装 `yaml`；
2. 检查 core 的 JS 与 sourcemap 不再包含 `yaml` 源码；
3. TypeScript 编译所有公开子路径的最小示例；
4. 运行 JSONL / sandbox / fixture / matrix 冒烟测试；
5. 安装 PTY tarball，并在支持的平台运行 PTY 冒烟测试；
6. 通过临时 HTTP 地址重复远程 tarball 安装；
7. publish 前通过临时 registry 重复按包名安装；
8. 检查 tarball 内容、版本、commit 与 SHA-256 一致。

只有 workspace 测试通过，不能替代制品安装验证。

## 阶段推进

| 阶段           | 交付                                                               | 是否阻塞当前功能主线   |
| -------------- | ------------------------------------------------------------------ | ---------------------- |
| 文档与版本基线 | 本文、`0.1.0` 起始策略、根 changelog                               | 已完成                 |
| 本地打包       | `dist/`、聚合包、PTY 拆分、`artifacts:pack`、本地 tarball 冒烟测试 | 已完成（含 YAML 外置） |
| git 源码交付   | 消费方克隆固定 commit，统一入口自构建，降级承诺成文                | 已完成（本文）         |
| 远程 GET       | 上传同一 tarball、manifest 与校验和，验证私有下载                  | 否，本地打包后按需做   |
| registry       | 发布同一包、版本治理、临时 registry 验收                           | 否，未来按需做         |

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
