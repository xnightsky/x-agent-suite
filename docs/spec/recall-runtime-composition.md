# Assertions 模型断言装配与 Recall 接线（实现定稿）

> 状态：已实现并验收（2026-10-30）。本文中的类型、字段和调用形状即当前公开 API；第 10 节列出已验证项、未验证项与剩余风险。
> 历史：设计定稿后按第 10 节顺序实施，每步先写失败测试再实现。

## 1. 结论与目标

本轮以完善 `@x-agent-suite/assertions` 为中心，并补齐官方 Recall CLI 的同源依赖接线：

1. 一次完整运行始终是"执行得到观测与证据 → assert 判定"；Judge 是 assert 的内部实现，其模型调用、超时与重试不改变这一分层。
2. `createJudgeAssertion` 保留现有 client 注入，同时增加互斥的原生 client 配置入口；需要时内部复用 `createJudgeClient`，不复制 Judge 运行时。
3. Recall registry 在静态 Criterion 之外接受通用判据工厂。官方加载链把同一来源的 target、config、TargetTags 和命令批准交给工厂，消费者不再重读环境来拼这些依赖。
4. 动态判据按已选 target 装配一次并复用，不按 target × case × repeat 重建。现有 `runScenarioSpec`、`runScenarioRepeat` 和 `runCriteria` 均保持原职责。
5. 领域证据、rubric、观察一次消费等消费者政策仍由消费者声明，不内置为通用框架政策。

验收必须同时覆盖单次执行与可选 repeat，并证明官方 CLI 路径已经接通；不能把新增接口的直接调用当成入口接线完成。

## 2. 已核对的现状

| 事实                                                                                                                  | 依据                                          | 设计结论                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `runScenarioSpec` 先执行主 Driver、形成 SessionObservation，再调用 `runCriteria`                                      | `packages/runner/src/run-scenario.ts`         | 单次调用已经符合"执行 → assert"                                                                                        |
| `runScenarioRepeat` 只顺序调用 `runScenarioSpec`，复用 criteria 并重新创建主 Driver                                   | `packages/runner/src/repeat.ts`               | repeat 只是可选稳定性复测，不需要新装配接缝                                                                            |
| `createJudgeAssertion({ client })` 已调用原生 `judge()` 并转换 verdict                                                | `packages/assertions/src/judge-assertion.ts`  | 不新增第二套 AI 断言、prompt 或结果转换                                                                                |
| assertions 已依赖 judge                                                                                               | `packages/assertions/package.json`            | 可以直接复用 `createJudgeClient`，无需新增依赖层                                                                       |
| `createJudgeClient` 已接收 target、config、tags、批准及 direct/borrowed 配置                                          | `packages/judge/src/types.ts`                 | 配置入口应透传原生能力，不另造渠道或审批系统                                                                           |
| `createJudgeClient` 是同步函数，构造期只做参数校验与 TargetTags 决策；backend/Driver 在每次 `complete()` 内创建并清理 | `packages/judge/src/client.ts`                | `createJudgeAssertion` 保持同步签名；`clientOptions` 在装配期同步解析即满足"构造阶段不启动 Driver、不联网、不调用模型" |
| Judge 每次 `complete()` 创建并清理独立 backend/Driver                                                                 | `packages/judge/src/client.ts`                | 复用 client 对象不等于复用模型会话                                                                                     |
| Recall registry 当前只有静态 Criterion，`runCase` 把同一数组交给所有 target                                           | `packages/recall/src/registry.ts`、`run.ts`   | 缺少的是官方执行域的通用判据装配入口                                                                                   |
| 加载链已持有 config，TargetTagCatalog 目前只在 `resolveExecutions` 局部作用域内加载                                   | `packages/recall/src/load.ts`                 | 内部运行加载结果需要保留 catalog，公开加载形状不必扩大                                                                 |
| `--approve-live` CLI 开关已存在，并经 `loadRecall` 归一化后进入 `resolveRecallExecution`                              | `packages/recall/src/cli.ts`、`load.ts`       | 第 6 节是同一 boolean 的透传接线，不是新增批准开关                                                                     |
| Recall DSL 只有 turn 级 `expect`，无 session 级 expect                                                                | `packages/recall/src/schema.ts`、`compile.ts` | 引用收集只扫 `turn.expect`；session scope 工厂声明合法但当前不会被引用装配                                             |
| 编译期 `assertRegisteredMetrics` 只按 `scope === "turn"` 过滤判据名验证引用                                           | `packages/recall/src/compile.ts`              | 编译器只需 name/scope 描述符，判据描述符化即可兼容工厂                                                                 |
| `runCriteria` 已按 scope + name 和字段存在分派已有 Observation                                                        | `packages/observation/src/criteria-runner.ts` | 不新增断言调度器，也不用 truthy 判断是否启用判据                                                                       |
| `JudgeAssertionOptions` 当前是含必填 `client` 的导出 interface                                                        | `packages/assertions/src/judge-assertion.ts`  | 改为判别联合 `type`；包为 0.0.0 private，类型层破坏可接受，但须在 README 记录                                          |

registry 本身是正常插件注册边界；本方案不把它改名为服务容器，也不要求 assertions 反向依赖 observation 或 recall。

## 3. 目标运行模型

```text
官方 Recall CLI
  → 加载 registry 声明、考卷、Plan、config、TargetTags 与 target
  → 校验判据声明和考卷引用
  → 按已选 target 为实际引用的动态判据装配依赖（每 target 一次，全部完成于任何主 Driver 创建之前）
  → 现有 runScenarioRepeat（repeat = 1 时就是单次）
      → 现有 runScenarioSpec
          → 主 Driver 执行并取得观测
          → 现有 runCriteria
              → 确定性 Criterion / createJudgeAssertion
                  → 原生 judge()
                  → client.complete()
                  → 当前 attempt 独立 backend/Driver 与清理
  → 现有结果与报告
```

关键不变量：

- assert 发生在主执行之后；Judge 较慢不是改 Repeat 的理由。
- 单次与 repeat 使用同一组装配好的判据能力，repeat 不是断言能力的必经入口。
- 判据装配只准备闭包和无资源 client，不启动 Driver、联网或调用模型；实际资源仍由原生执行路径创建并清理（`createJudgeClient` 构造期为纯决策，已核对）。
- 配置、批准和 client 不进入 Observation、模型考卷或报告。

## 4. 完善 assertions 包

### 4.1 互斥的 client 配置入口

保留现有合法调用不变，把选项表达为判别联合：

```ts
interface JudgeAssertionBaseOptions {
  readonly name: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export type JudgeAssertionOptions =
  | (JudgeAssertionBaseOptions & {
      readonly client: JudgeModelClient;
      readonly clientOptions?: never;
    })
  | (JudgeAssertionBaseOptions & {
      readonly client?: never;
      readonly clientOptions: CreateJudgeClientOptions;
    });
```

规则如下：

- `client` 与 `clientOptions` 必须恰有一个；TypeScript 类型排除歧义，运行时仍要拒绝两者同时存在或同时缺失（抛 `TypeError`，message 指明互斥规则，不回显配置内容）。
- `client` 分支保持现有行为，继续支持 fake client、自定义 client 和零 token 单元测试。
- `clientOptions` 分支在 `createJudgeAssertion` 调用时同步调用一次原生 `createJudgeClient(clientOptions)`，随后仍走现有 `judge()`；`createJudgeClient` 已核对为同步纯决策，函数签名保持同步。
- `name`、`timeoutMs`、`maxRetries` 的语义不变；TargetTags 候选、mode、toolPolicy 和批准校验全交原生工厂。
- 不为新 client 增加另一套 dispose 生命周期；当前 JudgeClient 的 attempt 资源清理由 `complete()` 负责。
- `name` 非空校验、现有 `[not-evaluated:<kind>]` / `[absent]` Error 前缀约定不变。

### 4.2 包职责的精确变化

assertions README 应从"不创建模型客户端"修订为：**默认不创建客户端；只有调用方显式选择 `clientOptions` 时，才通过原生 Judge 工厂创建 client。**

除此之外职责不扩大：

- 不读取环境或 Recall 配置，不自行选择 target，不保存永久批准。
- 不复制 Judge prompt、timeout、retry、verdict 解析、失败分类或资源清理。
- 不自动注册、调度、聚合或写报告。
- 不新增证据投影 DSL、通用 AssertionFactory、依赖容器或另一套调度器。
- `createJudgeAssertion` 仍评判 `turn.text`；需要组合领域证据时，继续由消费者 Criterion 投影后复用原生 Judge 能力。

## 5. 官方 Recall CLI 接线

### 5.1 静态判据与通用工厂混合注册

Recall 只增加通用插件装配，不认识 Judge 或任何领域判据。新增类型放在 `packages/recall/src/registry.ts`：

```ts
/** 判据描述：编译期只需 name/scope 验证考卷引用。 */
export interface RecallCriterionDescriptor {
  readonly name: Criterion["name"];
  readonly scope: Criterion["scope"];
}

/** 通用判据工厂：按 target 装配一次并复用。 */
export interface RecallCriterionFactory extends RecallCriterionDescriptor {
  readonly create: (
    context: RecallCriterionFactoryContext,
  ) => Criterion | Promise<Criterion>;
}

export type RecallCriterionRegistration = Criterion | RecallCriterionFactory;
```

- `RecallRegistry.criteria` 类型从 `readonly Criterion[]` 改为 `readonly RecallCriterionRegistration[]`；静态 Criterion 结构兼容，既有注册表无需修改。
- `validateCriteria` 扩展为：每项必须是 record；`name` 非空字符串、`scope ∈ {"turn","session"}`；`evaluate` 与 `create` 必须恰有一个是函数（缺实现、双实现均在加载时拒绝）；重复 `scope:name` 沿用现有键逻辑拒绝。
- 编译器只需要 name/scope 描述来验证考卷引用：`CompileRecallOptions.criteria` 类型放宽为 `readonly RecallCriterionDescriptor[]`（结构子类型，向后兼容），`assertRegisteredMetrics` 逻辑不变；`loadScenarios` 直接把 `registry.criteria` 传入。不为工厂伪造 `evaluate` 占位。
- 工厂返回的 name/scope 必须与声明一致，不能在装配时增加新判据或改变考卷选择（装配期校验，见 5.3）。
- 静态 Criterion 的注册与复用语义保持兼容。

### 5.2 同源装配上下文

```ts
export interface RecallCriterionFactoryContext {
  readonly target: ResolvedLiveTarget;
  readonly config: LiveConfigOptions;
  readonly tags: TargetTagCatalog;
  readonly liveReviewApproved: boolean;
  readonly cliRef?: string;
  readonly clientRef?: string;
  readonly effects: RecallEffects;
}
```

字段来源（全部取自同一次官方加载，工厂不得重读环境或再次选择模型）：

| 字段                 | 来源                                             |
| -------------------- | ------------------------------------------------ |
| `target`             | `RecallResolvedExecution.target`                 |
| `config`             | `LoadedRecall.config`                            |
| `tags`               | 内部 load core 保留的 `TargetTagCatalog`（见下） |
| `liveReviewApproved` | `loadRecall` 归一化后的 `approveLive ?? false`   |
| `cliRef`/`clientRef` | `RecallResolvedExecution.cliRef` / `.clientRef`  |
| `effects`            | `loaded.plan.effects`                            |

- `effects` 只供既有预算和独立宿主适配使用，不能推导出额外权限。
- catalog 保留方式：把 `resolveExecutions` 内的 catalog 加载上移，新增模块内不公开到包 index 的 `loadRecallCore(options): Promise<{ loaded: LoadedRecall; catalog: TargetTagCatalog; liveReviewApproved: boolean }>`；公开 `loadRecall` 变为返回 `core.loaded`，形状不变。不用 WeakMap、反射或二次读取补数据。
- 不向工厂传主 backend、主 Driver、sandbox、工作区或完整主执行状态，避免共享执行资源。
- 装配错误只报告安全的判据名与阶段，不回显 context、config 或插件异常中的秘密。

### 5.3 按 target 装配并复用

新增 `packages/recall/src/criterion-assembly.ts`：

```ts
/** 按已选 target 装配实际引用的动态判据；每 target 每工厂恰好调用一次。 */
export async function assembleRecallCriteria(options: {
  readonly registry: RecallRegistry;
  readonly scenarios: readonly ScenarioSpec[];
  readonly execution: RecallResolvedExecution;
  readonly config: LiveConfigOptions;
  readonly catalog: TargetTagCatalog;
  readonly liveReviewApproved: boolean;
  readonly effects: RecallEffects;
}): Promise<readonly Criterion[]>;
```

算法：

1. 引用收集：遍历 `scenarios` 全部 `turns[].expect` 的**键存在性**，得到 `turn:<name>` 集合；字段出现即算引用，`false`、`0`、`null` 或空字符串不能被当成未启用（`Object.keys` 语义，不做 truthy 过滤）。
2. 按 registry 声明顺序遍历：静态 Criterion 直接保留；工厂仅当 `scope:name` 在引用集合中才调用 `create(context)` 一次并 await；未引用工厂不创建 client，也不触发额外准入。
3. 返回形状校验：工厂返回值必须是含 `evaluate` 函数的 record，且 `name`/`scope` 与声明严格相等；不符抛错。
4. 错误包装：任何工厂异常或形状不符统一包装为只含 `scope:name` 与阶段（`create` / `形状校验`）的 Error，cause 链保留但不把 context/config 拼进 message。

`runRecall` 接线：

1. 改用 `loadRecallCore` 取得 `{ loaded, catalog, liveReviewApproved }`。
2. **在 target/case 双层循环之前**，对 `loaded.executions` 逐个调用 `assembleRecallCriteria`，得到每个 execution 的判据数组；任一装配失败直接抛错中止本次运行（装配属加载期，不记入 `RecallRunResult.failures`——该列表只承载单 case 基础设施失败）。这样所有装配错误都暴露于任何主 Driver 创建之前。
3. `runCase` 改为接收该 execution 装配好的判据数组并传给 `runScenarioRepeat`，不再直接读 `loaded.registry.criteria`。
4. case 与 repeat 继续复用该数组，不新增 `createRun`，也不按组合重新调用工厂。Judge 的独立 attempt 隔离仍由 `complete()` 保证。

这里的预检只覆盖注册、引用和装配。**领域 expect/rubric 的原生校验时机不提前**：当前 `createJudgeAssertion` 在 evaluate 阶段把 expect 交给 `judge()` 校验，因此不能把"非法 rubric 不调用 Judge 模型"夸大成"主模型执行前必然发现"。

### 5.4 拟议注册方式

以下只说明接缝形状，是本轮实现后要支持的消费者写法：

```ts
const registry = {
  criteria: [
    textContains,
    {
      name: "answer-quality",
      scope: "turn",
      create({ target, config, tags, liveReviewApproved, cliRef, effects }) {
        return createJudgeAssertion({
          name: "answer-quality",
          clientOptions: {
            target,
            config,
            tags,
            liveReviewApproved,
            ...(cliRef ? { cliRef } : {}),
            mode: "borrowed",
            toolPolicy: "none",
            createDriver: (attempt) =>
              existingIndependentHostAdapter({
                ...attempt,
                timeoutMs: effects.timeoutMs,
              }),
          },
          maxRetries: 0,
        });
      },
    },
  ],
  profiles: consumerProfiles,
  effectsProfiles: {},
};
```

`existingIndependentHostAdapter` 代表消费者已有的独立 Judge Driver 适配，不共享主 Driver，也不继承主 provision、上下文或工具权限。Recall 不需要 import assertions；依赖方向仍是消费者组合两个公开包。

## 6. 命令批准语义

用户已选择放开一次命令内部的批准范围，不人为拆成主运行与判据两套批准：

1. `--approve-live` / `approveLive` 表示本次命令的 live 批准，覆盖主运行与注册判据调用。CLI 开关与 `LoadRecallOptions.approveLive` 已存在（见第 2 节），本轮新增的接线是：`loadRecallCore` 把归一化后的 boolean 带回，`runRecall` 经装配上下文交给工厂。
2. 同一个 boolean 分别显式进入现有主 execution 决策和 `createJudgeClient` 等原生入口，不经过 `executionParams`。
3. 不增加 Judge 专用批准开关，也不从环境、考卷、工具数组或计费标签推导批准。
4. 未批准时沿用原生 TargetTags 决策；review-required、unknown、disallowed 等规则不被绕过。
5. 独立使用 Judge 或 assertions 的调用方仍须自行显式传值，client 不保存永久授权。
6. 本方案不授权任何真实调用；批准语义只影响 fake/合成环境下的决策路径验证。

## 7. 消费者迁移边界

| 内容                                         | 迁移原则                                           |
| -------------------------------------------- | -------------------------------------------------- |
| 重读环境以加载 target/config/tags            | 删除等价路径，改用官方装配上下文                   |
| 从 executionParams 剥离并传递 Judge 批准     | 删除该传递路径，使用同一命令批准                   |
| 自写普通 verdict 转换与 Judge 生命周期       | 继续复用原生 assertions/judge，不恢复副本          |
| 只为晚到 target 关联判据的观察路由           | 可由按 target 装配替代                             |
| 仅原生观察、消费一次且首次失败也消耗         | 属消费者安全政策，继续单独实现与测试，不随路由删除 |
| 领域证据选择、rubric、路径、章节与 canary    | 留在消费者，不进入通用包                           |
| `maxRetries = 0`、独立隔离、无工具及既有预算 | 通过原生选项与既有适配器显式保留                   |
| 主/Judge usage 分离                          | 保持原生归因，不合并或估算另一套账本               |

迁移不要求消费者复制 target/case/repeat 循环，不要求修改 registry import 对象，也不允许把配置句柄藏入 Observation 或报告。

## 8. 不推荐方案

| 方案                                             | 不推荐原因                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| 给 Repeat 增加 `createRun` 或每轮重建判据/client | Judge 属于 assert；现有 repeat 已复用 criteria，且 Judge attempt 已独立隔离 |
| 按 target × case × repeat 全量预装配             | 放大对象数量与生命周期，没有对应隔离需求                                    |
| 只给 assertions 增加 clientOptions               | 官方 Recall 静态 registry 仍无法接收同源执行依赖，入口缺口仍在              |
| 只给 Recall 增加工厂而不完善 assertions          | 消费者仍需在每个工厂手工拼普通 Judge client，未收敛常用断言装配             |
| 新增通用断言调度器或容器                         | `runCriteria` 已负责调度，容器会引入无需求的生命周期                        |
| 向 CriterionContext/Observation 注入配置或批准   | 扩大核心契约与敏感数据传播范围                                              |

## 9. 验收计划与测试落点

实现遵循本仓测试分层：以下全部为 `*.test.ts` 单元测试（fake client / fake transport / 合成注册表，零 token），由 `pnpm test` 覆盖；收口跑 `pnpm check`。

| #   | 验收项                                                                                                                                   | 测试落点                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | 现有 client 注入与 fake-client 回归保持通过；client/clientOptions 双填、缺失及非法 name 均显式拒绝                                       | `packages/assertions/tests/judge-assertion.test.ts` 扩展                       |
| 2   | clientOptions 经原生工厂到达 target/config/tags/批准（可用 direct + fake transport 断言入参）；构造阶段不启动 Driver、不联网、不调用模型 | 同上                                                                           |
| 3   | 官方 CLI 以 `repeat = 1` 走通完整"执行 → assert"路径（合成 registry + fake profile driver），而非只直接调用新 API                        | `packages/recall/tests/recall.test.ts` 扩展                                    |
| 4   | 多 case 与 `repeat > 1` 下工厂每 target 只调用一次；主 Driver 仍按单次执行创建                                                           | 同上（工厂调用计数断言）                                                       |
| 5   | 静态 registry 保持兼容；缺实现、双实现、重复声明在加载时拒绝；name/scope 不符与装配失败在任何主 Driver 创建前抛错                        | `packages/recall/tests/` 新增 `criterion-assembly.test.ts` + registry 校验用例 |
| 6   | 未引用工厂调用次数为零；expect 字段存在判断不按 truthy 过滤（`false`/`0`/`null` 仍算引用）                                               | `criterion-assembly.test.ts`                                                   |
| 7   | 主路径与模型判据分别收到同一显式批准；未批准及 TargetTags 拒绝语义不变，executionParams 不能改变批准                                     | `recall.test.ts` / `execution-resolution.test.ts` 扩展                         |
| 8   | 原生 verdict、absent、infra、transport、timeout、retry 与 cleanup 语义不变，模型输入和报告不泄露配置或批准                               | judge 包现有回归不动；assertions 用例复核                                      |
| 9   | 默认零 token 回归通过；`pnpm check`（boundary + typecheck + test + ittest）全绿                                                          | 仓库根命令                                                                     |
| 10  | 消费者后续迁移时重跑其完整回归，逐项报告删除的等价装配、保留的本地政策与剩余计量限制                                                     | 消费者仓，不在本轮                                                             |

领域 expect/rubric 的非法值仍在 evaluate 阶段由 `judge()` 校验（见 5.3 末段），验收措辞不得夸大预检时机。

## 10. 实施拆分与当前状态

实施顺序（每步先写失败测试再实现，符合本仓 TDD 约定）：

1. **assertions**：`JudgeAssertionOptions` 判别联合 + 运行时互斥校验 + clientOptions 分支；扩展 `judge-assertion.test.ts`；修订 assertions README 职责措辞。
2. **recall registry**：`RecallCriterionDescriptor` / `RecallCriterionFactory` / `RecallCriterionRegistration` 类型与 `validateCriteria` 扩展；registry 校验用例。
3. **recall compile**：`CompileRecallOptions.criteria` 放宽为描述符；编译用例确认工厂声明可通过引用校验。
4. **recall load/run**：`loadRecallCore` 保留 catalog 与归一化批准；新增 `criterion-assembly.ts`；`runRecall`/`runCase` 接线；装配与 CLI 路径用例。
5. **文档与收口**：同步 `docs/spec/recall.md`（或对应教程）中 registry 形状说明、本节状态；跑 `pnpm check`。

边界纪律：`packages/*/src/` 内不得出现任何具体被测系统名、命令、环境变量或判据名（`pnpm boundary` 强制）；新类型与错误消息保持领域中立。

当前状态：实现已完成（2026-10-30），全部按 TDD 推进，`pnpm check` 全绿（boundary 198 文件通过、typecheck 通过、单元测试 622 通过、ittest 按显式前置条件 skip）。

**已验证项（证据 = 对应测试文件，`pnpm test`）**：

| 验收项                                                                      | 状态 | 证据                                                                                                                                                                        |
| --------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 client 注入回归 + 互斥/非法 name 显式拒绝                                 | ✅   | `judge-assertion.test.ts`（既有 8 用例回归 + 双填/缺失 TypeError 不回显配置）                                                                                               |
| 2 clientOptions 经原生工厂到达 target/config/tags/批准；构造零副作用        | ✅   | `judge-assertion.test.ts`（direct + fake transport 全链路；review-required 未批准构造期拒绝、批准后放行；缺 tags 构造期拒绝；构造期 transport 调用数为 0）                  |
| 3 官方 CLI repeat=1 走通「执行 → assert」                                   | ✅   | `recall-assembly.test.ts`（borrowed 路径 `--repeat 2` + direct 路径装配判据真实评分，PASS/FAIL 均留痕报告）                                                                 |
| 4 工厂每 target 一次；主 Driver 按 case×repeat 创建                         | ✅   | `recall-assembly.test.ts` 工厂调用计数 + transports/profiles 计数；`criterion-assembly.test.ts` 多 case 只装配一次                                                          |
| 5 静态兼容；缺实现/双实现/重复/name/scope 加载期拒绝；装配失败早于主 Driver | ✅   | `registry.test.ts`（7 用例）、`criterion-assembly.test.ts`（形状校验/异常包装/错误不回显）、`recall-assembly.test.ts`（CLI 退出码 2 且 transports/profiles 为 0）           |
| 6 未引用工厂零调用；falsy expect 仍算引用                                   | ✅   | `criterion-assembly.test.ts`（false/0/null/空串四例）、`recall-assembly.test.ts`（静态考卷工厂零调用）                                                                      |
| 7 同一批准进入主执行与装配上下文；executionParams 不改变批准                | ✅   | `recall-assembly.test.ts`（review-required 无批准拒绝、--approve-live 后工厂上下文收到 true）+ `execution-resolution.test.ts`（executionParams 携带批准语义字段不改变决策） |
| 8 原生 verdict/absent/infra 语义不变，无配置泄露                            | ✅   | judge 包测试未改动且全过；assertions 既有 8 用例回归通过；装配错误消息不含 context/config                                                                                   |
| 9 零 token 回归 + `pnpm check` 全绿                                         | ✅   | 根命令实跑：boundary ✓ / typecheck ✓ / test 623 ✓ / ittest（skip 闸门）✓                                                                                                    |

**未验证项 / 剩余风险**：

- 验收 10（消费者迁移与其全量回归）不在本轮，按第 7 节迁移边界执行。
- 领域 expect/rubric 非法值仍在 evaluate 阶段由 `judge()` 校验，预检时机未夸大（第 5.3 节末段不变）。
- 修复了一处与本轮无关的存量测试隔离缺陷：`scripts/tests/target-tags-artifact.test.ts` 的空词典用例受本机 `~/.env.target-tags.instances.yaml` 全局实例污染（在未改动代码上同样失败），已把该用例 homeDir 隔离到 stage 临时目录；其余用例不动。
- 评审后修复（2026-10-30）：装配用例拆分为 `recall-assembly.test.ts`（`recall.test.ts` 505 → 315 行，两文件均在 500 行内）；`docs/spec/testing.md` 补 registry/装配/执行解析测试文件枚举；`load.ts` live 加载上移为单次（`resolveLiveCatalog`），`loadRecallCore` 压至 47 行，并以 borrowed 用例断言工厂上下文 catalog 与执行决策同源（live 私有 overlay 的 cli 实例可见）。
- 类型层破坏面：`JudgeAssertionOptions` 由 interface 改为判别联合、`RecallRegistry.criteria` 元素类型放宽，已在 assertions README 记录；下游 `examples/tutorial/17-recall.test.ts` 与 `scripts/tests/skill-loaded.test.ts` 已适配。
- 未执行构建、发布或真实调用，未修改消费者仓。
