# Recall 内置 Judge 与 Decision DSL

> 状态：第一阶段设计已确认（2026-11-01），尚未实现。
>
> 本文定义目标作者接口。现有实现与既有测试仍以 `docs/spec/testing.md` 登记为准；实施计划需在书面规格确认后重排。

## 目标

把 AI 断言与精确评分提供为 Recall 的标准能力，同时保持执行配置与断言配置分离：

- `turns` 只描述主 Agent 的执行过程。
- case 级 `expect` 是断言根，集中声明 `judge`、`decision` 与其他判据输入。
- `judge` 只产具名 boolean verdict，不直接出分。
- `decision` 用精确命中器与静态规则计算成绩，支持权重、否决、缺席映射、OR、threshold 和 coverage。
- 首版只评 case 最后一轮输出；逐轮评价与条件控制不在第一阶段扩展。

自定义 Criterion 与通用判据工厂继续服务其他扩展判据。

## 第一阶段总览

```yaml
cases:
  - id: routing
    turns:
      - send: 先阅读规则并准备回答
      - send: 现在给出最终结论

    expect:
      judge:
        timeoutMs: 30000
        maxRetries: 2
        instructions: 只根据最终回答中的证据判断
        rubrics:
          ownership:
            rubric: 是否说明写新队列属于 author 侧
          polite:
            rubric: 措辞是否礼貌
          concise:
            rubric: 是否简洁

      decision:
        threshold: 0.5
        dimensions:
          chosen_skill:
            eq: recall-author
            knockout: true

          reasoning:
            verdict: judge.ownership
            weight: 3

          style_ok:
            verdict: [judge.polite, judge.concise]
            absent: fail
```

执行顺序：

1. 主 Agent 依次执行两轮 `send`。
2. 第一轮只建立上下文，不进入本 case 的内置 Judge。
3. 最后一轮 `turn.text` 同时成为字面命中器与 Judge 的输入。
4. Judge 一次批量返回 `ownership / polite / concise` 的 verdict。
5. `decision` 对字面值与 verdict 做精确命中、缺席映射和静态计分。
6. 报告保留逐维证据、rawScore、归一分 `score`、coverage 与否决原因。

## case 级 `expect`

`expect` 是 case 的断言根，不是新一轮执行指令：

```text
case
├── turns                 执行：发送什么、按什么顺序发送
└── expect                断言：期望什么、如何判定、如何计分
    ├── judge             AI 裁定池与执行参数
    ├── decision          精确命中与静态评分表
    └── <custom-metric>   消费者注册的其他判据输入
```

第一阶段中，内置 `judge` 与 `decision` 只出现在 case 级 `expect`。`turns[].expect` 不声明这两个内置字段；既有自定义判据的调度契约不因本设计被批量改写。

### 为什么使用 `expect`

- 它表达声明式的“期望”，而不是立即执行动作的 `assert`。
- 它能同时容纳判定依据与评分规则。
- 它与本仓既有 `ExpectBlock` 术语一致。

## `judge`：具名裁定池

### 简写：只声明 rubric

```yaml
expect:
  judge:
    ownership:
      rubric: 是否说明写新队列属于 author 侧
    no_invention:
      rubric: 是否没有臆造仓库中不存在的字段
```

每个 KV key 是稳定的 rubric 名，后续通过 `judge.<name>` 引用。简写不再重复声明 `name`。

只写 `judge`、不写 `decision` 时保持简单模式：产生单个 `judge` outcome，全部 verdict 明确为 true 才 PASS，任一明确 false 为内容 FAIL，任一缺 verdict 为 `[absent]`。

### 完整形态：声明执行参数

```yaml
expect:
  judge:
    timeoutMs: 30000
    maxRetries: 2
    instructions: 只根据最终回答中的证据判断
    rubrics:
      ownership:
        rubric: 是否说明写新队列属于 author 侧
      no_invention:
        rubric: 是否没有臆造仓库中不存在的字段
```

| 字段           | 类型与默认值           | 语义                                       |
| -------------- | ---------------------- | ------------------------------------------ |
| `rubrics`      | KV map，必填且至少一项 | key 为裁定名，value 为 `{ rubric }`        |
| `timeoutMs`    | 正整数，默认 `30000`   | 每次 attempt 的超时                        |
| `maxRetries`   | 非负整数，默认 `2`     | 首次调用后的重试上限，仍受错误类别预算约束 |
| `instructions` | 非空字符串，可选       | 在标准 judge-v1 协议后追加场景约束         |

`rubrics` 在编译时转换为现有 `JudgeRubric[]`；KV 是作者接口，数组是执行接口，二者不要求形状相同。

为避免简写与完整形态产生歧义，`rubrics / timeoutMs / maxRetries / instructions` 是保留键，不能作为简写裁定名。出现任一执行字段时必须使用完整形态。

### 首版输入边界

- 只评 case 最后一轮 `turn.text`。
- 每个含 `judge` 的 case 执行一次批量裁定，而不是每轮各调用一次。
- Judge 不读取主对话历史、中间答案、文件、工具状态或 workspace。
- 空 turns、缺失最终输出等既有执行错误在 Judge 前终止，不转换成内容 FAIL。

## `decision`：具名评分维与精确命中器

`decision` 位于 case 级 `expect` 下：

```yaml
expect:
  decision:
    threshold: 0.5
    dimensions:
      chosen_skill:
        eq: recall-author
        knockout: true
      reasoning:
        verdict: judge.ownership
        weight: 3
```

`dimensions` 使用 KV：key 是作者定义的评分维度名，value 是该维的命中与计分规则。保留 `dimensions` 包装后，`threshold` 可以与维度表同级，不占用维度命名空间。

### 命中器

每个维度必须且只能选择下列一种命中来源：

| 字段      | 形状                  | 命中语义                                                     |
| --------- | --------------------- | ------------------------------------------------------------ |
| `eq`      | 非空字符串            | 从最终回答抽取实际值，trim、大小写不敏感后与期望值精确相等   |
| `one_of`  | 非空字符串数组        | 实际值等于任一候选即命中                                     |
| `verdict` | `judge.<name>` 或数组 | 引用 Judge 的 boolean verdict；数组表示 OR，任一 pass 即命中 |
| `outcome` | 字符串或字符串数组    | 引用其他 CriterionOutcome；数组沿用现有聚合机的 OR 归约语义  |

例如：

```yaml
decision:
  dimensions:
    chosen_skill:
      eq: recall-author

    skill_family:
      one_of: [recall-author, recall-eval]

    reasoning:
      verdict: judge.ownership

    style_ok:
      verdict: [judge.polite, judge.concise]

    deterministic_evidence:
      outcome: text-contains
```

`outcome` 是本仓为混合确定性判据保留的连接口，明确引用 `CriterionOutcome` 而非数值指标；不把字面命中器塞进 Judge，也不要求所有判断都先注册成分类。编译后仍映射到内部 `DimensionSpec.metric`。

### `from`：字面维的可选抽取器

`eq` 与 `one_of` 维度可声明 `from`：

```yaml
decision:
  dimensions:
    chosen_skill:
      eq: recall-author
      from: '^chosen_skill:\s*(.+?)\s*$'
      knockout: true
```

规则：

- `from` 是含一个捕获组的正则，只用于 `eq / one_of`；正则按 `m` 多行模式逐行求值，`^` 与 `$` 锚定行边界。
- 不允许显式 flags、`s / g / y / u / v` 语义或 lookahead/lookbehind，避免跨行吞并、状态残留和灾难性回溯；作者需要更复杂的抽取时，应通过自定义确定性 Criterion 提供 `outcome`。
- 未声明时使用 `^<维度名>: <值>$` 的行约定，同一 `m` 语义，维度名因此也是默认字段名。
- 正则无法匹配、匹配结果为空或输入不存在时，该维为 absent，不猜测实际值。
- `verdict / outcome` 维禁止声明 `from`。

### 计分字段

| 字段        | 默认值  | 语义                                                                          |
| ----------- | ------- | ----------------------------------------------------------------------------- |
| `weight`    | `1`     | 命中 `+weight`、未命中 `−weight`                                              |
| `knockout`  | `false` | 映射后未命中时直接否决整个 case                                               |
| `absent`    | `zero`  | 缺席映射：`zero / pass / fail`                                                |
| `threshold` | 省略    | 任意有限数；对可为负的归一分设置通过线。省略时要求全部计入维命中且无 knockout |

`absent: zero` 贡献 0 且不计入 maxScore；`pass` 按命中计入；`fail` 按未命中计入。coverage 统计映射前非缺席维数，`absent: pass/fail` 不会倒推提高 coverage。Recall `expect.decision` 基于通用聚合结果的 coverage 执行零覆盖门禁：`coverage.evaluated=0` 时默认 `pass=false`，即使 threshold 较低也不能让空考通过；只有至少一个维度显式声明 `absent: pass`，才表示作者允许缺证据宽免，可继续按映射、knockout 与 threshold 判定。

### 默认参与与引用完整性

当 case 同时声明 `judge` 与 `decision` 时：

1. 显式维度按声明精调。
2. 未被任何 `verdict` 引用的 rubric 自动形成隐式维度：`weight=1`、`knockout=false`、`absent=zero`。
3. `verdict: judge.<name>` 必须引用当前 case 已声明的 rubric，未知引用在编译期拒绝。
4. `outcome` 引用沿用现有聚合机的 outcome 与 absent 规则。
5. 所有维度保留作者声明的 KV key，报告中必须能区分“维度名”和“命中来源”。

## 编译与执行分层

作者接口不直接等于运行时聚合结构：

```text
case.expect.judge（KV）
  → 编译为 JudgeRubric[]
  → 最后一轮文本的一次批量 Judge
  → judge.<rubric> verdict outcomes

case.expect.decision.dimensions（KV）
  → eq / one_of 编译为字面抽取与精确匹配
  → verdict / outcome 保留为结果引用
  → 统一降低为 CriterionOutcome[] + DimensionSpec[]
  → resolveAggregate
  → ScenarioResult + artifact.aggregate + JSON 报告
```

精确命中与零覆盖门禁发生在 Recall 编译/判据适配层，现有聚合机继续只做三态归约与算术，不引入第二套评分机，也不改变既有 `ScenarioSpec.aggregate` 的空考行为。

只有 `ScenarioSpec.expandOutcomes` 显式列出的判据才能调用 `evaluateMany()`；既有 `createJudgeAssertion + aggregate` 未声明该字段时保持原单结果名称与行为。

## 校验与错误语义

- YAML 重复 key 必须在解析期拒绝，禁止后者覆盖前者。
- rubric 名与维度名必须非空且不得包含 `.`，避免 `judge.<name>` 引用歧义。
- 完整 `judge` 对象、rubric 项、decision 与维度项均使用封闭 schema，未知字段在编译期拒绝。
- 每维必须恰好声明 `eq / one_of / verdict / outcome` 之一。
- `verdict` 必须使用 `judge.` 前缀并引用已声明 rubric。
- 字面维与 `from` 的组合、正则捕获组、多行行边界、受限 flags/语法、正权重、有限 threshold 及执行参数在编译期校验。

| 场景                                     | 结果语义                                               |
| ---------------------------------------- | ------------------------------------------------------ |
| 简单模式全部通过                         | 单个 `judge` outcome `pass=true`、`score=1`；CLI=0     |
| 简单模式明确 false                       | 单个 `judge` outcome `pass=false`、`score=0`；CLI=0    |
| 简单模式缺 verdict                       | `[absent]` 基础设施 failure；CLI=1                     |
| decision 单项缺 verdict / 字面值缺席     | 进入对应维的 absent 映射；属于聚合输入，内容结果 CLI=0 |
| Judge 整体调用、超时、响应或整体解析失败 | `[not-evaluated:<kind>]` 基础设施 failure；CLI=1       |
| DSL 结构、引用或执行参数非法             | 定义错误；CLI=2，不创建主 Driver 或 Judge              |

## 默认 AI 配置与独立裁定会话

标准 Judge 默认复用主执行同源配置：target、config、TargetTags、live 批准、mode、cliRef、profile 与 transport。

每次 attempt 创建独立 backend/Driver：

- direct 使用同源 target/config 与 direct transport。
- borrowed 使用同源 cliRef/profile、独立单轮 judge spec、`effects: none` 和空执行参数。
- 同步与异步 profile 工厂均受支持；异步创建纳入 abort，取消后迟到的 Driver 仍须关闭。
- 每次 attempt 结束后清理，保持同 target、同 mode，不做 Driver fallback。

第一阶段不增加 Judge 专用 target、grader、Driver 或 fallback DSL。

## 第一阶段验收重点

默认零 token 测试使用 fake transport 固定主回答与 Judge 响应，至少覆盖：

- 多轮 case 只把最后一轮文本送入 Judge。
- 简单 PASS、明确 FAIL、absent 与整体 not-evaluated。
- `eq` 精确命中、`one_of`、默认行约定与自定义 `from`。
- `verdict` 单项引用、OR、weight 与 knockout。
- 未引用 rubric 的隐式维度、未知引用与重复 key 拒绝。
- 非法 DSL 的定义错误场景返回 CLI=2，主 transport 与 Judge transport 均无调用。
- decision absent 映射、coverage、rawScore 与归一分。
- Recall `expect.decision` 的零覆盖门禁与既有通用 aggregate 空考行为保持分离。
- `outcome` 与 Judge verdict 的混合聚合。
- 完整 judge 执行参数与 direct/borrowed 独立会话清理。

## 后续发展方向（不属于第一阶段）

### 1. 逐轮细粒度断言

未来可支持“在哪一轮配置，就在哪一轮评价”，使准备轮、行动轮与最终轮拥有不同 rubric。它需要定义轮次选择、输出引用、逐轮证据与跨轮 absent，而不是简单把 case 级 `judge` 复制到 `turns[]`。

### 2. 跨轮评分与阶段组合

可将多个阶段的 verdict 汇总到后续 case 或最终 decision，并明确阶段间数据依赖、重复执行和报告归因。跨轮评分应与单 case 最终回答评分保持可区分的结果形状。

### 3. 条件分支与动态后续提示词

例如前一轮被识别为 A 后选择 B 提示词。该方向会引入条件选择、分支可复现性与场景图执行，不应作为 `judge` 的隐式副作用加入。

**与现有约束的关系：**`scenario-dsl.md` 当前要求 LLM 只作分类器、不作控制器。若允许 AI verdict 直接选择分支，必须先单独评审并修订该可比性约束；确定性条件分支与 AI 条件分支应分别设计。

### 4. 提前终止与护栏

当某轮已满足目标或出现不可恢复失败时，可跳过后续轮次。该能力需要区分“成功完成”“内容失败”“基础设施失败”和“作者主动终止”，并保证剩余轮次不会被误记为 absent 或 PASS。

### 5. 独立 Judge 选择与固定答案评估

出现明确消费者需求时，再设计 grader/target 覆盖、固定答案输入、离线 Judge 校准与真实 live 质量门禁；第一阶段不预设这些配置。

实施拆分与测试文件落点在书面规格确认后通过实施计划另行定义。
