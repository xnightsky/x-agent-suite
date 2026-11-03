---
title: "Recall 内置 Judge 与断言计分 DSL"
type: spec
status: active
tags: [spec, recall-judge-dsl]
---

# Recall 内置 Judge 与断言计分 DSL

> 状态：第一阶段已实现，并通过默认 fake 回归与真实 Pi headless + loopback fake provider 集成验证；本文按断言直接计分的一期范围收口。
>
> 一期不提供 `decision` DSL。机械断言与 AI 断言各自产生判断和独立贡献，所有已声明断言通过，测试才通过；真实 token、Judge 质量校准与消费者迁移不在默认验证范围内。

## 目标与一期范围

- `turns` 描述主 Agent 的执行过程，case 级 `expect` 声明断言。
- `expect.judge` 提供具名 AI 裁定池；机械断言继续由消费者注册 Criterion。
- 每项机械判断、每个 AI rubric 都保留独立名称、是否通过、原因与得分。
- 分值写在各断言自己的声明里，不再单独维护一张评分维度表。
- 框架只做固定计分与求和，不提供阈值、分数组合补偿或一票否决配置。
- 首版内置 Judge 只评 case 最后一轮文本；既有自定义判据的调度契约不因本设计批量改写。

本设计不提供缺席计分机制。评测错误与被测内容未通过必须区分，但不为此增加第三种作者计分状态。

## 第一阶段总览

```yaml
cases:
  - id: answer-quality
    turns:
      - send: 先阅读规则并准备回答
      - send: 现在给出最终结论
    expect:
      output-shape:
        required: [summary, evidence]
        score:
          miss: -1

      judge:
        ownership:
          rubric: 是否说明写新队列属于 author 侧
          score:
            hit: 3
        polite:
          rubric: 措辞是否礼貌
        concise:
          rubric: 是否简洁
```

`output-shape` 是消费者注册的机械判据，不是框架内建名称；示例的 `required` 与 `score` 由该判据的输入协议解释。既有自定义判据输入继续原样透传，不强制包装历史输入，也不由 Recall 抢占插件已有字段。机械可配分值须在注册项上显式声明 `assertionScore?: (expect) => { hit?, miss? }` resolver；未声明时 Recall 不读取插件 `input.score`，仅按 pass 使用默认贡献。

执行顺序：

1. 主 Agent 执行全部 send。
2. 标准 Judge 只接收最后一轮文本，一次批量返回各 rubric 的 boolean verdict。
3. 机械判据与每个 AI rubric 分别产生具名判断结果。
4. 按各断言自己的 hit／miss 分值计算贡献，再求和。
5. 所有已声明断言通过，case 才通过；报告同时保留总分与失败明细。

## case 级 `expect`

```text
case
├── turns                 执行：发送什么、按什么顺序发送
└── expect                断言：期望什么、各项如何计分
    ├── judge             AI rubric 与各项可选分值
    └── <custom-metric>   消费者注册的机械或其他判据输入
```

不增加 `decision / dimensions / verdict / outcome` 作者引用层。已有 Criterion 与通用判据工厂仍是机械判断、产物检查和特殊证据的扩展入口；不把旧 decision 的 `eq / one_of / from` 改名后塞进新的框架 DSL。

`expect.judge` 只出现在 case 级；首版不向 `turns[].expect` 开放内置 Judge。既有自定义逐轮判据保持原契约。

## `judge`：具名裁定池

### 简写

```yaml
expect:
  judge:
    accurate:
      rubric: 回答是否准确
      score:
        hit: 3
    complete:
      rubric: 是否覆盖必要信息
      score:
        miss: -1
    honest:
      rubric: 不确定的内容是否明确说明
```

每个 KV key 是稳定的 rubric 名，不重复声明 name。每项值只接受 `rubric` 与可选 `score`：

- `rubric` 为非空字符串。
- `score` 是可选的封闭对象，只接受 hit 与 miss。
- 所有声明的 rubric 都参与判断和计分，不需要引用，也不存在未引用 rubric 的隐式补维规则。

### 完整形态：执行参数

```yaml
expect:
  judge:
    timeoutMs: 30000
    maxRetries: 2
    instructions: 只根据最终回答中的证据判断
    rubrics:
      accurate:
        rubric: 回答是否准确
        score:
          hit: 3
      complete:
        rubric: 是否覆盖必要信息
```

| 字段           | 类型与默认值         | 语义                                          |
| -------------- | -------------------- | --------------------------------------------- |
| `rubrics`      | KV map，至少一项     | key 为裁定名，value 为 `{ rubric, score? }`。 |
| `timeoutMs`    | 正整数，默认 `30000` | 每次 attempt 的超时。                         |
| `maxRetries`   | 非负整数，默认 `2`   | 首次调用后的重试上限，仍受错误类别预算约束。  |
| `instructions` | 非空字符串，可选     | 在标准 judge-v1 协议后追加场景约束。          |

`rubrics / timeoutMs / maxRetries / instructions` 是保留键，不能作为简写裁定名；出现执行字段时使用完整形态。

编译时把 rubric 名与文本转换为 `JudgeRubric[]`，分值配置留在断言侧，不进入 Judge prompt 或裁定协议。Judge 只返回裁定，不负责计算得分。

### 输入与会话边界

- 每个含 judge 的 case 对最后一轮 `turn.text` 执行一次批量裁定。
- 标准 Judge 不读取主对话历史、中间答案、文件、工具状态或 workspace。
- 缺失最终输出等执行错误在 Judge 前终止，不转换成内容不通过。
- 默认复用主执行同源的 target、config、TargetTags、live 批准、mode、cliRef、profile 与 transport。
- 每次 attempt 创建独立 backend／Driver；borrowed 使用独立单轮 spec、`effects: none` 和空执行参数。
- 支持同步／异步 profile 工厂；创建受 abort 管理，取消后迟到的 Driver 仍须关闭。
- attempt 结束必须清理，不共享主 Driver，不做路径 fallback。

一期不增加 Judge 专用 target、grader、Driver 或 fallback DSL。

## 断言直接计分

| 字段         | 默认值 | 语义                                                      |
| ------------ | ------ | --------------------------------------------------------- |
| `score.hit`  | `1`    | 断言通过时加多少分，可配置为 3，也可为 0。                |
| `score.miss` | `-1`   | 断言未通过时加多少分；省略默认扣 1，显式配置 0 才不扣分。 |

score 是可选字段；省略 score 或写空对象时，等价于 `score: { hit: 1, miss: -1 }`。只覆盖其中一项时，另一项仍应用默认值；hit 与 miss 均须为有限数：

- 不写 score：通过加 1，未通过扣 1；机械断言与 AI rubric 相同。
- 只写 `hit: 3`：通过加 3，未通过仍扣 1，不自动扣 3。
- 只写 `miss: 0`：通过默认加 1，未通过得 0。
- 只写 `hit: 0`：通过得 0，未通过默认扣 1，只累计失败扣分。

每项贡献与总分只有直接算术：

```text
本项得分 = pass ? hit : miss
rawScore = 所有断言细项得分之和
casePass = 所有已声明断言细项的 pass 均为 true
```

一期不需要 maxScore、分母排除、归一分或分数通过线。0 分不自动表示通过或失败，负分也不是唯一的失败标志；是否通过以 boolean 判断为准。正分不能抵消某项断言失败。

### 机械与 AI 的统一汇总

| 断言     | 类型 | 判断   | 得分           |
| -------- | ---- | ------ | -------------- |
| 字段正确 | 机械 | 通过   | +1             |
| 产物有效 | 机械 | 未通过 | -1             |
| 回答准确 | AI   | 通过   | +3             |
| 信息完整 | AI   | 未通过 | 0，显式 miss=0 |

总分为 `1 - 1 + 3 + 0 = 3`，但两项断言未通过，所以测试未通过。

五项机械断言都配置 `hit: 0, miss: -1` 时，一项失败总分为 -1，两项失败为 -2；AI 细项可按同样规则加入求和。不需要先建评分维度或单独声明结果引用。

报告至少保留断言名、机械／AI 来源、pass、reason、本项分值贡献、总分与失败项。总分不能替代逐项结果，也不能把一次 Judge 批量调用压成一个总布尔后再计细项分。

### 通用断言职责与机械 resolver

- `@x-agent-suite/assertions` 负责把 `JudgeOutcome` 展开为逐 rubric 的原始 name/pass/reason/0..1 结果，并提供 score 封闭校验、独立默认值与 `pass ? hit : miss` 贡献计算。既有 `createJudgeAssertion` 复用同一适配，公开行为不变。
- `@x-agent-suite/observation` 的 `runCriteria` 在结果源校验机械与 AI 判据的 boolean pass、字符串 reason 和 0..1 有限 score；缺结果或畸形结果是评测错误。
- Recall 只负责作者 YAML、最后文本选择、registry 装配、resolver 预检缓存和报告投影。静态 Criterion 与工厂都可在注册项声明 `assertionScore`；只对实际引用在装配期同步解析一次，按 execution、scenario 与判据出现位置缓存，运行/重试/报告阶段不再调用。
- resolver 返回值必须是同步普通对象，只允许 hit/miss；Promise、null、数组、额外字段、非有限数和 resolver 抛错均为定义错误 CLI=2，在主 Driver 前拒绝。resolver 不进入 ScenarioSpec 或报告，不得启动 Driver 或联网。
- 报告 `result.artifact.outcomes` 原样保留既有 0..1 标准分；`result.artifact.assertions` 另存 name/source/pass/reason/score 贡献，`result.artifact.rawScore` 为贡献之和。贡献不会回写 CriterionOutcome。

## 校验与错误语义

- YAML 重复 key 在解析期拒绝。
- rubric 名非空且不含点号，便于稳定归因。
- Judge 完整对象、rubric 项和 score 对象使用封闭 schema；未知字段、非法分值与执行参数在主 Driver 前拒绝。
- 自定义判据名称、声明与装配仍按 registry 规则校验；其领域输入由对应插件校验。
- 一期不接受旧 `expect.decision`；不提供框架级 weight、threshold、knockout、缺席映射或 coverage 计分门禁。
- Judge 缺少必需 boolean 裁定、判据未产出应有结果、整体调用或解析失败，都是评测错误，不伪装成正常 miss 或默认扣分。
- 被测输出没有满足机械判据要求，包括未输出所需字段，属于内容未通过，按 miss 计分。

| 场景                                           | 结果                                             |
| ---------------------------------------------- | ------------------------------------------------ |
| 全部断言通过                                   | case 通过，CLI=0，报告保留各项得分与总分。       |
| 任一机械或 AI 细项未通过                       | case 未通过，CLI=0；总分正、零或负均不改变判断。 |
| 必需裁定／判据结果缺失，或调用、超时、解析失败 | 评测错误，CLI=1，报告诊断，不给出正常评分结论。  |
| DSL、registry 或执行参数定义非法               | CLI=2，不创建主 Driver 或 Judge。                |

通用 Judge、独立 Assertions 与既有聚合机的合法公开调用保持兼容；通用裁定/分值原语归 Assertions，CriterionResult 形状校验归 Observation，Recall 不再维护第二套断言引擎。

## 第一阶段验收

默认使用 fake transport、合成 registry 与 Driver，保持零 token：

- 多轮 case 只把最后一轮文本送入标准 Judge。
- 简写／完整 judge 均支持各 rubric 的可选 score，评分配置不进入 Judge prompt。
- 每个机械结果与 AI rubric 独立保留名称、pass、reason 和得分。
- score 可省略，默认 hit=1／miss=-1；只写 hit、只写 miss、hit=0、显式 miss=0 与其他有限分值均按声明加减分。
- 五项机械断言一项失败扣 1、两项失败扣 2；机械与 AI 结果进入同一求和出口。
- 总分为正但存在失败项时测试仍未通过；miss=0 不会把失败改成通过。
- 同一断言细项只计一次，不再区分显式评分维与隐式补维。
- 缺少必需裁定、评测失败与内容未通过分别验证，不能静默计 0。
- 旧 decision DSL 与非法 score 在预检拒绝，不启动主执行或 Judge。
- 同源批准、独立会话、取消与清理保持既有安全要求。

上述一期行为已由默认 fake transport、合成 registry/Driver 与官方 CLI 子进程回归验证。另经 `E2E_PI_RECALL=1 E2E_PI_PTY=1 pnpm ittest` 验证真实宿主：既有 Pi PTY 两项与新 Recall headless 一项均通过，覆盖两次主单轮请求、一次独立 Judge、rawScore=3、case FAIL/CLI=0、权限隔离和现场清理，零 token。另经 `pnpm ittest:token:cedar-judge --carrier pi --approve-live` 完成真实 provider/token 的 Cedar 单轮 smoke：机械 answer-contract 与 AI ready 通过、AI forbidden 未通过，rawScore=4、case FAIL/CLI=0，现场已清理。共享 PTY 对话历史、其他消费者迁移及 Judge 质量校准仍未验证。

## 后续设计

### Decision：组合评分政策

`decision` 移到 [Recall Decision 预设计](./future/recall-decision-pre-design.md)，不属于一期。只有需要“允许部分失败但达到通过线”、组合结果、一票否决或跨阶段评分时再打开；不因机械与 AI 混合计分就引入它。

### 分类、条件分支、逐轮断言与提前终止

后续能力按职责分别设计，不要求先实现 decision：

- [分类预设计](./future/recall-classification-pre-design.md)：choices／else 产出受约束类别。
- [条件分支预设计](./future/recall-conditional-branching-pre-design.md)：按条件执行内嵌子步骤，结束后自然继续外层，不暴露跳表。
- [轮次级断言预设计](./future/recall-turn-assertion-pre-design.md)：在哪轮配置就在哪轮评价。
- [提前终止预设计](./future/recall-early-termination-pre-design.md)：onFail:stop 在明确失败后停止。

重要分支通过多个 case 覆盖，模型方差通过 repeat 观察，不要求单次运行走完所有路径。原混合文档已改为 [预设计索引](./future/recall-classification-branching-pre-design.md)。

### 独立 Judge 选择

出现明确需求后，再设计 Judge target 覆盖、固定答案输入、离线校准与显式 token 质量门禁；一期不预设这些配置。
