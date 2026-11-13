---
title: Recall 组合断言与计分
type: spec
status: active
tags: [spec, recall, assertions, scoring, composition]
---

# Recall 组合断言与计分

> 状态：组合原语、Recall DSL、诊断报告、repeat/suite 汇总和零 token 考卷已实现，完整 `pnpm check` 已通过；真实 token 验收待完成。实施与验收证据按第 10 节持续收口。
>
> 本文是 `allOf/anyOf/firstOf` 组合计分的唯一规格来源。旧 [有序择档文档](./recall-first-of.md) 仅保留迁移入口；普通平铺断言仍见 [Recall 断言计分](./recall-scoring.md)。

## 1. 目的与结论

在不认识任何具体被测系统、判据或宿主的前提下，为 Recall 增加三种通用组合评价点，并统一重复执行与整套考卷的统计口径：

| 组合 | 内容判定 | 有效贡献 |
| --- | --- | --- |
| `allOf` | 全部分支通过才通过 | 各分支实际贡献逐项求和 |
| `anyOf` | 任一分支通过即通过 | 通过分支中的最高实际贡献；全失败时只取一次共同 miss |
| `firstOf` | 按声明顺序接受首个实际贡献 `> 0` 的分支 | 被接受分支的实际贡献；未接受任何分支时只取一次共同 miss |

核心不变量：

1. **boolean 与贡献分离。** 判据或 Judge 只产生内容 boolean 与原始 0..1 score；组合按 hit/miss 计算 contribution。
2. **分值只有一个来源。** 组合评价点自身不接受 score；具体分支显式声明 score，或由其内部叶子提供分值，二者不得同时存在。
3. **正分不放行普通失败。** 外层普通断言与各组合仍按 boolean 决定 hardPass；rawScore 不能抵消其他失败。`firstOf` 的“贡献 > 0”只选择本组合接受哪一档，是明确列出的唯一例外。
4. **错误不是 miss。** 执行、裁定、解析、清理或结果形状错误沿 ERROR 通道上抛，不发布该 repeat 的正常 contribution、rawScore 或 hardPass。
5. **合法 skipped 不是失败。** 被 `firstOf` 合法短路的档位不生成裁定或贡献，不进入覆盖率分母。

本文不增加 Decision、threshold、weight、knockout、分类赋分、主任务重跑、模型或身份切换，也不改变主流程的线性 send。

## 2. 参考脱敏与采纳边界

本文只迁移通用评测机制，不复制来源项目名、包名、业务判据、工具名、内部路径、凭据、宿主配置或测试数据。示例统一使用答案质量、证据等抽象概念；实际机械判据仍由消费者 registry 显式注册。

### 2.1 本次采纳

- 最具体 rule/branch 的 hit/miss 及默认值 `1/-1`；`miss: 0` 可用于只观察、不惩罚的诊断项。
- `allOf` 逐项累计、`anyOf` 取通过候选最大值、`firstOf` 有序接受首个正贡献。
- `anyOf/firstOf` 的共同 miss 约束，避免数组顺序或候选数量隐式改变全失败惩罚。
- 分支未显式声明 score 时，采用其内部平铺条件的实际贡献之和；分支显式声明 score 时，以该分支为唯一计分单位。
- 每次 repeat 独立计分，不跨次累加；报告 pass rate、coverage、invalid rate、rawScore mean/min/max、`pass@k` 与 `pass^k`。
- suite 对 target × case 的统计做宏平均，避免轮次或重复次数更多的 case 隐式获得更高权重。

### 2.2 本仓适配差异

- 参考中的 `invalid` 在本仓继续表示为 **ERROR**，不扩展现有 `CriterionResult.pass/score/reason` 为三态或四态结果。
- 任一应有分支 ERROR 都使本次评价 ERROR；即使另一分支已通过或已失败，也不能吞掉错误并发布正常总分。
- 本规格的组合分支内部是平铺 AND 条件块；**一期不支持嵌套 `allOf/anyOf/firstOf`**。递归组合留待出现第二个明确消费者后另行设计，不预留无效 schema。
- 分支名在一期均为必填，用于稳定归因、共同 miss 诊断和报告；不要求消费者另维护第二张维度表。

### 2.3 暂不 bundled 的参考能力

显式 thread 块、主流程 if/then/else、命名故障 callback、`stop_after`、跨进程 usage 合并和报告指纹都有独立价值，但不属于组合计分前置。其中条件分支仍须先解决 [Scenario DSL 可比性](../scenario-dsl.md) 与 [条件分支预设计](../future/recall-conditional-branching-pre-design.md) 的冲突；不得借本轮计分改动悄然启用。

## 3. 作者 DSL

### 3.1 结构

三种组合都可出现在 `turn.expect` 与 `case.expect`，并与普通机械断言、平铺 Judge 并列：

```text
expect（外层 AND）
├─ <registered-criterion>       独立执行、独立计分
├─ judge.<name>                 独立执行、独立计分
├─ allOf.<point>                一个组合评价点
├─ anyOf.<point>                一个组合评价点
└─ firstOf.<point>              一个组合评价点
```

统一作者形状：

```yaml
expect:
  allOf:
    response_quality:
      - name: correctness
        score: { hit: 2, miss: -1 }
        expect:
          judge:
            correct:
              rubric: 答案是否准确回应问题
      - name: completeness
        score: { hit: 1, miss: 0 }
        expect:
          judge:
            complete:
              rubric: 答案是否覆盖题目要求的全部要点
  anyOf:
    acceptable_answer:
      - name: concise
        score: { hit: 1, miss: -1 }
        expect:
          judge:
            concise:
              rubric: 是否给出简洁且正确的答案
      - name: detailed
        score: { hit: 3, miss: -1 }
        expect:
          judge:
            detailed:
              rubric: 是否给出详细且正确的答案
  firstOf:
    quality_tier:
      - name: standard
        score: { hit: 3, miss: -1 }
        expect:
          judge:
            accurate:
              rubric: 是否准确
            complete:
              rubric: 是否完整
      - name: downgrade
        score: { hit: 1, miss: -1 }
        expect:
          judge:
            sufficient:
              rubric: 是否至少给出可用的核心答案
```

`turn.expect` 使用同一形状，在下一轮 send 前完成评价；`case.expect` 在全部轮次后评价。标准 Judge 仍只读当前轮或最后一轮文本，机械 session 判据能读取哪些证据由插件自身契约决定。

### 3.2 封闭校验

| 位置 | 规则 |
| --- | --- |
| `expect.allOf/anyOf/firstOf` | 非空普通 KV；point 非空、不含点号；与 judge、注册判据及其他组合并列 |
| `allOf` 分支数组 | 至少一项；按声明顺序全部执行 |
| `anyOf/firstOf` 分支数组 | 至少两项；数组顺序稳定，firstOf 据此短路 |
| 分支 | 封闭对象，仅 `name/score/expect`；name、expect 必填，score 可选 |
| 分支 name | 非空、不含点号，同一评价点内唯一 |
| 分支 expect | 非空平铺 AND 块；允许同 scope 注册判据和内置 Judge；不允许嵌套组合或 decision |
| 分支 score | 封闭 `{hit?, miss?}`，两侧均为有限 number；缺省侧分别为 1、-1 |
| `anyOf/firstOf` 共同 miss | 所有分支应用上述规则后的失败贡献必须一致，否则定义错误 |

所有分支，包括必然被跳过的 firstOf 后档，都必须在主 Driver 创建前完成结构、引用、scope、Judge、工厂和可静态确定的分值预检。未知机械插件的任意领域输入仍由插件自身负责，不能借组合名义宣称完成其静态验证。

`allOf/anyOf/firstOf`、其 point 前缀和内部编译键均为保留名。与历史注册判据冲突时必须在主执行前显式拒绝，不得静默改用内置语义。

### 3.3 分值唯一来源

每个分支只可选择一种计分方式：

1. **分支显式 score**：整个平铺 AND 块作为一个原子计分单位。其内部 Judge rubric 不允许再声明 score；机械 resolver 仍预检输入，但子项不独立贡献。
2. **分支省略 score**：内部每个平铺条件分别按自己的 score 或默认 1/-1 计算实际贡献，分支贡献为这些细项之和。此时 Judge rubric 可以声明 score，机械判据仍须通过现有 `assertionScore` resolver 显式 opt-in。

设分支内部条件结果为 `p_i`，对应分值为 `s_i`：

```text
leafContribution_i = p_i ? s_i.hit : s_i.miss
branchPass         = AND(p_i)
branchScore        = branchPass ? 1 : 0
branchContribution = 显式分支 score
                       ? (branchPass ? score.hit : score.miss)
                       : sum(leafContribution_i)
```

分支的 `miss` 用于 `anyOf/firstOf` 共同 miss 校验：显式分支取 `score.miss ?? -1`；省略 score 的分支取其内部全部叶子均失败时的 miss 之和。机械分值在 target 装配后才能确定时，共同 miss 也在同一预检阶段校验，不延后到内容执行中猜测。

省略分支 score 的多条件 firstOf 档位因此不再等价于固定 +1/-1，而是真实反映内部各条件贡献。这是本轮有意的行为迁移。

## 4. 三种组合的正式规则

### 4.1 allOf：逐项收集

- 按声明顺序执行全部分支；普通内容 false 不短路，确保每个必需项都有诊断和贡献。
- 全部分支 pass 时组合 pass；任一分支 fail 时组合 fail。
- 组合 contribution 为所有分支实际贡献之和，不丢弃未通过项的 miss，也不把多个子项压成一个固定分。
- 任一执行错误立即转为 ERROR；尚未执行的分支标记 `skipped(error)`，不发布正常组合贡献。

```text
pass         = every(branch.pass)
score        = pass ? 1 : 0
contribution = sum(branch.contribution)
```

例：两个分支分别配置 `{hit:2, miss:-1}` 与 `{hit:3, miss:-1}`，均通过时贡献 +5；前者失败、后者通过时贡献 +2，但组合仍 FAIL。

### 4.2 anyOf：取最优通过候选

- 按声明顺序求值全部候选。多个候选可能同时通过，为确定最高贡献，普通内容 pass 不提前短路。
- 任一候选 pass 即组合 pass；在通过候选中取最大实际 contribution，不累加，也不计入失败候选的 miss。
- 最大值并列时选择声明序最早者作为报告中的 accepted，数值不受并列影响。
- 全部候选 fail 时组合 fail，只贡献一次共同 miss；不得逐候选累计 miss。
- 任一候选 ERROR 时整体 ERROR，不用另一个 pass 或 fail 隐藏错误。

```text
pass         = some(branch.pass)
score        = pass ? 1 : 0
contribution = pass
                 ? max(branch.contribution for passingBranches)
                 : commonMiss(branches)
accepted     = pass ? firstIndexOfMaxContribution : null
```

例：简洁正确档 hit=1、详细正确档 hit=3，两者同时通过时只取 +3；均失败且共同 miss=-1 时只取 -1。

`anyOf` 的通过不要求贡献为正：hit=0 或负 hit 的候选仍可形成内容 PASS，其数值如实报告。只有 firstOf 使用正贡献作为择档条件。

### 4.3 firstOf：首个正贡献

对分支按声明顺序执行：

```text
for branch in declarationOrder:
    evaluate branch
    ERROR ? stop : contribution > 0 ? accept(branch) : continue
no accepted branch ? fail(commonMiss)
```

- 接受首个实际贡献 **严格大于 0** 的分支，不是 `>= 0`，也不是遍历后选最高分。
- 被接受后，后档真正不执行并标记 `skipped(accepted-earlier)`。
- 前档原始 pass=true 但 hit=0 或负 hit 时，只保留诊断，不抢占档位，继续执行后档。
- 算法直接作用于实际贡献，因此分支原始 pass=false 但 miss>0 时也可能被接受；作者不希望正 miss 触发接受时必须配置非正 miss。框架不额外偷加“raw pass 必须 true”的隐藏条件。
- 未接受任何分支时组合 FAIL，只贡献一次共同 miss；不能把所有已尝试档位的 miss 连加。
- ERROR 不触发降级；后档标记 `skipped(error)`，不生成正常组合贡献。

| 标准档结果与贡献 | 降级档结果与贡献 | 组合结果 |
| --- | --- | --- |
| pass / +3 | skipped | PASS，accepted=standard，+3 |
| fail / -1 | pass / +1 | PASS，accepted=downgrade，+1 |
| pass / 0 | pass / +1 | PASS，accepted=downgrade，+1 |
| fail / -1 | fail / -1 | FAIL，accepted=null，共同 miss -1 |
| ERROR | skipped(error) | ERROR，无正常贡献 |

## 5. 外层关系、错误与覆盖率

### 5.1 外层 AND 不变

组合只接管显式收进 `allOf/anyOf/firstOf.<point>` 的条件，不包住整个 expect：

- 普通机械断言、平铺 Judge 和每个组合评价点仍是独立顶层断言。
- 一个 anyOf 命中或 firstOf 接受档位，不跳过其他组合或普通断言。
- hardPass 为全部顶层断言 boolean 的 AND；rawScore 为全部顶层有效 contribution 之和。
- 组合内部原始 false 保留在诊断树，不摊平为额外套层必过项，也不重复计分。

```text
hardPass = AND(普通断言.pass, 各组合.pass)
rawScore = sum(普通断言.contribution, 各组合.contribution)
```

### 5.2 ERROR 映射与优先级

以下情况均为 ERROR，不是普通 miss、skipped 或 0 分：

- 超时、abort、传输、认证、协议、解析或清理失败；
- 必需裁定缺失、absent、非 boolean pass、非法 reason/score/contribution；
- 已声明分支应执行但没有完整结果；
- 组合诊断或通知失败导致无法可靠记录结论。

fail 与 ERROR 同时出现时，保留已确定的内容失败作诊断，但该 repeat 仍按 ERROR 终止，不发布正常 hardPass/rawScore。定义错误保持 CLI=2，执行或清理错误保持 CLI=1，内容 FAIL 保持 CLI=0。

### 5.3 skipped 与覆盖率

- `accepted-earlier` 是合法短路，不是 fail、ERROR 或 invalid。
- skipped 分支没有 verdict、pass、score 或 contribution，不进入组合的有效分支覆盖率分母。
- 顶层 `assertions=通过数/总数` 只统计有效顶层断言；一个组合算一项，不随内部条件或尝试档数膨胀。
- repeat 的 coverage 另按有效 repeat / 计划 repeat 统计；二者不是同一个分母。

## 6. 诊断与报告

每个组合评价点记录：kind、作者名、scope、turnIndex（如有）、status、accepted、commonMiss（适用时）及分支数组。每个已执行分支至少记录：

- 声明序号、name、status、原始 pass/score/reason；
- 实际 contribution，以及分值来自分支还是内部叶子；
- 内部机械结果与 Judge 原始裁定、逻辑批次和清理信息；
- 后档 skipped 及原因，不伪造未执行裁定。

报告必须能独立解释“为什么 allOf 是这个总和、anyOf 为什么只取一项、firstOf 为什么接受或继续”，不能只保留最终 rawScore。

正常 repeat 报告包含每个顶层断言的贡献与每个组合的诊断树。ERROR 时仅写诊断报告和已完成局部事实，不构造正常 ScenarioResult，不为部分结果求总分。既有脱敏、文件权限、资源清理和主/Judge usage 归因保持不变。

## 7. repeat 与 suite 汇总

### 7.1 单 case 的 repeat 统计

每次 repeat 独立计算 hardPass 与 rawScore，不把贡献跨次连加。正常完成但内容 FAIL 的 repeat 是有效 repeat；ERROR repeat 是 invalid，合法 skipped 不属于 invalid。

建议公开统计形状如下，字段值只允许有限 number 或 null：

```ts
interface RecallRepeatScoreSummary {
  readonly planned: number;
  readonly valid: number;
  readonly invalid: number;
  readonly skipped: number;
  readonly coverage: number;
  readonly invalidRate: number;
  readonly passRate: number | null;
  readonly rawScore: {
    readonly mean: number;
    readonly min: number;
    readonly max: number;
  } | null;
  readonly passAtK: boolean | null;
  readonly passAllK: boolean | null;
}
```

口径：

```text
coverage   = valid / planned
invalidRate = invalid / planned
passRate   = 有效且 hardPass 的 repeat 数 / valid
rawScore.* = 各有效 repeat rawScore 的 mean/min/max
passAtK    = 任一有效 repeat hardPass
passAllK   = valid === planned 且全部 repeat hardPass
```

- `valid + invalid + skipped = planned`；ERROR 后未执行的剩余 repeat 记 skipped。
- 没有有效 repeat 时，passRate、passAtK、rawScore 为 null；passAllK=false，不制造 0 分或“每次均成功”。
- 有有效 repeat 但均未声明断言时，行为统计仍可计算，rawScore=null；不能虚构 rawScore=0。
- `passAtK` 与 `passAllK` 分开报告，不能用其中一个替代另一个。

### 7.2 suite 宏平均

suite 的统计单位是 target × case，不是把所有 repeat 直接拼接：

```text
casePassRate_i = 第 i 个有效 case 的 passRate
caseScore_i    = 第 i 个有效 case 的 rawScore.mean

suitePassRate   = mean(casePassRate_i)
suiteRawScore   = mean(caseScore_i)
suiteCoverage   = 有效 case 数 / 计划 case 数
suiteInvalidRate = invalid case 数 / 计划 case 数
```

- 每个 case 先独立汇总 repeat，再做宏平均；不得跨 case 按 trial 数加权。
- 没有可用行为或分数统计时对应 suite 值为 null；coverage 与 invalidRate 仍必须披露。
- `pass@k`、`pass^k` 同时保留 case 级布尔与 suite 级宏平均比例，不能用总 rawScore 推断。
- 不同评分配置、rubric 或断言集合的 rawScore 尺度仍不可直接横比。

实现公开字段与本文名称对应如下：`artifact.scoreSummary` 与 `RecallCaseRun.score` 使用 `RecallRepeatScoreSummary`；`RecallRunResult.summary` 使用 `RecallSuiteScoreSummary`，其中 `rawScore` 是各有效 case 的 `rawScore.mean` 的宏平均值或 null，而不是再包一层统计对象。含 ERROR 的 case 整体记为 invalid，不进入 suite 行为或分数宏平均；`RecallInfraFailure.scoreSummary` 只披露已完成 repeat 的局部统计与 invalid/skipped 计数。

## 8. 公开 seam 与实施分工

已确认的测试 seam 与公开能力一致：

1. **Assertions 公共入口**：`evaluateAllOf`、`evaluateAnyOf`、`evaluateFirstOf` 及对应只读结果类型。原语接收已准备的懒执行分支，不读 YAML、不创建 Driver、不解释判据名。
2. **Recall 装载与编译**：从落盘 YAML 经 `loadRecall` 检查三种组合、严格 schema、引用与保留名。
3. **Recall 公开执行与 CLI**：经 `runRecall` 和官方 `recall` 命令验证真实求值、短路、贡献、诊断、退出码、repeat/suite 汇总及清理。

实现复用现有 Runner、Observation、runCriteria、Judge、assertionScore resolver 和报告安全写盘核心。组合只编译为普通 Criterion，不建立第二套主任务执行引擎，不扩展 ScenarioSpec 控制流。

## 9. 迁移影响

- 新增 allOf/anyOf 保留名；重名注册判据必须先迁移，不能静默换含义。
- firstOf 从“首个 raw pass”改为“首个实际贡献 > 0”；既有 hit=0 或负 hit 考卷的后档调用次数、accepted 与 hardPass 可能变化。
- firstOf 分支省略 score 且内部有多个条件时，从固定默认贡献改为内部实际贡献之和；需要旧尺度的作者应显式声明分支 score。
- 未使用新组合、且 firstOf 所有分支均为正 hit、非正 miss、显式 score 或单内部条件的考卷，数值与短路行为保持不变。
- 通用 `CriterionOutcome.score` 的 0..1 标准分、普通平铺断言、evidence.allOf、TargetTags anyOf 和通用 resolveAggregate 均不改变语义；同名操作符所在层级必须在文档与诊断中明确。

## 10. 验收与收口

### 10.1 零 token 默认回归

按公开 seam 做垂直切片，先写失败测试再实现：

1. **allOf**：全过、部分失败、不同 hit/miss 求和、miss=0、错误不吞掉、未执行 skipped。
2. **anyOf**：单候选通过、多个通过取最高、同分按声明序、全失败共同 miss、失败不累计、pass+ERROR 仍 ERROR。
3. **firstOf**：首个正贡献、hit=0 继续、负 hit 继续、正 miss 的明确算例、共同 miss、合法短路零后档请求、ERROR 不降级。
4. **分值来源**：显式分支 score 与内部叶子 score 互斥；缺省分支按内部实际贡献；机械 resolver 默认、opt-in、缓存和共同 miss 预检。
5. **Recall DSL**：turn/case、严格 schema、保留名、未注册引用、所有后档预检、外层兄弟不被短路。
6. **报告**：原始分支 false 与组合结论并存、唯一有效贡献、rawScore、hardPass、ERROR 无正常总分、脱敏和清理。
7. **repeat/suite**：有效/invalid/skipped、null 而非 0、mean/min/max、pass@k 与 pass^k、case 宏平均、无断言 rawScore=null。
8. **兼容性**：普通平铺计分、evidence、TargetTags、通用 aggregate 及未使用新能力的旧考卷回归不变。

默认收口命令为 `pnpm check`；另运行精确的组合计分测试与可执行文档示例。任何 CLI=0 都不能替代对 accepted、贡献、rawScore、hardPass 和实际调用序列的逐项核对。

### 10.2 可运行考卷与真实 token 验收

在 `integrations/itrepos/recall-scoring/composition/` 提供独立合成考卷，覆盖三种组合、多命中取最高、hit=0 继续降级、内部叶子计分、并列普通断言和 repeat 汇总。同步 README、预期报告、默认零 token 配置回归和精确入口：

```bash
pnpm ittest:token:recall-composition-scoring
```

真实验收执行前必须另行取得 target、范围、调用预算和费用授权。只能选择一个已批准 target，经公开 Recall 入口核对真实主输出、Judge 原始裁定、分支调用、唯一贡献、报告、usage 和清理；fake、schema 成功、历史 token 回执或 CLI 退出 0 均不能替代本次证据。

未获授权时只能标记“实现完成，真实验收待完成”，不得宣称功能完整验收。
