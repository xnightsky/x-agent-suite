# 版本治理与发布准备

本规范管理 lockstep 版本、发布准备、固定版本重打和消费者升级；制品构建与安装方式见 [packaging.md](./packaging.md)。

## 起始版本与版本策略

- `0.0.0` 仅是仓库占位版本，不作为可安装制品版本。
- 首个版本化基线使用 `0.1.0`。
- 初期两个对外分发包采用 **lockstep versioning**：聚合包与 PTY 包使用同一版本；内部 workspace 仍是不可发布实现模块。
- 版本身份独立于公开发布；本地 tarball、远程制品同样必须有正式版本。
- 在多包兼容关系尚未形成真实独立演进需求前，不采用 independent versioning。

## `0.y.z` 期间的递增规则

本库遵循 SemVer 2.0.0，并对 major-zero 阶段收紧约定：

| 变更                             | 版本递增   | 示例                                |
| -------------------------------- | ---------- | ----------------------------------- |
| 破坏公共接口、改变协议或删除能力 | MINOR      | `0.1.0` → `0.2.0`                   |
| 向后兼容的新功能                 | MINOR      | `0.2.0` → `0.3.0`                   |
| 向后兼容的修复、性能或内部重构   | PATCH      | `0.2.0` → `0.2.1`                   |
| 仅 docs/style/test/chore         | 不单独发版 | 保留到下一次可发布变更              |
| 候选验证                         | prerelease | `0.3.0-alpha.0` → `beta.0` → `rc.0` |

`1.0.0` 表示公共接口进入稳定承诺期；至少应满足：主线验收闭环、两个独立消费者验证、安装制品稳定、破坏性接口已有迁移纪律。

## 单一版本真相源

- Git history 与当前提交上的稳定 tag 是版本真相源；根 package 和内部 workspace 的 `0.0.0` 只是不可发布占位值。
- Git tag 使用 `v<version>`，例如 `v0.1.0`；稳定 `artifacts:pack` 获当前操作者授权且成功后自动创建 annotated tag。
- 核心包、PTY 包、artifact 目录、tarball 文件名与 manifest 必须使用同一推导版本。
- `CHANGELOG.md` 归集消费者可见变化，不承担机器版本真相源。
- 一个版本一旦形成可消费制品，其内容不得覆盖或替换；任何修改都产生新版本。
- Git commit 写入 manifest，不塞入 SemVer build metadata，避免同版本出现多个内容。

## 固定版本与 HEAD 对齐

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

## 开发 HEAD 的 snapshot 版本

snapshot 只允许来自干净且已提交的 HEAD，格式为 `<自动推导稳定版本>-dev.<YYYYMMDD>.<short-sha>`。例如首次基线是 `0.1.0-dev.20260828.df7759b`；已有稳定版后，由后续 Git history 自动选择 `0.1.1-dev...` 或 `0.2.0-dev...`。日期便于排序，commit 负责唯一定位源码。

- snapshot 的版本改写应发生在隔离打包区，不要求把每个 snapshot version 提交回主分支；manifest 仍记录完整 commit。
- snapshot 不创建稳定 tag，不使用 registry 的 `latest`，也不得覆盖同名 tarball。
- 兄弟仓库必须钉住完整 tarball URL/路径和 SHA-256，不能依赖“最新 snapshot”浮动别名。
- dirty working tree 没有可复现的 commit 身份；需要共享时先形成提交，再生成 snapshot。
- snapshot 验证通过不等于正式发布；转稳定版时仍需独立的版本准备提交和完整制品验收。

## 变更记录

采用根级 `CHANGELOG.md` 记录 lockstep 版本变化，不为内部 workspace 模块分别维护重复 changelog。每个版本按需包含：

- Added：新增能力；
- Changed：接口或行为变化；
- Fixed：修复；
- Deprecated / Removed：弃用与移除；
- Breaking：破坏性变化与迁移说明；
- Boundary debt：新增或回收的重要边界债务。

影响消费者接口、行为、安装、配置、协议或报告格式的变更必须进入 changelog；纯测试重构、无行为格式化可省略。

## 发布准备与版本流程

版本化、形成制品、上传远端和发布 registry 是四个独立动作：

1. 按最近稳定 tag 对照消费者可见变化，确定目标版本并补齐 Added / Changed / Fixed / Deprecated / Breaking；
2. 将待发布内容从 `Unreleased` 归档到 `## <version> - <日期>`，保留空的 `Unreleased` 入口，补齐必要的迁移说明，再按 Conventional Commits 提交行为与 changelog；
3. `artifacts:pack` 从最近稳定 tag 后的提交自动判断 SemVer 级别；
4. 命令运行 `pnpm check`、构建与仓库外安装冒烟；
5. 从同一 commit 生成 tarball、manifest 与 SHA256SUMS；
6. 全部成功后自动创建 annotated `v<version>` tag；
7. 按需要停在本地，另行授权后再上传远端制品存储、push tag 或发布 registry。

发布准备章节允许先于 tag 入库，但它只声明待验收内容，不表示制品或 tag 已形成。稳定入口在构建前检查该章节非空；缺失即失败。只有全部验收成功后才创建 tag，禁止为满足章节与 tag 对齐而提前手工打 tag。开发中尚未进入发布准备的变化仍留在 `Unreleased`。

当前自动规则只覆盖单一 lockstep 制品线，不引入 Changesets。将来出现并行 release line、prerelease channel 或独立包版本后，再评估专用发布工具。

## 从 0.6.1 升级到 0.7.0

### 安装与版本身份

- 核心包 `x-agent-suite` 与可选 `@x-agent-suite/pty-driver` 同步升级到 `0.7.0`，来自同一次构建，并校验 `SHA256SUMS`。消费者更新依赖来源及 lockfile，不引用内部 workspace 包。
- 源码 package 的 `0.0.0` 保持不变；本次不引入 Changesets，也不单独提升内部包版本。
- 核心包新增 `x-agent-suite/recall`、`x-agent-suite/judge` 子路径和统一 `x-agent-suite` CLI，原 `eval/run/diff` 语义保留。新增能力不要求已有 Runner 消费者迁移到 Recall。

### live 配置与目标选择

- 旧 `carriers.*.provider/model` 仍可加载，但会产生 `deprecated-carrier-model` 告警；建议迁移到 `providers.*.models` 与 `default`。同一 carrier 不得混用新旧结构；旧格式没有承诺移除日期。
- `resolveLiveTargets` 至少需要 carrier/provider/model 之一；carrier-only 展开该范围的 defaults，不允许无参数执行所有默认目标。原 `resolveLiveChannel` 入口仍保留。
- 手工构造 `LiveConfigLoad` loaded 分支的 TypeScript 适配或测试替身，需补齐 `available`、`defaults`、`warnings`；调用 `loadLiveConfig` 可直接取得完整结构。
- `.env.auth.yaml` 可选，不要求拆出现有内联凭据。采用独立文件时，凭据来源为 runtime > auth-file > model-config；已选来源缺值或出错不继续回退，显式 `auth.provider` 必须能解析。代码显式 channel 仍可旁路文件发现。详见 [live-auth-config.md](./live-auth-config.md)。

### TargetTags、Recall 与 Judge

- 核心包携带公共 `config/target-tags/keys.yaml` 和 `instances.yaml`，默认从自身包根加载，不要求消费者复制源码仓或准备同名目录。显式 `dictionaryPath/instancesPath` 优先于 `repoRoot`，未覆盖时使用包内资源；显式资源失败不静默回退。
- 私有 `targetTags` 仍放在已选 live 配置内；公共目录出现某实例不代表其 live 已授权，unknown/disallowed 不自动放行。详见 [target-tags.md](./target-tags.md)。
- Recall 与 Judge 均为本次首次发布。Recall 不读 `x-agent-suite.config.ts`，按显式目标、独立 registry 和 effects-only Plan 执行；曾试用未发布中间态的调用方按 [recall.md](./recall.md) 调整，但这些中间态不列作相对 `0.6.1` 的删除接口。
- Recall、Plan 与 TargetTags 的 YAML 版本保持 `1`，live 配置继续兼容旧结构，不因制品升到 `0.7.0` 就机械修改 schema 版本。
- 默认验收只运行零 token 测试。真实 provider、借用登录态和 token 测试仍需单次显式授权；本次稳定打包不代表完成这些验证。
