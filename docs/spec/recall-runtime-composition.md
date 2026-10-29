# Assertions 模型断言装配与 Recall 接线（方案草案）

> 状态：待审，尚未实现。本文中的新增类型、字段和调用形状均为提案，不是当前公开 API。
> 本轮仅修订设计，不授权修改运行时、构建、发布、真实调用或修改消费者仓。

## 1. 结论与目标

本轮以完善 `@x-agent-suite/assertions` 为中心，并补齐官方 Recall CLI 的同源依赖接线：

1. 一次完整运行始终是“执行得到观测与证据 → assert 判定”；Judge 是 assert 的内部实现，其模型调用、超时与重试不改变这一分层。
2. `createJudgeAssertion` 保留现有 client 注入，同时增加互斥的原生 client 配置入口；需要时内部复用 `createJudgeClient`，不复制 Judge 运行时。
3. Recall registry 在静态 Criterion 之外接受通用判据工厂。官方加载链把同一来源的 target、config、TargetTags 和命令批准交给工厂，消费者不再重读环境来拼这些依赖。
4. 动态判据按已选 target 装配一次并复用，不按 target × case × repeat 重建。现有 `runScenarioSpec`、`runScenarioRepeat` 和 `runCriteria` 均保持原职责。
5. 领域证据、rubric、观察一次消费等消费者政策仍由消费者声明，不内置为通用框架政策。

验收必须同时覆盖单次执行与可选 repeat，并证明官方 CLI 路径已经接通；不能把新增接口的直接调用当成入口接线完成。

## 2. 已核对的现状

| 事实                                                                                | 依据                                          | 设计结论                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `runScenarioSpec` 先执行主 Driver、形成 SessionObservation，再调用 `runCriteria`    | `packages/runner/src/run-scenario.ts`         | 单次调用已经符合“执行 → assert”                        |
| `runScenarioRepeat` 只顺序调用 `runScenarioSpec`，复用 criteria 并重新创建主 Driver | `packages/runner/src/repeat.ts`               | repeat 只是可选稳定性复测，不需要新装配接缝            |
| `createJudgeAssertion({ client })` 已调用原生 `judge()` 并转换 verdict              | `packages/assertions/src/judge-assertion.ts`  | 不新增第二套 AI 断言、prompt 或结果转换                |
| assertions 已依赖 judge                                                             | `packages/assertions/package.json`            | 可以直接复用 `createJudgeClient`，无需新增依赖层       |
| `createJudgeClient` 已接收 target、config、tags、批准及 direct/borrowed 配置        | `packages/judge/src/types.ts`                 | 配置入口应透传原生能力，不另造渠道或审批系统           |
| Judge 每次 `complete()` 创建并清理独立 backend/Driver                               | `packages/judge/src/client.ts`                | 复用 client 对象不等于复用模型会话                     |
| Recall registry 当前只有静态 Criterion，`runCase` 把同一数组交给所有 target         | `packages/recall/src/registry.ts`、`run.ts`   | 缺少的是官方执行域的通用判据装配入口                   |
| 加载链已持有 config，TargetTagCatalog 目前只在解析 execution 的局部作用域内使用     | `packages/recall/src/load.ts`                 | 内部运行加载结果需要保留 catalog，公开加载形状不必扩大 |
| `runCriteria` 已按 scope + name 和字段存在分派已有 Observation                      | `packages/observation/src/criteria-runner.ts` | 不新增断言调度器，也不用 truthy 判断是否启用判据       |

registry 本身是正常插件注册边界；本方案不把它改名为服务容器，也不要求 assertions 反向依赖 observation 或 recall。

## 3. 目标运行模型

```text
官方 Recall CLI
  → 加载 registry 声明、考卷、Plan、config、TargetTags 与 target
  → 校验判据声明和考卷引用
  → 按已选 target 为实际引用的动态判据装配依赖（每 target 一次）
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
- 判据装配只准备闭包和无资源 client，不启动 Driver、联网或调用模型；实际资源仍由原生执行路径创建并清理。
- 配置、批准和 client 不进入 Observation、模型考卷或报告。

## 4. 完善 assertions 包

### 4.1 互斥的 client 配置入口

保留现有合法调用不变，建议把选项表达为判别联合：

```ts
interface JudgeAssertionBaseOptions {
  readonly name: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

type JudgeAssertionOptions =
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

- `client` 与 `clientOptions` 必须恰有一个；TypeScript 类型排除歧义，运行时仍要拒绝两者同时存在或同时缺失。
- `client` 分支保持现有行为，继续支持 fake client、自定义 client 和零 token 单元测试。
- `clientOptions` 分支只调用一次原生 `createJudgeClient(clientOptions)`，随后仍走现有 `judge()`。
- `name`、`timeoutMs`、`maxRetries` 的语义不变；TargetTags 候选、mode、toolPolicy 和批准校验全交原生工厂。
- 不为新 client 增加另一套 dispose 生命周期；当前 JudgeClient 的 attempt 资源清理由 `complete()` 负责。

### 4.2 包职责的精确变化

assertions README 应从“不创建模型客户端”修订为：**默认不创建客户端；只有调用方显式选择 `clientOptions` 时，才通过原生 Judge 工厂创建 client。**

除此之外职责不扩大：

- 不读取环境或 Recall 配置，不自行选择 target，不保存永久批准。
- 不复制 Judge prompt、timeout、retry、verdict 解析、失败分类或资源清理。
- 不自动注册、调度、聚合或写报告。
- 不新增证据投影 DSL、通用 AssertionFactory、依赖容器或另一套调度器。
- `createJudgeAssertion` 仍评判 `turn.text`；需要组合领域证据时，继续由消费者 Criterion 投影后复用原生 Judge 能力。

## 5. 官方 Recall CLI 接线

### 5.1 静态判据与通用工厂混合注册

Recall 只增加通用插件装配，不认识 Judge 或任何领域判据：

```ts
interface RecallCriterionFactory {
  readonly name: Criterion["name"];
  readonly scope: Criterion["scope"];
  readonly create: (
    context: RecallCriterionFactoryContext,
  ) => Criterion | Promise<Criterion>;
}

type RecallCriterionRegistration = Criterion | RecallCriterionFactory;
```

- 每个注册项必须恰有 `evaluate` 或 `create` 中的一种实现；缺实现、双实现和重复 scope + name 在加载时拒绝。
- 编译器只需要 name/scope 描述来验证考卷引用，应把输入收窄为描述信息，不能为工厂伪造 `evaluate` 占位。
- 工厂返回的 name/scope 必须与声明一致，不能在装配时增加新判据或改变考卷选择。
- 静态 Criterion 的注册与复用语义保持兼容。

### 5.2 同源装配上下文

```ts
interface RecallCriterionFactoryContext {
  readonly target: ResolvedLiveTarget;
  readonly config: LiveConfigOptions;
  readonly tags: TargetTagCatalog;
  readonly liveReviewApproved: boolean;
  readonly cliRef?: string;
  readonly clientRef?: string;
  readonly effects: RecallEffects;
}
```

- target、config、tags 来自同一次官方加载与解析，不由工厂重读环境或再次选择模型。
- `cliRef` / `clientRef` 来自当前已确定的 execution；`effects` 只供既有预算和独立宿主适配使用，不能推导出额外权限。
- `runRecall` 使用的内部加载结果同时保留现有 loaded 对象与 catalog；公开 `loadRecall` 不必为此增加字段，也不能用 WeakMap、反射或二次读取补数据。
- 不向工厂传主 backend、主 Driver、sandbox、工作区或完整主执行状态，避免共享执行资源。
- 装配错误只报告安全的判据名与阶段，不回显 context、config 或插件异常中的秘密。

### 5.3 按 target 装配并复用

1. 根据已编译考卷的 expect 字段，按 scope + name 找出实际引用的工厂；字段出现即算引用，`false`、`0`、`null` 或空字符串不能被当成未启用。
2. 每个已选 target 对实际引用的工厂调用一次；未引用工厂不创建 client，也不触发额外准入。
3. 在任何主 Driver 创建前完成这些工厂的调用与返回形状校验，使装配错误尽早暴露。
4. 每个 target 得到一份静态判据与其动态判据组成的数组；现有 `runCase` 把该数组交给 `runScenarioRepeat`。
5. case 与 repeat 继续复用该数组，不新增 `createRun`，也不按组合重新调用工厂。Judge 的独立 attempt 隔离仍由 `complete()` 保证。

这里的预检只覆盖注册、引用和装配。**领域 expect/rubric 的原生校验时机不提前**：当前 `createJudgeAssertion` 在 evaluate 阶段把 expect 交给 `judge()` 校验，因此不能把“非法 rubric 不调用 Judge 模型”夸大成“主模型执行前必然发现”。

### 5.4 拟议注册方式

以下只说明接缝形状，不是当前可用 API：

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

1. `--approve-live` / `approveLive` 表示本次命令的 live 批准，覆盖主运行与注册判据调用。
2. 同一个 boolean 分别显式进入现有主 execution 决策和 `createJudgeClient` 等原生入口，不经过 `executionParams`。
3. 不增加 Judge 专用批准开关，也不从环境、考卷、工具数组或计费标签推导批准。
4. 未批准时沿用原生 TargetTags 决策；review-required、unknown、disallowed 等规则不被绕过。
5. 独立使用 Judge 或 assertions 的调用方仍须自行显式传值，client 不保存永久授权。
6. 这是待实现的新命令语义，不能声称旧 CLI 已支持；本方案不授权任何真实调用。

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

## 9. 后续验收计划（尚未执行）

1. 现有 client 注入与 fake-client 回归保持通过；client/clientOptions 双填、缺失及非法 name 均显式拒绝。
2. clientOptions 经原生工厂到达 target/config/tags/批准，构造阶段不启动 Driver、不联网、不调用模型。
3. 官方 CLI 以 `repeat = 1` 验证完整“执行 → assert”路径，而非只直接调用新 API。
4. 多 case 与 `repeat > 1` 下工厂每 target 只调用一次；主 Driver 仍按单次执行创建，Judge attempt 仍独立清理。
5. 静态 registry 保持兼容；缺实现、双实现、重复声明、name/scope 不符及装配失败都在主 Driver 创建前拒绝。
6. 未引用工厂调用次数为零；expect 字段存在判断不按 truthy 过滤，非法 rubric 保持原生 evaluate 阶段校验边界。
7. 主路径与模型判据分别收到同一显式批准；未批准及 TargetTags 拒绝语义不变，executionParams 不能改变批准。
8. 原生 verdict、absent、infra、transport、timeout、retry 与 cleanup 语义不变，模型输入和报告不泄露配置或批准。
9. 使用 fake transport/合成宿主完成默认零 token 回归，并以仓外安装公开制品验证同一官方入口；不接真实 provider 或 token 测试。
10. 消费者后续迁移时重跑其完整回归，逐项报告删除的等价装配、保留的本地政策与剩余计量限制。

## 10. 当前状态

- 本次只修订设计文档与目录导航，没有修改运行时、测试、制品、认证或计费配置。
- 方案尚未实现，上述 API 与验收结果均不能宣称已经可用或通过。
- 消费者仍停在既有的 507 行中间态；其旧 31/31 与局部回归不是当前全量验证证据。
- 截至本次文档修订，未执行构建、发布或真实调用，也未修改消费者仓。
