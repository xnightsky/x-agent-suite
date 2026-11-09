---
title: Recall 分类预设计
type: pre-design
status: future
tags: [recall, classification]
---

# Recall 分类预设计

> 状态：未来预设计，尚未实现，不进入一期。本文只规定受约束分类，不定义跳转、停止或组合评分。
>
> 一期 boolean rubric 与可选 score 的默认值仍为 `{hit: 1, miss: -1}`；分类不是 boolean 断言，不因选中某类自动加减分。

## 1. 目的与职责

让 Judge 从作者声明的有限类别中选一个，回答“当前输出属于哪一类”。分类只产生结果，不选择子步骤、不控制提前终止，也不直接决定测试通过。

相关但独立的能力：

- [条件分支](./recall-conditional-branching-pre-design.md) 读取分类并选择作者写好的内嵌子步骤，完成后继续外层。
- [轮次级断言](../recall-turn-assertion.md) 决定在哪一轮产生结果。
- [Decision](./recall-decision-pre-design.md) 仅记录未来按分数放行的独立需求，不参与分类或逐项计分。

## 2. 作者形状

```yaml
# PRE-DESIGN ONLY
expect:
  judge:
    route:
      choices:
        answer: 已经给出可执行答案
        clarify: 正在请求补充信息
        refuse: 明确拒绝
      else: other

    grounded:
      rubric: 是否引用本轮证据
      score:
        hit: 3
```

分类与 boolean rubric 可以放在同一具名 Judge KV 中，不另建 classifier 根或注册表。完整执行参数仍位于 judge.rubrics 外层。

## 3. 字段与校验

每个 Judge 项只能选择一种形状：

| 形状           | 字段                 | 结果                              |
| -------------- | -------------------- | --------------------------------- |
| boolean rubric | rubric，及可选 score | pass=true／false，按 score 计分。 |
| 分类           | choices 与必填 else  | 一个 choice，不自动计分。         |

- choices 是至少一项的 KV：key 为类别名，value 为非空判断说明。
- else 是非空类别名，代表所有显式类别均不适合；不得与 choices 中的名称重复。
- 类别名不含点号、空白或等号，供稳定引用；匹配区分大小写。
- 重复 YAML key、空说明、rubric 与 choices 混用、分类项声明 score 或未知字段均拒绝。
- choices 的声明顺序用于展示，不是分类优先级；类别含义应由作者写清楚，不由框架猜测重叠语义。

else 不是错误恢复入口，不应把任何解析失败都塞进 other。

## 4. 逻辑结果与协议要求

建议的逻辑结果：

```json
{
  "route": { "choice": "clarify", "reason": "正在请求补充必要信息" },
  "grounded": { "pass": true, "reason": "引用了本轮给出的证据" }
}
```

- 分类项必须返回一个 choice，trim 后精确匹配某个 choices key 或 else 名。
- 显式返回 other 是合法兜底分类，不代表内容失败。
- 未知类别、多选、缺项、空值或非字符串 choice 是评测错误，不回退 else。
- boolean 与分类的结果字段必须区分，不能把字符串类别塞进 pass。
- 现有 Judge 协议的扩展与版本需在正式规格确认；本 JSON 是未来逻辑结果示例，不宣称现有 parser 已支持。

## 5. 输入、执行与计分

- 仍只评配置位置对应的单轮文本，不暗读历史、文件或工具状态。
- 同一评价点的 boolean 与分类可批量裁定，保留每项独立结果。
- 分类项不进入断言分数求和或全通过判断；其结果完整性仍必须校验。
- 如果要考“应当选 clarify”，由消费者注册的确定性判据产生 boolean 并按默认 1／-1 或显式分值计分。
- 单独只有分类而没有断言时，不把“成功分类”当作被测任务已通过。
- 独立会话、批准、超时、取消与清理复用标准 Judge 要求，不增加 fallback 路径。

## 6. 报告与错误

报告至少保留分类项名、评价轮次、choice、reason、合法类别列表及是否命中 else。不要把 choice 当作分数或擅自展示 PASS。

| 场景                               | 语义                                |
| ---------------------------------- | ----------------------------------- |
| 合法显式类别或 else                | 分类完成，供后续固定规则读取。      |
| 未知类别、非法结构、缺项、调用失败 | 评测错误，CLI=1，不默认跳任何分支。 |
| choices／else 结构非法、字段冲突   | 定义错误，CLI=2，主 Driver 前拒绝。 |

## 7. 验收与未验证范围

未来零 token 测试覆盖：显式类别、else、混合 boolean／分类批量响应、大小写与空白、未知类别、多选、缺项、字段冲突、评分参数不进入 prompt、分类不自动计分。

真实质量单独测量：固定输出与人工分类标签、混淆矩阵、else 比例、重复裁定翻转率及类别说明重叠。本文未做原型、真实调用或质量校准。

## 8. 分类与评级

分类没有内建质量顺序：合理澄清或拒绝也可能是正确行为，choices 不自动赋分。

不能自然拆成独立 boolean 效果时，才另议“模型选有限等级、代码映射分值”；等级须有互斥锚点，合格规则与分值分开，非法结果不能算最低档，也不能与同义细项双算。取舍和校准依据见 [补充调研](../../research/recall-effect-scoring-policy.md)。评级不作为 Decision 前置，本专题不预留评级字段或协议。
