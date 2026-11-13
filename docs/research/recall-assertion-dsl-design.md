---
title: "第一阶段断言 DSL 作者体验调研与决策记录"
type: research
status: active
tags: [research, recall-assertion-dsl-design]
---

# 第一阶段断言 DSL 作者体验调研与决策记录

> 历史基线：`docs/recall-expect-decision-dsl`，`ff64e56`。
>
> 本文已按一期范围收缩重述：断言各自判断与计分，框架统一汇总，decision 移到未来。本文不是已实现契约；外部资料沿用既有调研，本轮未重新核验外部实现。

## 一、结论

1. **一期不需要 decision。** 机械判据与 AI rubric 只要产生具名的判断、原因和得分，就能进入同一汇总出口，不必先建立评分维度和引用表。
2. **分值就是直接加减分。** score 可选，默认 hit=1／miss=-1；命中配 3 就加 3，未命中不配默认扣 1，显式配置 miss=0 才不扣分。
3. **通过状态与总分分开。** 所有已声明断言通过，测试才通过。总分为正不抵消失败，显式 miss=0 也不把失败改成通过。
4. **保留小而清楚的作者接口。** case 级 expect、具名 Judge KV 与消费者注册判据足够；不再同时学习 dimensions、verdict／outcome 引用、隐式补维、threshold 和 knockout。
5. **判断不完整仍是错误。** 删除缺席计分不等于吞掉 Judge 漏项、超时和协议错误；这些是评测错误，不是内容零分。
6. **后续能力分别设计。** 条件场景本身合理，重要分支由多个 case 覆盖，模型方差由 repeat 观察；不因可能需要分支，就预先引入复杂评分语言。

## 二、一期作者接口

### 2.1 case 级 expect 与具名 Judge KV

```yaml
cases:
  - id: final-answer
    turns:
      - send: 先准备
      - send: 给出最终结论
    expect:
      judge:
        accurate:
          rubric: 最终结论是否准确
          score:
            hit: 3
        complete:
          rubric: 是否覆盖必要信息
          score:
            miss: -1
```

KV key 是断言身份和报告名称，不再另写维度名或结果引用。每个 rubric 自己带可选分值；分值不交给模型，只交给确定性计分。

内置 Judge 保留简写与带执行参数的完整形态，只评最后一轮文本。具体封闭字段、默认值与会话要求见 [一期规格](../spec/recall/recall-judge-dsl.md)。

### 2.2 机械判据继续注册，不另造机械匹配 DSL

消费者已有 Criterion 与通用判据工厂继续使用。机械输入保持原样透传，不为了统一计分给所有旧输入强加包装，也不抢占插件自己的 score 字段。

消费者可在自己的断言输入中支持同形 hit／miss 分值，并产出符合统一语义的判断与得分；不支持的配置须显式拒绝。框架统一结果和汇总规则，不枚举领域判据，也不把旧 decision 的 eq／one_of／from 迁移成另一套内置 DSL。

如果一个机械判据包含多个独立检查，需保留各细项的结果与计分，不能先压成一个总布尔再假称实现细项评分。其作者输入与具体证据仍由插件负责。

## 三、计分与通过状态

### 3.1 独立默认值

| 声明         | 通过得分 | 未通过得分 |
| ------------ | -------- | ---------- |
| 不写 score   | 1        | -1         |
| 只写 hit: 3  | 3        | -1         |
| 只写 miss: 0 | 1        | 0          |
| 只写 hit: 0  | 0        | -1         |

省略 score 等价于 `score: { hit: 1, miss: -1 }`；hit 与 miss 都是有限数，分别应用默认值；不再叠加 weight，不根据命中分值推导负分。

### 3.2 两个固定出口

```text
本项得分 = pass ? hit : miss
rawScore = Σ 本项得分
casePass = 所有已声明断言细项均通过
```

例如机械两项得 +1、-1，AI 两项得 +3、0（后一项显式 miss=0），总分为 3，但两项失败，所以测试未通过。

五项机械断言均采用 hit=0、miss=-1 时，一项失败得到 -1，两项失败得到 -2。AI 细项也可加入同一求和过程；机械与 AI 的整合已经完成，不需要 decision。

一期不需要分母、归一分或分数通过线。报告保留每项名称、来源、pass、reason、分值贡献和总分。

### 3.3 内容未通过与评测错误

- 回答未满足机械要求或 AI 明确判 false：内容未通过，按 miss 计分。
- 机械字段未输出或无法匹配：内容未通过，不猜测值。
- Judge 漏回必需裁定、判据未产出应有结果、调用或解析失败：评测错误，不生成正常评分。
- 不提供缺席状态、映射、分母排除、宽免及零覆盖门禁。

报告区分这些事实即可，不需要让作者配置第三态代数。

## 四、为何把 decision 移到未来

原方案把“得到判断”“为判断计分”“根据多项成绩决定是否通过”同时暴露在作者接口，产生了两张表：一张声明 rubric，另一张又引用它们并计分。

这带来不必要的学习和维护成本：

- 作者要维护断言名、维度名与引用关系。
- 未引用 rubric 的隐式参与让实际评分表不完整可见。
- OR、否决、阈值与缺席映射相互影响。
- 内部聚合结构反过来主导作者 DSL。

一期只有逐项判断与求和，不需要这些政策。未来真正需要“部分失败仍可过线”时，再按 [Decision 延后说明](../spec/recall/recall-judge-dsl.md#decision-分数验收政策) 重新论证。旧字段只是候选，不是保留成本的理由。

**【外部事实】**OpenAI Evals 将受约束裁定与 choice_scores 映射分开，说明“模型裁定、确定性计分”的分层可借鉴；它不要求本仓同时引入评分维度表。[Eval templates](https://github.com/openai/evals/blob/main/docs/eval-templates.md)

**【外部事实】**promptfoo 的断言属性支持分值、权重及组合政策，Inspect 支持多个 scorer 结果与 reducer。这些是可用的设计空间，不构成本仓一期必须开放全部字段的理由。来源见第六节。

## 五、后续能力与验证边界

- **Decision：**组合评分政策，不能隐式改变一期全通过规则。
- **[分类](../spec/future/recall-classification-pre-design.md)：**只产 choice，不自动计分或控制执行。
- **[条件分支](../spec/future/recall-conditional-branching-pre-design.md)：**读取已有结果执行作者内嵌的子步骤，结束后自然继续外层；通过 case 与 repeat 检查覆盖及稳定性。
- **[轮次级断言](../spec/recall/recall-turn-assertion.md)：**明确评价时机、结果身份与未执行轮次，不自动引入跨轮组合政策。
- **[提前终止](../spec/future/recall-early-termination-pre-design.md)：**独立记录停止原因，不能把未执行伪造为通过。
- **独立 Judge 选择与质量校准：**按实际需求设计，真实调用走显式 token 入口。

本轮未实现上述能力，也未重排代码实施计划。默认零 token 测试应验证作者配置到逐项结果与总分的接线；真实 Judge 质量仍需固定输出、人工标签和独立验收集。

## 六、证据来源（沿用既有调研）

### 本仓与用户指定的一手资料

1. `docs/spec/recall/recall-judge-dsl.md`：第一阶段断言直接计分、固定全通过规则、最后一轮边界与后续方向。
2. `docs/plans/2026-10-31-ai-assertion-complete-scenarios.md`：待重排的统一断言计分实施范围。
3. `docs/spec/scenario-dsl.md`：既有场景规则与可比性要求；后续条件执行不要求每次走相同路径。
4. `docs/spec/evaluation/scoring-aggregation.md`：既有通用聚合契约；其内部字段不等同于本次 Recall 作者计分接口。
5. 用户指定的跨仓 `recall-author/SKILL.md`：既有作者文档中的 KV 裁定池、声明即参与和历史评分草案；仅作设计证据，不要求源码引入其领域词汇。

### 外部一手资料（8 个）

1. **promptfoo 官方文档：Assertions & metrics。** 断言数组、`weight`、输出 `transform`、named metric 标签与 assertion-set threshold。
   https://promptfoo.dev/docs/configuration/expected-outputs/
2. **Inspect AI 官方文档：Standard Scorers。** `match / includes / pattern`、正则抽取、模型评分与 metrics 的职责。
   https://inspect.aisi.org.uk/scorers.html
3. **Inspect AI 官方文档：Multiple Scorers。** 字典形式的多值 Score、多 scorer reducer，以及保留/归并多个结果的区别。
   https://inspect.aisi.org.uk/multiple-scorers.html
4. **Inspect AI 官方文档：Scoring Policy。** scored、unscored、error、coverage 和失败来源的区分。
   https://inspect.aisi.org.uk/scoring-policy.html
5. **Inspect AI 官方文档：Solvers。** 执行计划与 scorer 分层、中间评分、根据评分继续以及 early termination。
   https://inspect.aisi.org.uk/solvers.html
6. **OpenAI Evals 官方源码仓库文档：Eval templates。** model-graded choice、无效输出、静态 `choice_scores` 与可解析裁定。
   https://github.com/openai/evals/blob/main/docs/eval-templates.md
7. **OpenAI Agents SDK 官方文档：Agent orchestration。** LLM 编排与代码编排、结构化分类后由代码选择下一步。
   https://openai.github.io/openai-agents-python/multi_agent/
8. **LangGraph 官方文档：Workflows and agents。** 预定代码路径的 workflow 与动态模型控制的 agent 的概念分界。
   https://docs.langchain.com/oss/python/langgraph/workflows-agents

补充外部事实：Inspect 的多 scorer 可以保留多个结果，也可用 reducer 合并；`collect` 保留单值列表，`mode` 等 reducer 得到单一结果。[Inspect：Reducing Multiple Scores](https://inspect.aisi.org.uk/multiple-scorers.html#reducing-multiple-scores) 对本仓的启示仅限于“逐维证据与最终归约是不同层次”，不是要求首版引入 reducer 注册表。

## 七、未验证范围

1. 未做真实作者对照实验；当前收缩依据是需求澄清与接口认知成本分析。
2. 尚未实现 score 配置、细项结果与统一汇总接线，不能把目标行为当成现有 API。
3. 未运行真实 provider 或校准 Judge 一致率、误判方向和翻转率。
4. 未实现分类、条件、逐轮断言或提前终止原型；未来字段不构成一期契约。
5. 未盘点仓库外旧 decision 草稿；本仓采用一期规格作为唯一当前目标。
