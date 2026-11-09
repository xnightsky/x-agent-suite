---
title: "Recall 内置 Judge 与断言计分 DSL"
type: spec
status: active
tags: [spec, recall-judge-dsl]
---

# Recall 内置 Judge 与断言计分 DSL

> 状态：已定稿、已实现的现行契约。逐项可选 `score`、机械判据显式 opt-in 与统一求和属于当前能力，不是 future 预设计；分数不改变全部断言通过的验收规则。线性逐轮扩展的评价时机、归因和验收以 [Recall 轮次级断言](./recall-turn-assertion.md) 为准，后续新增行为须完成对应验证后再宣称落地。
>
> 一期不提供 `decision` DSL。机械断言与 AI 断言各自产生判断和独立贡献，所有已声明断言通过，测试才通过；真实 token、Judge 质量校准与消费者迁移不在默认验证范围内。

## 目标与一期范围

- `turns` 描述主 Agent 的执行过程；`turns[].expect` 声明当前轮断言，`case.expect` 声明最终断言。
- `expect.judge` 提供具名 AI 裁定池；机械断言继续由消费者注册 Criterion。
- 每项机械判断、每个 AI rubric 都保留独立名称、是否通过、原因与得分。
- 分值写在各断言自己的声明里，不再单独维护一张评分维度表。
- 框架只做固定计分与求和，不提供阈值、分数组合补偿或一票否决配置。
- 内置 Judge 在每个配置的评价点只读对应轮次文本；逐轮评价在下一次 `send` 前完成，case 最终评价单独执行。

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
        score: { hit: 2, miss: 0 }

      judge:
        correct:
          rubric: 核心结论是否正确
          score: { hit: 3, miss: 0 }
        explained:
          rubric: 是否说明充分理由
          score: { hit: 2, miss: 0 }
        concise:
          rubric: 是否简洁
```

每个 `judge.<名称>` 是一个独立 boolean rubric，分别配置可选 `score`，不是多个裁判模型；同一评价点仍一次批量裁定。本例 AI 项分别使用 3、2、默认 1 的命中分，不需要 Decision 或评分维度表。一个复合 rubric 不会自动获得部分分，需将可独立评价的效果拆开。

`output-shape` 是显式接入分值解析的消费者机械判据，不是框架内建名称；其 `required` 与可选 `score` 由插件输入协议解释。机械与 AI 采用同一贡献规则，省略分值时默认 hit=1/miss=-1。

机械自定义分值须在注册项显式声明 `assertionScore?: (expect) => { hit?, miss? }` resolver；未声明时 Recall 不读取插件 `input.score`，仅使用默认贡献。已有接缝不等于所有机械判据都支持内嵌 score；不能给数组等既有输入任意加字段，也不强制包装历史输入。

执行顺序：

1. 主 Agent 执行当前 send，形成当前轮观测。
2. 当前轮声明了 `turn.expect` 时，先完成本轮机械断言与一次批量 Judge，再发送下一轮。
3. 全部轮次完成后执行 `case.expect`；其标准 Judge 只接收最后一轮文本，一次批量返回各 rubric 的 boolean verdict。
4. 机械判据与每个 AI rubric 分别产生具名判断结果，按各自 hit／miss 分值计算贡献并统一求和。
5. 所有已声明断言通过，case 才通过；报告同时保留总分与失败明细。

## `turn.expect` 与 `case.expect`

```text
case
├── turns                 执行：发送什么、按什么顺序发送
│   └── turn.expect        当前轮断言，下一次 send 前完成
└── expect                最终断言：全部轮次后执行
    ├── judge             AI rubric 与各项可选分值
    └── <custom-metric>   消费者注册的机械或其他判据输入
```

不增加 `decision / dimensions / verdict / outcome` 作者引用层。已有 Criterion 与通用判据工厂仍是机械判断、产物检查和特殊证据的扩展入口；不把旧 decision 的 `eq / one_of / from` 改名后塞进新的框架 DSL。

`expect.judge` 可出现在 `turns[].expect` 与 case 级 `expect`，两种位置使用同一作者形状。逐轮 turnIndex、评价时机、完整命名、错误与树状设计空间见 [Recall 轮次级断言](./recall-turn-assertion.md)。

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

- 每个含 judge 的 turn 对该轮 `turn.text` 执行一次批量裁定；case 级 judge 对最后一轮文本另执行一次。
- 标准 Judge 不读取主对话历史、其他轮答案、文件、工具状态或 workspace。
- 缺失所配置轮次输出等执行错误在 Judge 前终止，不转换成内容不通过。
- 默认复用主执行同源的 target、config、TargetTags、live 批准、mode、cliRef、profile 与 transport。
- 每次 attempt 创建独立 backend／Driver；borrowed 使用独立单轮 spec、`effects: none` 和空执行参数。
- 支持同步／异步 profile 工厂；创建受 abort 管理，取消后迟到的 Driver 仍须关闭。
- attempt 结束必须清理，不共享主 Driver，不做路径 fallback。

一期不增加 Judge 专用 target、grader、Driver 或 fallback DSL。

## 断言直接计分

逐项可选 `score` 的完整规则已迁入独立的 [Recall 断言计分](./recall-scoring.md) 正式规格：默认 hit=1／miss=-1，机械判据显式 opt-in，各细项贡献统一求和；所有已声明断言通过才通过，正总分不能抵消失败。该规格同时定义机械 resolver 的预检缓存与报告分值分层。

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

## 默认验收

默认使用 fake transport、合成 registry 与 Driver，保持零 token：

- 每个配置的 turn 与 case 评价点只把对应文本送入标准 Judge；当前轮评价先于下一次 send。
- 简写／完整 judge 均支持各 rubric 的可选 score，评分配置不进入 Judge prompt。
- 每个机械结果与 AI rubric 独立保留名称、pass、reason 和得分。
- score 可省略，默认 hit=1／miss=-1；只写 hit、只写 miss、hit=0、显式 miss=0 与其他有限分值均按声明加减分。
- 五项机械断言一项失败扣 1、两项失败扣 2；机械与 AI 结果进入同一求和出口。
- 总分为正但存在失败项时测试仍未通过；miss=0 不会把失败改成通过。
- 同一断言细项只计一次，不再区分显式评分维与隐式补维。
- 缺少必需裁定、评测失败与内容未通过分别验证，不能静默计 0。
- 旧 decision DSL 与非法 score 在预检拒绝，不启动主执行或 Judge。
- 同源批准、独立会话、取消与清理保持既有安全要求。

线性逐轮行为已由默认 fake transport、合成 registry/Driver 与官方 CLI 子进程回归验证，覆盖逐轮文本、下一次 send 前评价、turn/case 独立调用、完整命名、跨轮计分和错误后停止；既有 case 级历史真实宿主证据不替代这些新增用例。真实 provider/token、其他消费者迁移及 Judge 质量校准仍不属于默认证据。

## 后续设计

### Decision 分数验收政策

本节只保留独立延后需求备忘，未实现，没有可用 DSL；不保留字段、算法或报告 schema 草案。不同效果分别得分已由 [现行断言计分](./recall-scoring.md) 解决，不需要 Decision。

- 只有消费者明确要求“原断言存在失败，但总分达标也判最终通过”时，才重新讨论额外验收政策；不同效果不同分数、比较两个 FAIL 或调整贡献均不触发。
- 不恢复维度表、第二套赋分或总分，不把标准分、scope 或机械插件任意输入当作贡献配置。
- 不将原始失败改写为通过，不以其他正分吞掉评测错误，也不能放行已确认的失败提前停止。
- 不因分支、分类或评级的存在而默认引入本能力。
- 重新立项须先确认第二个独立消费者也需要分数放行，再决定是否由框架承载，另写设计、验收与实施计划；本节不提前选择 threshold/required 等字段。

### 分类、条件分支与提前终止

线性 [轮次级断言](./recall-turn-assertion.md) 已转为现行契约，其文档第 9 节保留树状 turn 设计空间，但不把树状执行提前变成当前能力。其他后续能力按职责分别设计，不要求先实现 decision：

- [分类预设计](./future/recall-classification-pre-design.md)：choices／else 产出受约束类别。
- [条件分支预设计](./future/recall-conditional-branching-pre-design.md)：按条件执行内嵌子步骤，结束后自然继续外层，不暴露跳表。
- [提前终止预设计](./future/recall-early-termination-pre-design.md)：onFail:stop 在明确失败后停止。

重要分支通过多个 case 覆盖，模型方差通过 repeat 观察，不要求单次运行走完所有路径。后续设计统一由 [future 索引](./future/README.md) 导航。

### 独立 Judge 选择

出现明确需求后，再设计 Judge target 覆盖、固定答案输入、离线校准与显式 token 质量门禁；一期不预设这些配置。
