---
title: Recall 轮次级断言
type: spec
status: active
tags: [spec, recall, turn-assertion]
---

# Recall 轮次级断言

> 本文是线性多轮的现行行为契约：只扩展“在哪一轮评价、使用哪段文本、如何归因与计分”，不引入条件分支、提前停止、组合评分政策或作者维护的 turn 标识字段。
>
> score 始终可选，默认 `{hit: 1, miss: -1}`；机械与 boolean AI 细项采用同一规则。

## 1. 目的与范围

允许作者在准备、行动或最终轮分别声明断言，回答“具体这一轮是否符合要求”。一次多轮执行保留逐轮证据，不默认引入跨轮组合评分。

- `turns[].expect`：当前轮执行结束后评价，并在下一次 `send` 前完成。
- `case.expect`：整个线性 case 执行结束后的最终评价。
- 当前只扶正普通线性 turn；条件分支、`onFail:stop`、Decision 和其他控制流不属于本轮可执行范围。树状 turn 的兼容设计空间保留在第 9 节，但不因此成为现行行为。
- 不引入动态提示词、模板插值、评分驱动重试或自动修复。

## 2. 作者形状

```yaml
turns:
  - send: 阅读规则并说明你理解的限制
    expect:
      judge:
        ready:
          rubric: 是否准确说明限制
          score:
            hit: 0

  - send: 给出最终答案
    expect:
      output-shape:
        required: [summary, evidence]
      judge:
        grounded:
          rubric: 是否使用了本轮提供的证据

expect:
  judge:
    final_quality:
      rubric: 最终答案是否满足任务要求
      score:
        hit: 3
```

`output-shape` 是消费者判据，不是框架内建字段。两个评价位置沿用同一套 `expect.judge`、score 和变量语义，不另建逐轮评分字段。

### 字段与校验

- turn 只接受 `send/expect/timeoutMs`，不引入额外的节点标识字段。
- `turn.expect.judge` 与 `case.expect.judge` 使用相同简写、完整形态和封闭校验；rubric 名非空且不含点号。
- turn 上的其他 `expect` 键引用 `scope: turn` 的消费者判据；case 上的其他键引用 `scope: session` 的消费者判据。值仍原样透传。
- 未注册判据、非法 rubric 或 score 均在主 Driver 前拒绝，不产生部分执行。

## 3. 评价时机与输入

线性执行顺序固定为：

```text
send 当前 turn
  → 形成当前 TurnObservation
  → 执行当前 turn.expect 的全部机械与 AI 断言
  → 保存当前轮结果
  → send 下一 turn
……
全部 turn 完成
  → 执行 case.expect
```

- 同一评价点的 Judge rubric 一次批量裁定，每个细项保留独立结果；同一批次不得按 rubric 重复调用模型。
- turn 判据的 `session` 上下文只包含当前及此前已经执行的轮次，不能读取未来输出；已交付的当轮 session 不随后续执行增长。
- 每个内置 Judge 只接收所配置轮次的 `text`；不暗中拼入历史、文件、工具结果或其他轮答案。
- `case.expect` 的内置 Judge 读取最后一个实际执行 turn 的文本；自定义 session 判据仍按既有契约接收完整 `SessionObservation`。
- 最后一轮同时声明 `turn.expect` 与 `case.expect` 时，两处是作者显式声明的不同评价点，分别执行、计分，不做隐式复用。

## 4. 名称、归因与汇总

逐轮 AI 使用 0-based `turnIndex` 归因，不需要额外 id：

| 评价位置    | 完整名称示例                      |
| ----------- | --------------------------------- |
| 第 0 轮 AI  | `turn.0.judge.ready`              |
| 第 1 轮 AI  | `turn.1.judge.grounded`           |
| 第 1 轮机械 | 原消费者判据名，如 `output-shape` |
| case 级 AI  | `judge.final_quality`             |
| case 级机械 | 原消费者判据名                    |

- 不同轮次可复用局部 rubric 名，完整归因名由 turnIndex 区分；同一断言细项只计一次。
- 每个 expect 键与每个 rubric 分别产生独立结果，不增加父判据总分替代细项的隐藏聚合。

汇总包含本次线性执行中的全部声明：

```text
每个细项得分 = pass ? hit : miss
rawScore = 所有已执行 turn 与 case 最终断言的细项得分之和
casePass = 所有本次应执行的断言均完成且通过
```

不配置 score 仍为 1／-1；`hit=0` 可以只累计失败扣分；显式 `miss=0` 不会把失败改为通过。没有 Decision 时，后轮或 case 正分不能洗掉前轮失败。

## 5. 内容失败、评测错误与清理

- 某轮断言明确 `pass=false` 是内容失败：记录该轮全部结果后继续后续轮次，保留计划内证据；case 最终评价仍执行。
- 当前轮所有已声明断言必须产出合法结果。应执行却缺失的裁定／机械结果、畸形结果、Judge 调用或解析失败均为评测错误，不当作 miss、0 分或可继续的普通内容失败。
- 主执行或评测发生错误时停止后续 `send`，不再启动新的 case 最终 Judge；按既有错误通道保留诊断并清理资源。
- 当前线性契约不生成条件路径 `skipped`。第 9 节保留树状未执行路径的设计语义，但不进入本轮实现。
- case 最终内置 Judge 不自动引用所有历史结果；需要跨轮比较时使用消费者判据，不在本次引入组合政策。

## 6. 资源、repeat 与成本

- 每个配置 Judge 的实际评价点有一次逻辑批量裁定；turn 与 case 是不同评价点，即使文本相同也分别执行。
- 主 Agent 在同一个 case/repeat 内按 Driver 契约恢复多轮上下文；每个 Judge attempt 仍创建并清理独立会话，不共享主 Driver。
- repeat 重建主执行与各评价点的 attempt，报告区分 target、case、repeat、turn 与最终评价位置。
- 未声明 Judge 的评价点不调用 Judge。调用次数随实际评价点增加，不能宣称与只评最终回答等价成本。
- 分值不进入 Judge prompt；同源配置、live 批准、工具隔离、取消和清理保持既有要求。

## 7. 报告契约

报告至少保留：

- `artifact.outcomes` 的既有 `scope`、turn 的 `turnIndex`、pass、reason 与 0..1 标准分；
- `artifact.assertions` 的完整归因名、`source=ai|mechanical`、pass、reason 与 hit／miss 贡献；
- `artifact.rawScore`、casePass 与失败明细；
- repeat、取消、基础设施／评测错误的既有诊断与资源清理结果。

outcomes 的 scope／turnIndex 与完整名称共同标识评价位置；当前线性范围不新增作者树结构位置或分支路径字段，相关报告冗余见第 9 节。

## 8. 默认零 token 验收

- 第一轮、中间轮、最后一轮和 case 最终评价读取各自正确文本，并证明当前轮评价发生在下一次 `send` 前。
- 已交付的当轮 session 在后续执行后仍保持原轮次数组与文本；同名局部 rubric 跨轮不碰撞，各细项只计一次。
- 最后一轮 turn 与 case 同时声明时执行两个评价点，调用数、位置归因与分数一致。
- 自定义机械判据与内置 Judge 都按当前轮即时评价；插件 resolver 仍在主 Driver 前预检并只解析一次。
- 默认 1／-1、单项覆盖、`hit=0`、显式 `miss=0`、跨轮求和及正总分仍失败。
- 内容失败默认继续；缺裁定、机械结果畸形和 Judge 失败分别归因，错误后无后续 `send` 且完成清理。
- 既有无额外标识字段的 case 保持合法；实际落盘 `.recall.yaml` 经官方 CLI 验证位置归因与 rawScore。
- repeat、取消和资源清理不泄漏；既有 case-only 与自定义 turn 判据回归保持可解释，不通过吞错维持旧计数。

默认验收使用 fake transport、合成 registry 与 Driver，零 token；真实宿主、真实 provider 和 Judge 质量校准不属于本契约的默认完成证据。

## 9. 树状 turn 设计空间（保留，未扶正）

本节只保留未来兼容约束和设计冗余，**不是现行 API、作者字段或本轮验收范围**。启用前必须先解决与 [Scenario DSL 设计原则](./scenario-dsl.md) 的主动分支冲突，并把对应控制流文档独立扶正；不得仅凭本节提前增加 `branch`、`onFail`、路径结果或公共枚举。

### 9.1 作者树与评价节点

- 未来分支子序列中的普通 turn 与线性普通 turn 使用同一 `expect` 语义；`branch` 节点本身不声明 `expect`。
- 普通 turn 不新增作者维护的 id。需要引用结果时，使用由作者树字段和数组位置生成的结构路径，例如根节点 `turn.0`、分支内子节点 `turn.0.cases.0.turns.0`。
- 条件分支只决定执行哪段子树；轮次断言只决定评价时机。提前停止与 Decision 不反向改变评价位置的职责。

### 9.2 结构化作用域与结果可见性

- 条件引用遵守结构化分支作用域：继承之前可见结果；分支局部结果不向兄弟分支或外层导出。
- 报告仍保留完整实际执行路径的逐轮证据，结果可见性限制不等于删除诊断。
- 不同轮次继续复用局部 rubric 名，完整归因名必须稳定且不与兄弟分支或 case 级结果碰撞。

### 9.3 未执行、停止与错误冗余

- 合法条件路径未走到的轮次标记 `skipped`，不生成断言结果或分数。
- 按实际路径应执行却缺失的裁定／机械结果仍是评测错误，不得伪装成 `skipped`、miss 或 0 分。
- 默认内容失败继续；显式 `onFail:stop` 如未来扶正，深层分支触发后停止各层外部后续，分支正常完成只返回外层。
- case 最终评价读取最后一个实际执行 turn 的文本；是否运行、如何保留停止原因由提前终止契约独立规定。

### 9.4 汇总与报告冗余

- 未来树状汇总的 `rawScore` 只包含实际执行路径上的 turn 与 case 细项；`casePass` 仍要求本次应执行断言全部完成且通过，正总分不能洗掉任一失败。
- 报告在未来线性字段之外，还需保留作者树结构位置、执行顺序、评价位置、细项完整名、pass、reason、分值、累计总分、`skipped` 与评测错误。
- 当前线性实现中的 `scope`、`turnIndex` 和完整名称是未来路径归因的必要子集；树状启用时扩展为结构路径，不引入额外标识字段。
