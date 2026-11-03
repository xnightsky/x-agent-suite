---
title: Recall Decision 预设计
type: pre-design
status: future
tags: [recall, decision]
---

# Recall Decision 预设计

> 状态：未来预设计，尚未实现，不属于一期。下文给出可评审的字段、算法与错误语义草案，不代表现有公开 API。
>
> 一期仍以 [内置 Judge 与断言计分 DSL](../recall-judge-dsl.md) 为准：score 可选，默认 `{hit: 1, miss: -1}`；逐项判断与计分，全部断言通过才通过。

## 1. 目的与非目标

Decision 解决“已经有一组判断，如何按组合政策决定最终结果”，不重新执行断言，不负责 AI 裁定或机械匹配。

未来确有以下需求时使用：

- 允许部分断言失败，但组合成绩达到通过线。
- 多个等价证据任一成立即可。
- 某项必须通过，其余项允许分数补偿。
- 对已执行阶段的结果给出一个可审计的派生成绩。

不把机械与 AI 的统一计分当作引入 Decision 的理由；不新增自然语言猜分、任意脚本表达式或缺席映射。

## 2. 作者形状

```yaml
# PRE-DESIGN ONLY：不是一期 DSL
expect:
  artifact-valid: {}
  judge:
    accurate:
      rubric: 回答是否准确
    concise:
      rubric: 回答是否简洁
    polite:
      rubric: 回答是否礼貌

  decision:
    threshold: 2
    dimensions:
      accuracy:
        verdict: judge.accurate
        score:
          hit: 3
      artifact:
        outcome: artifact-valid
        knockout: true
      style:
        verdict: [judge.concise, judge.polite]
```

artifact-valid 是消费者注册判据。dimensions 的 key 是组合维度名，不覆盖原始断言名。所有字面匹配仍由机械判据完成，不在 decision 中另造 eq／one_of／from 抽取器。

## 3. 字段与默认值

### decision 对象

| 字段       | 规则                                                                             |
| ---------- | -------------------------------------------------------------------------------- |
| dimensions | 必填非空 KV；顺序用于报告展示。                                                  |
| threshold  | 可选有限数，作用于本次 Decision 的原始总分，不是归一分；省略时要求所有维度通过。 |

### 每个维度

| 字段     | 规则                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| verdict  | 一个 judge.<name> 引用或非空引用数组，只引用 boolean AI 裁定。                      |
| outcome  | 一个注册判据结果名或非空引用数组，引用机械／其他 Criterion 的 boolean 结果。        |
| score    | 可选封闭对象，默认 `{hit: 1, miss: -1}`，hit／miss 分别独立应用默认值，均为有限数。 |
| knockout | 可选 boolean，默认 false；该维度未通过则最终不得通过。                              |

verdict 与 outcome 必须恰好选一个；数组统一表示 OR。第一版不增加嵌套 AND／OR／NOT；需要多个要求同时成立时拆成维度，在不设 threshold 的政策下要求全过。

维度名、rubric 名和机械结果名须非空；用于点号引用的单段名称不含点号。重复 YAML key、重复维度名、空引用数组与数组内重复引用均拒绝。

## 4. 结果引用与组合

- 单项引用直接读取来源 boolean，不根据来源分数反推是否通过。
- 数组引用在所有必需来源结果有效后做 OR：任一 true 则 true，否则 false。
- 编译时未知 rubric／判据引用是定义错误，主 Driver 前拒绝。
- 运行时已声明来源没有产出有效结果，属于评测错误；不能按 miss、0 分或宽免处理。
- OR 中即使有一项 true，也不吞掉其他必需来源的评测错误。
- 未被 dimensions 引用的断言仍保留原始结果，不自动补成隐式维度。
- 同一来源可以服务不同明确声明的组合维度；报告须展示各引用，不能隐藏重复利用。

分类的 choice 不是 boolean，不能直接放进 verdict。可先由注册的确定性判据判断分类是否符合要求，再通过 outcome 引用；不因此增加一门比较表达式语言。

## 5. 两层分数不得混算

一期的原始断言得分是事实明细；Decision 的组合维度得分是派生政策：

- 断言自己的 score 只计算该断言的得分。
- 维度自己的 score 只计算该组合维度的得分，不继承、覆盖或修改来源断言的 score。
- 不把两层分数相加，也不要求作者把同一配置复制到两处。
- 不需要组合赋分时，维度省略 score，使用统一默认 1／-1。
- 报告将原始断言总分与 Decision 总分分开，名称、分值来源均可追溯。

这是未来组合政策的额外能力，不应反向增加一期作者必须理解的概念。

## 6. 固定算法与通过条件

先完成执行和断言，校验所有必需结果，再进行纯计算：

```text
dimensionPass = 单项 boolean，或数组 OR
dimensionPoints = dimensionPass ? hit : miss
decision.rawScore = Σ dimensionPoints

若任一 knockout 维度为 false：
  decision.pass = false
否则若声明 threshold：
  decision.pass = decision.rawScore >= threshold
否则：
  decision.pass = 所有维度为 true
```

不计算分母、maxScore 或归一分，不增加 coverage 门禁。显式低 threshold 可能允许多项失败甚至负分通过，这是作者声明的政策，报告必须如实呈现，不能悄悄提高通过线。

没有 decision 时保持一期全断言通过规则；显式声明 decision 时，其合法政策可允许“原始断言有失败但最终通过”。原始失败项仍须保留，不能改写为通过。

执行／评测错误永远不由 threshold 或 knockout 转成内容通过；如果 [提前终止](./recall-early-termination-pre-design.md) 已因 onFail:stop 判定本次失败，Decision 也不能将其洗成成功。

## 7. 算例

使用第 2 节配置，accuracy 的 hit=3、miss=-1，另两维默认 1／-1：

| accuracy | artifact | style 的两个来源 | Decision 总分   | 结果                                            |
| -------- | -------- | ---------------- | --------------- | ----------------------------------------------- |
| true     | true     | false／false     | 3 + 1 - 1 = 3   | 达到 threshold=2，通过；原始 style 失败仍保留。 |
| true     | false    | true／false      | 3 - 1 + 1 = 3   | artifact 否决，未通过。                         |
| false    | true     | false／false     | -1 + 1 - 1 = -1 | 未达到通过线。                                  |

省略 threshold 时，第一行也未通过，因为 style=false。只将 accuracy 的 hit 改为 5，不会把 miss 自动改成 -5；只配 miss=0 时 hit 仍为 1。

## 8. 报告与错误

报告至少分开记录：

- 原始断言：来源名、boolean、reason、配置分值与本项贡献。
- 组合维度：维度名、引用来源、OR 结果、score、贡献、knockout。
- Decision：原始总分、是否配置 threshold、最终结果与否决／不过线原因。
- Case：执行结果、提前终止原因与实际采用的一期／Decision 通过政策。

| 场景                                       | 语义                                  |
| ------------------------------------------ | ------------------------------------- |
| 合法政策未通过                             | 内容结果，CLI=0，报告 pass=false。    |
| 缺必需来源、来源无效、断言评测失败         | 评测错误，CLI=1，不输出正常组合成绩。 |
| 空维度表、双来源、未知引用、非法分值或字段 | 定义错误，CLI=2，主 Driver 前拒绝。   |

## 9. 与其他预设计的接缝

- [分类](./recall-classification-pre-design.md) 产 choice，不直接产分。
- [条件分支](./recall-conditional-branching-pre-design.md) 只读作用域内已产生结果，执行内嵌子序列后继续外层；不读取尚未计算的 Decision 总分。
- [轮次级断言](./recall-turn-assertion-pre-design.md) 使用 turn.<id>.judge.<name> 等稳定名称保留原始细项。
- Decision 引用未执行轮次的结果时报评测错误，不把未走分支伪造为 0 分；作者应引用共同必经结果或另行拆 case。
- when 的条件可见性仍按结构化分支作用域在加载期校验；Decision 的跨轮引用能力不授权条件读取兄弟分支或未来节点。
- 现有 [通用聚合机](../scoring-aggregation.md) 保持原行为，未来接线由独立实施计划确认。

## 10. 验收与未验证范围

未来零 token 测试至少覆盖：

- 缺省 score、部分覆盖、显式 0、负分、有限数与空维度校验。
- 单项引用、数组 OR、未知引用、缺项及错误不能被 OR 吞掉。
- 原始断言与派生维度分数不混算，不产生隐式补维。
- 第 7 节算例、无 threshold 全过、低 threshold 的显式政策与 knockout 优先。
- Case 实际采用的通过政策、原始失败项及提前终止原因均可追溯。
- 跨轮引用与未执行结果错误，且不重新调用 Judge／Driver。

本文没有实现、真实 token 验证或契约发布。字段与算法是可评审草案；是否引入两层分数、以及具体报告字段须在未来正式规格中确认，不能直接按本预设计修改源码。
