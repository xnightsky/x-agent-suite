---
title: Recall 轮次级断言预设计
type: pre-design
status: future
tags: [recall, turn-assertion]
---

# Recall 轮次级断言预设计

> 状态：未来预设计，尚未实现，不进入一期。本文只扩展“在哪一轮评价”，不隐含条件分支或提前停止。
>
> score 始终可选，默认 `{hit: 1, miss: -1}`；机械与 boolean AI 细项采用同一规则。

## 1. 目的与职责

允许作者在准备、行动或最终轮分别声明断言，回答“具体这一轮是否符合要求”。一次多轮执行可以保留逐轮证据，不必默认引入跨轮组合评分。

- 普通 turn 的 expect：本轮执行结束后评价，包括分支子序列内的普通 turn；branch 节点本身不声明 expect。
- case.expect：整个 case 结束后的最终评价。
- [条件分支](./recall-conditional-branching-pre-design.md) 与 [提前终止](./recall-early-termination-pre-design.md) 单独决定控制流。
- [Decision](./recall-decision-pre-design.md) 如将来出现，只读取已产生的结果，不负责安排评价时机。

## 2. 作者形状

```yaml
# PRE-DESIGN ONLY
turns:
  - id: prepare
    send: 阅读规则并说明你理解的限制
    expect:
      judge:
        ready:
          rubric: 是否准确说明限制
          score:
            hit: 0

  - id: answer
    send: 给出最终答案
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

output-shape 是消费者判据，不是框架内建字段。各位置延续一期的输入和分值语义，不另加一套逐轮评分字段。

## 3. 作用时机与输入

- turn.expect 在对应输出可用后、下一次 send 前执行。
- 同一评价点的 Judge rubric 一次批量裁定，每个细项保留独立结果。
- 每个 Judge 只接收所配置轮次的文本；不暗中拼入历史、文件或其他轮答案。
- case.expect 在执行路径结束后运行，读取最后一个实际执行 turn 的文本。
- 若最后一轮同时有 turn.expect 与 case.expect，两处是作者显式声明的不同评价，分别执行、计分，不做隐式复用。
- 仍不支持动态提示词、模板插值、评分驱动重试或自动修复。

## 4. 名称、作用域与汇总

- 含 turn.expect 的 turn 必须声明稳定 id；同一 case 中所有已声明 turn id 唯一，包括不同分支；id 不含点号、空白或等号。
- 条件引用遵守结构化分支作用域：继承之前可见结果，分支局部结果不向兄弟分支或外层导出；报告仍保留完整逐轮证据。
- 逐轮 AI 名称为 turn.<id>.judge.<rubric>；逐轮机械结果为 turn.<id>.outcome.<criterion>。
- case 级 AI 仍为 judge.<rubric>，与逐轮结果不碰撞。
- 不同轮次可复用局部 rubric 名，完整归因名必须不同。
- 插件包含多个机械细项时，须保留各细项稳定身份；不能只给父判据一个总分后伪称细项可追溯。

汇总只包含实际执行路径上的声明：

```text
每个细项得分 = pass ? hit : miss
rawScore = 所有已执行 turn 与 case 最终断言的细项得分之和
casePass = 所有本次应执行的断言均完成且通过
```

不配置 score 仍为 1／-1；hit=0 可以只累计失败扣分；显式 miss=0 不会把失败改为通过。没有 Decision 时，不允许后轮正分洗掉前轮失败。

## 5. 未执行、失败与错误

- 默认即使某轮内容失败，也继续执行后续轮次，保留全部计划内证据。
- 要停止整个 case 必须显式配置 onFail:stop，深层分支触发也停止各层外部后续；分支正常完成只返回外层。细则见 [提前终止](./recall-early-termination-pre-design.md)。
- 合法条件路径未走到的轮次标记 skipped，不生成断言结果或分数。
- 按本次路径应执行却缺失的裁定／机械结果是评测错误，不当作 skipped、miss 或 0 分。
- 基础设施失败终止执行并保留诊断，不能伪装成正常内容失败。
- case 最终断言不自动引用所有历史结果；需要跨轮比较时走消费者判据，未来再评审组合政策。

## 6. 资源与成本

每个配置 Judge 的实际评价点有一次逻辑批量裁定；每个 attempt 仍创建并清理独立会话，不共享主 Driver。未执行轮次不调用 Judge。

repeat 重建主执行与各评价点的 attempt，报告区分 target、case、repeat、turn 和最终评价位置。调用次数随实际评价点增加，不能宣称与只评最终回答等价成本。

分值不进入 Judge prompt；同源配置、live 批准、工具隔离和取消清理保持一期要求。

## 7. 报告与验收

报告至少保留轮次 id、作者树中的结构位置、执行顺序、评价位置、细项完整名、pass、reason、分值与累计总分；skipped 与评测错误单列，不混入正常评分。

未来零 token 测试覆盖：

- 第一轮、最后一轮和 case 最终评价读取各自正确文本。
- 同名局部 rubric 跨轮不碰撞，各细项只计一次。
- turn 与 case 同时声明时显式执行两次，调用数与分数一致。
- 默认继续、条件跳过、内容失败与评测错误分别归因。
- 默认 1／-1、单项覆盖、hit=0、显式 miss=0 及正总分仍失败。
- repeat、取消和资源清理不泄漏。

本文没有实现或真实成本测量；结果公共类型、逐轮调度接缝与报告字段需在正式规格／计划中确认，不直接改写现有 API。
