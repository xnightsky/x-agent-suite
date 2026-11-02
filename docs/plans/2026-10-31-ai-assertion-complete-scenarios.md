# 内置 Judge 与统一断言计分实施范围

> 状态：待重排，尚未执行。本文按已确认的一期收缩同步目标与验收；下列任务是重排依据，不是已交付记录，也不授权本轮修改代码。
>
> 旧 decision、精确评分维、阈值与否决的实施步骤已移出一期；未来组合政策见 [Decision 预设计](../research/recall-decision-pre-design.md)。

## 目标与架构

一期从 case 级 expect 声明出发，保留每个机械判断和 AI rubric 的具名结果，按各断言自己的 hit／miss 分值直接计分并求和。全部已声明断言通过才通过，总分不改变 boolean 结果。

标准 Judge 只评最后一轮文本，默认复用主执行同源配置，每次 attempt 使用独立 backend／Driver。机械判断继续通过消费者注册 Criterion，不新增另一套匹配 DSL。

规格以 [Recall 内置 Judge 与断言计分 DSL](../spec/recall-judge-dsl.md) 为准；测试分层见 [testing.md](../spec/testing.md)。现有通用聚合契约保持独立，不因本文提前改写。

## 一期作者接口

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
          rubric: 是否说明归 author 侧
          score:
            hit: 3
        polite:
          rubric: 措辞是否礼貌
        concise:
          rubric: 是否简洁
```

output-shape 是消费者注册判据，示例输入由插件解释，既有输入仍原样透传；不把 score 强加给所有历史自定义输入。judge 每个 rubric 的 score 属内置作者接口。

## 固定规则

- score 是可选字段；省略时等价于 score: {hit:1, miss:-1}，hit 与 miss 分别独立应用默认值。
- 命中配 3 就加 3；miss 不配默认扣 1，显式配 0 才不扣分；hit=0 可只累计失败扣分。
- 分值均为有限数；一期不做 weight、分母排除、maxScore、归一分或分数通过线。
- rawScore 为所有断言细项得分之和；测试通过要求所有已声明断言细项通过。
- 每个机械结果和每个 AI rubric 计分一次，不存在结果引用表或隐式补维。
- 正总分不能抵消失败，显式 miss=0 不能把未通过变成通过。
- Judge 裁定缺项、判据结果缺失与整体执行／解析失败是评测错误，不生成正常评分。
- 默认测试零网络、零 token；真实 provider 只走显式 token 入口。

## Task 1：作者 schema 与编译

候选落点：recall 的 schema、compile、registry 及相应单元测试。具体文件与类型在正式实施计划中确认。

- [ ] 先写失败测试：case 级 judge 简写／完整形态、rubric 可选 score、独立默认值与非法分值。
- [ ] 重复 YAML key、未知 rubric 字段、保留键与非法执行参数在主 Driver 前拒绝。
- [ ] 旧 expect.decision 不作为一期内置能力接受。
- [ ] 只把最终文本交给内置 Judge；score 配置不进入 Judge prompt。
- [ ] 自定义判据继续注册、装配并接收原始输入，不强制包装旧输入。

## Task 2：细项结果与统一计分

候选落点：assertions、recall 的结果适配及报告接线；公共契约是否需要调整由正式计划确认，本轮不改实现。

- [ ] 先写失败测试，验证机械细项与 AI rubric 都保留独立名称、pass、reason 与得分。
- [ ] 省略 score 或空对象得到 1／-1；只配 hit=3 时 miss 仍为 -1；只配 miss=0 时 hit 仍为 1。
- [ ] 五项机械检查采用 hit=0、miss=-1，一项失败 -1，两项失败 -2。
- [ ] 机械与 AI 细项进入同一求和出口；每项只计一次。
- [ ] 总分为正但有断言失败时测试仍未通过；显式 miss=0 时失败状态不变。
- [ ] 缺少应有结果时报评测错误，不能以默认零分掩盖。
- [ ] 既有独立 Assertions 与通用聚合使用方式保持兼容。

## Task 3：标准 Judge 装配与隔离

候选落点：recall 的 Judge 装配、通用工厂接线与 judge 生命周期测试。

- [ ] 同源 target／config／tags／live 批准、mode 与 transport 正确到达。
- [ ] borrowed 使用独立单轮 spec、effects:none 和空执行参数，不继承主工作区或工具权限。
- [ ] 同步／异步 profile 工厂、取消、迟到 Driver 与 finally close 均有测试。
- [ ] 装配阶段无 transport 与 Driver 调用；实际 attempt 才创建资源。
- [ ] 无 expect.judge 时不增加 Judge 调用。

## Task 4：官方 CLI 完整场景

候选测试：recall-judge-assertion.test.ts 与 recall-assertion-scoring.test.ts；名称与数量待正式计划确认，不沿用旧 decision 场景计数。

- [ ] 非法 DSL：CLI=2，主执行与 Judge 均无调用。
- [ ] 全部通过、机械失败、AI 单项失败均保留细项证据。
- [ ] 多轮准备答案不进入 Judge；最后文本与完整 rubric 到达。
- [ ] 默认 1／-1、命中加 3、未命中默认扣 1、显式 miss=0 及只累计失败扣分均有固定算例。
- [ ] 正总分但存在失败项：CLI=0，报告测试未通过。
- [ ] 裁定缺项、超时、调用与解析错误：CLI=1，不输出正常评分结论。
- [ ] 独立会话、repeat 创建与清理、敏感信息脱敏正确。

## Task 5：文档与正式收口

- [ ] 一期文档只描述断言直接计分、总分求和与固定全通过，不再要求 decision、dimensions、结果引用、OR 组合、threshold 或 knockout。
- [ ] Decision 候选政策只留在未来预设计，不出现在一期验收代码中。
- [ ] 实现后再登记实际类型、文件与测试证据；不把目标示例当作已支持 API。
- [ ] 先运行相关包的零 token 回归，再执行 pnpm check、pnpm format:check 与 git diff --check。
- [ ] 真实调用、Judge 质量校准和消费者迁移分别报告，不以默认 fake 回归代替。

## 后续入口

- Decision：确有部分失败仍可通过、组合证据或否决需求时再设计。
- 后续能力分别见 [分类](../research/recall-classification-pre-design.md)、[条件分支](../research/recall-conditional-branching-pre-design.md)、[轮次级断言](../research/recall-turn-assertion-pre-design.md) 与 [提前终止](../research/recall-early-termination-pre-design.md)；条件分支采用树形内嵌步骤与自然汇合，均不依赖 decision，重要分支由多个 case 覆盖，模型方差通过 repeat 观察。
- token 冒烟：固定 target，验证明显通过／未通过、协议与清理，不自动扩为 Judge 质量结论。
- Judge 质量：固定候选输出和人工标签，报告一致率、误判与翻转率。
