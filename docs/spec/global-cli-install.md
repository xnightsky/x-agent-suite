# 全局 CLI 安装

`install:global` 从显式指定、可信来源交付的制品目录安装核心 CLI，使任意目录都能通过 PATH 调用 `x-agent-suite`。它不打包、不发布 registry、不创建 tag，也不初始化模型配置、凭据、registry 或宿主 CLI。

## 前置条件

- Node.js >=24，pnpm >=10；源码工具环境已安装开发依赖（脚本由 tsx 执行）。
- 已通过统一 `artifacts:pack -- --snapshot` 或正式交付获得制品，不直接安装含 `workspace:*` 的源码根包。
- pnpm 全局 bin 已配置并加入 PATH；可用 `pnpm bin --global`、`pnpm root --global` 核对。脚本不会自动运行 setup 或修改 shell 配置；权限、PATH 或目录未配置时显式失败。
- 依赖缓存已预热，或包源可达。脚本不强制联网，也不自动切换包源；严格离线时使用 pnpm 的 offline 配置。全局安装仍需解析 yaml/tsx 等运行时依赖。

## 调用

在包含该脚本的源码仓执行，目录参数应指向已交付的制品集：

```bash
pnpm run install:global -- "/path/to/artifacts/<version>"
```

POSIX 环境也支持以下 package script 调用；底层仍使用 pnpm，不切换到 npm 安装器：

```bash
npm run install:global -- "/path/to/artifacts/<version>"
```

Windows 使用 `pnpm run install:global`，以 Node 直接执行 pnpm 的 JS 入口，避免经 `.cmd`/shell 解释制品路径。Linux 的两种调用已通过隔离全局目录安装验证；macOS/Windows 的实际安装尚未验收。

仅接受一个目录参数，不支持隐式选择 latest、不自动打包，也不直接接受 registry 名称或单个 tarball。带空格的路径必须正确引用。

## 校验与副作用

目录至少包含：

```text
manifest.json
SHA256SUMS
x-agent-suite-<version>.tgz
```

安装前依次校验：

1. SHA256SUMS 格式、重复项与 basename；manifest.json 自身的 SHA-256。
2. manifest 为 schema v2，包含完整 Git commit、合法版本及 stable/snapshot 模式，dirty 为 false，且没有 validationOnly 字段。
3. 恰有一个 core，文件名与版本一致；清单和 SHA256SUMS 中的核心 hash 相同，且与 tarball 字节一致。
4. 相关文件不能通过符号链接逃出制品目录。

全部通过后，只执行核心包的 `pnpm add --global --ignore-scripts`。不安装 PTY 包，也不要求可选 PTY tarball 存在；若需要原生 PTY，仍由消费者显式安装并单独验收。校验和只证明交付自洽，不证明来源可信，不能拿不可信来源的 manifest 和 hash 为其自身背书。

校验/参数/文件/包管理器失败均以非零状态退出，不换来源或回退到其他版本；成功后才输出已安装版本。不会改写源码 package.json/lockfile、用户 `.env.*`、PATH 或宿主登录态。实际全局安装会更新 pnpm 管理的该包，请由执行者确认权限与版本。

## 安装后使用

```bash
pnpm list --global --depth 0
x-agent-suite recall
```

第二条是安全拒绝探针：应退出 2 并提示显式选择 target，不启动 Driver 或请求模型。当前 CLI 不提供 `--version`；版本从安装列表或交付清单核对。

进入目标 repo 后，可使用全局命令执行其考卷；完整接线见 [Recall](../tutorial/recipes/recall.md)。从任意目录调用时仍遵循相同规则：

- 无显式考卷路径时，仅发现当前 cwd 的 `.recall/` 第一层 YAML，不向上或递归搜索 repo。
- `--registry`、`--plan`、考卷和输出的相对路径以调用 cwd 为基准；`--root-dir` 只设置场景资源根，不切换 cwd。
- 跨仓可复用 home 配置；需要固定来源时显式设置 `--live-config`，如使用认证文件则另设 `E2E_AUTH_CONFIG_PATH`。全局安装不改变 repo/home 配置优先级。
- registry 不自动发现；真实 CLI 的 profile 和领域 Criterion 仍由消费者提供。registry 的运行时依赖按其所在位置解析，PATH 上有全局 CLI 不等于 Node 可以从任意 repo import 全局包。

全局可调用不等于真实宿主、PTY、provider 或 skill-trigger 已可用；这些仍须按目标与权限逐层验收。

## 验证边界

默认单测用 fake 安装函数验证参数、正式清单、hash、路径逃逸及安装失败传播，不修改真实全局环境。真实安装探针应使用隔离 HOME/PNPM_HOME/全局目录，并在安装前确认 `pnpm root --global` 和 bin 均落在临时目录内；从无 package.json 的其他 cwd 验证 PATH shim、公共 TargetTags 和 live.disallowed 拒绝，额外禁止 fetch，不启动真实宿主或 provider。

2026-10-28 在 Linux、Node 24.14.0、pnpm 10.33.0 下，用干净提交 `480de68` 产生的正式 snapshot `0.7.0-dev.20261028.480de68` 验证两种 package script 调用、含空格的制品/全局路径、core-only 安装、任意 cwd 的 PATH shim、默认公共标签和 live 拒绝门禁，全部通过。源码 package.json/lockfile 及真实全局环境未改动。安装器 8 个单测通过；本轮 `pnpm check` 为 468 pass、1 skip，另 2 个真实宿主集成用例 skip，不视为宿主/PTY/live 通过。
