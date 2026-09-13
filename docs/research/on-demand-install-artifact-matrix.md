# 按需安装是否需要 pip extras 式制品矩阵

> 调研日期：2026-09-13
>
> 范围：npm 生态下「默认全量安装 + 按需子集安装」的实现形态；是否现在就扩展制品矩阵。
>
> 证据约束：只采用 npm/pnpm 安装语法事实、本仓 `scripts/artifacts-*.ts` 与 `packaging/` 一手代码、`docs/spec/packaging.md` 现行分发规范。

## 结论

**现在不做。** 当前「聚合核心包 + PTY 切片包」两制品形态已覆盖唯一真实存在的按需场景，扩展制品矩阵违反 YAGNI。后续只在三个触发条件之一出现时动手（见[触发条件](#触发条件)），动手时遵守[切片纪律](#切片纪律)。

同时明确两点：

1. **npm 没有 extras 语法。** `npm install x-agent-suite[core]` 是 pip 独有写法，npm/pnpm/yarn 均不支持，tarball URL 分发更不可能支持。npm 的等价物是「多制品 + 聚合包」。
2. **默认全量行为永远不变。** 聚合包 `x-agent-suite` 的构建链路（`bundleCore` / `createCorePackageManifest` / `assertCorePackageIntegrity`）保持原样，任何按需能力都以新增切片 tgz 的方式落地，不改默认安装路径。

## 背景与问题

诉求形态：默认 `npm i <x-agent-suite.tgz>` 装全量（不改变现有行为），同时允许消费者按需只装子集，类似 pip 的 `x-agent-suite[core]`、`x-agent-suite[pty]`。

npm 侧不存在该语法，问题转化为：用 npm 能表达的方式，如何同时满足「默认全量」与「按需子集」。

## 候选路线

| 路线                  | 做法                                                               | 安装期错误暴露   | 改动量           | 需要 registry |
| --------------------- | ------------------------------------------------------------------ | ---------------- | ---------------- | ------------- |
| A. 多制品矩阵（选定） | 聚合包为默认全量；可选能力各自出独立自包含 tgz，同 release 同版本  | 是               | 小（骨架已就位） | 否            |
| B. 单包 + 可选 peer   | 单 tgz，重型依赖标 `peerDependenciesMeta.optional`，消费者自行补装 | 否（运行时才炸） | 中               | 否            |
| C. 上 registry        | 发布 `@x-agent-suite/core` + 能力包到 npm/GitHub Packages          | 是               | 大（新发布流程） | 是            |

路线 B 把「缺零件」从安装时推迟到运行时，且把原生依赖编译失败转移到消费者环境，破坏「核心零原生依赖」纪律，排除。路线 C 与 A 的制品切分相同，区别只在分发位置，属于未来分发策略问题，不阻塞本结论。

路线 A 的 pip 对照：

```text
pip install x            ≈ npm i x-agent-suite.tgz
pip install x[pty]       ≈ npm i x-agent-suite.tgz x-agent-suite-pty-driver.tgz
```

## 现状盘点

骨架已就位，本结论是「不扩展」而非「从零建设」：

- 聚合包 `x-agent-suite`：7 个子路径导出，esbuild 自包含 bundle，只外置 `tsx`/`yaml` 纯 JS 依赖，零原生依赖。
- 切片包 `@x-agent-suite/pty-driver`：承载 `node-pty` 原生依赖，独立分发——这已是路线 A 的一次实践。
- 构建管线（`scripts/artifacts-build.ts`）：bundle → 完整性校验 → pack → 仓库外安装冒烟，全链路通用。
- 形态锁定：`scripts/tests/artifacts-package.test.ts` 断言聚合包清单；`smokeInstall` 验收安装行为。

## 为什么不现在扩展

1. **按需的唯一真实动机已被解决。** 拆分 PTY 的动机是 `node-pty` 原生编译失败与平台风险；核心聚合包零原生依赖、外置依赖仅两个纯 JS 包，装全量对消费者无痛感。
2. **不存在第三个天然切片。** `@xterm/headless` 仅被 `packages/driver/src/pty*.ts` 使用，headless 能力已在 PTY 切片内；contracts → driver → sandbox → harness 为层层依赖，单独切分无意义。
3. **契约处于快速演化期。** v0.2.0 → v0.4.0 六天内四个版本；每多一个制品，breaking change 的版本同步、完整性校验与混装风险面同步放大。
4. **每切片是持续维护税。** entry、manifest 工厂、完整性校验、冒烟、文档、每个 release 多一份资产，且纪律需长期守住；无真实消费者时不付这笔成本。

## 触发条件

满足任一即按[落地预案](#落地预案)动手：

1. 出现新的携带原生或重型依赖的能力（同 PTY 模式）。
2. 真实消费者明确要求「只装 X、不装 Y」。
3. 决定发布 npm registry，顺势把聚合拆为多包分发。

## 切片纪律

动手扩展制品矩阵时的四条红线：

1. **自包含**：切片所需代码全部打进自身 tgz，不依赖任何兄弟 tgz（tarball URL 安装无法解析跨 tgz 依赖）。
2. **机制切分**：只按通用机制切（pty、headless、sandbox 等），不按具体宿主切——不出以具体 Agent/CLI 命名的制品，宿主 profile 由消费者注册（领域中立硬约束）。
3. **结构交互**：跨制品边界只传结构化数据与契约品牌字段，禁止 `instanceof`（前科：bundle 内联曾致 `instanceof` 恒 false，现以 `LlmBackend.liveChannel` 品牌字段解决，`assertPtyPackageIntegrity` 强制）。
4. **二选一**：同一项目内聚合包与切片不混装，由安装文档明确告知；不加运行时检测（为低概率误用增加所有制品复杂度，不值）。

## 落地预案

触发条件出现时，增量改动（模板均照 PTY 制品复制）：

```text
packaging/entries/<能力>.ts              # 新切片入口
scripts/artifacts-package.ts             # createSlicePackageManifest()（pty 工厂泛化）
scripts/artifacts-build.ts               # bundleSlice() + assertSliceIntegrity()（泛化现有 pty 版）
docs/INSTALLATION.md                     # 按需安装矩阵表：聚合包与切片二选一
```

首个切片预期 1~2 天；之后每个切片为复制粘贴级工作量。
