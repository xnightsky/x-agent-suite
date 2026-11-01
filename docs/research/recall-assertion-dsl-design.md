# 第一阶段断言 DSL 作者体验调研与决策记录

> 基线：`docs/recall-expect-decision-dsl`，`ff64e56`。
>
> 本文是设计调研，不是已实现契约。外部能力只用于辨析概念和作者体验，不构成本仓必须采用它的理由。
>
> 标记约定：**【外部事实】**附一手链接；**【本仓设计判断】**是基于本仓规格的建议；**【尚未验证】**不能当作既定行为或质量结论。

## 一、结论

1. **保留当前主干形状。** KV 裁定池与 KV 评分维、case 级 `expect` 断言根、`decision.dimensions` 包装以及同级 `threshold`，都比平铺列表更能维持稳定名称、引用完整性与报告归因。第一层作者接口不必为了贴近运行时数组而改成列表。
2. **每维恰好选择 `eq / one_of / verdict / outcome` 之一。** 作者 DSL 已确认采用 `outcome`，编译后仍降低为现有内部 `metric` 字段。它引用的是具名 `CriterionOutcome` 的 pass/absent，不是数值指标，也不把“展示标签”和“跨样本统计”混入评分维来源。
3. **保留静态评分，不引入通用布尔表达式。** `eq / one_of` 是字面值来源，`verdict / outcome` 是结果引用；数组只表示 OR，AND 通过拆维表达。`weight / knockout / absent / threshold` 保持统一作用于维度，`from` 只服务字面维。第一阶段不需要嵌套 AND/OR、算术表达式或脚本断言。
4. **简单模式可以保留“声明即参与”，精调模式应鼓励显式展开。** 未被引用的 rubric 自动形成隐式维度，容易让作者漏看实际分母与权重。首版不必再加一组开关，但文档应给出完整展开例，实施时让编译结果/报告能还原“实际生效的全部维度”。
5. **第一阶段只评最后一轮是正确的范围控制，但必须承认它评的是最终产物，不是全过程。** 逐轮证据、跨轮计分、动态后续提示词、条件分支、提前终止是五个可独立设计的能力；不能用一个 `turns[].expect` 字段把它们一次性带入。
6. **“代码里的分支表是静态的”不等于“实验轨迹与模型无关”。** 纯确定性条件控制与 AI verdict 驱动的分支必须分层评审。当前回归矩阵仍应坚持 LLM 只产分类/裁定，不决定发送哪些轮次、运行哪些判据或何时终止。

## 二、当前设计保留项

### 2.1 KV 比列表更适合“具名裁定 + 具名评分维”

当前形式：

```yaml
expect:
  judge:
    ownership: { rubric: 是否解释了责任归属 }
    concise: { rubric: 是否简洁 }
  decision:
    dimensions:
      reasoning:
        verdict: judge.ownership
        weight: 3
      style_ok:
        verdict: [judge.polite, judge.concise]
```

不建议改成：

```yaml
# 反例：名称重复书写，引用关系与报告身份更依赖数组元素内部字段
judge:
  - name: ownership
    rubric: 是否解释了责任归属
decision:
  - name: reasoning
    verdict: judge.ownership
```

**【本仓设计判断】**KV 的 key 同时承担作者标识、引用锚点和报告名称，正好对应本设计“每个名字只有一个定义”的模型；重复 YAML key 又可在加载期拒绝。列表更适合允许重复、顺序本身有语义的断言执行序列，而这里的维度是无重复名的规则表。代价是 KV 会让“声明即隐式参与”更不明显，需要第 3.2 节的作者约束与可见性补足。

**【外部事实】**promptfoo 的 test case 使用断言对象数组，每项以 `type` 区分断言，并可有 `weight / transform / metric` 等属性；这说明列表适合异构断言序列，但并不否定本仓对具名评分表采用 KV。[promptfoo：Using assertions / Assertion properties](https://promptfoo.dev/docs/configuration/expected-outputs/#using-assertions)

### 2.2 case 级 `expect` 是正确断言根

```yaml
cases:
  - id: final-answer
    turns:
      - send: 先准备
      - send: 给出最终结论
    expect:
      judge:
        correctness: { rubric: 最终结论是否正确 }
      decision:
        dimensions:
          correctness:
            verdict: judge.correctness
```

保留以下分工：

- `turns`：主 Agent 接收什么输入、按什么顺序执行；
- `expect.judge`：模型只产具名 boolean verdict；
- `expect.decision`：字面值与结果引用如何进入静态评分；
- 其他 `expect.<name>`：消费者注册的判据输入。

**【本仓设计判断】**case 级根避免把“发送下一轮”和“评价上一轮”混在同一个执行对象里，也为最后一轮评价提供唯一、易校验的输入边界。它只约束内置 `judge / decision`，不应顺手改写既有自定义逐轮判据。

### 2.3 保留 `dimensions` 包装与同级 `threshold`

```yaml
decision:
  threshold: 0.5
  dimensions:
    choice: { eq: alpha, knockout: true }
    reasoning: { verdict: judge.ownership, weight: 3 }
```

比以下平铺形式更好：

```yaml
# 反例：threshold 到底是评分维还是聚合配置，需要额外保留字规则
decision:
  threshold: 0.5
  choice: { eq: alpha }
```

**【本仓设计判断】**多一层缩进换来明确的命名空间、封闭 schema 和后续聚合级选项扩展位置，值得保留。`threshold` 不应占用维度名，也不应复制到每一维。

### 2.4 保留“来源恰一”与受限 `from`

四种来源的精准边界应为：

| 作者字段  | 实际来源                           | 值形状                  | 是否允许 `from` | 数组语义  |
| --------- | ---------------------------------- | ----------------------- | --------------- | --------- |
| `eq`      | 最终回答中抽取的字面值             | 非空字符串              | 是              | 不适用    |
| `one_of`  | 最终回答中抽取的字面值             | 非空字符串数组          | 是              | 候选值 OR |
| `verdict` | 当前 case 的 Judge boolean verdict | `judge.<name>` 或其数组 | 否              | 结果 OR   |
| `outcome` | 其他具名 `CriterionOutcome`        | 字符串或字符串数组      | 否              | 结果 OR   |

保留这些精确语义：

- `eq / one_of`：trim、大小写不敏感后精确比较；不引入模糊相似度。
- 默认 `from`：行约定 `^<维度名>: <值>$`；自定义正则必须恰有一个捕获组。
- 抽取不到、抽取为空、输入不存在：进入 `absent`，不能猜成明确 false。
- `verdict` 引用当前 case 已声明 rubric，未知引用在编译期拒绝。
- `weight`：hit 为 `+weight`，miss 为 `-weight`。
- `knockout`：缺席映射后仍非 hit，则整个 case 被否决。
- `absent`：`zero / pass / fail` 是评分映射，不回推提高 coverage。
- OR：任一 hit 即 hit；无 hit 但至少一个 miss 即 miss；全部 absent 才 absent。

**【外部事实】**Inspect 的 `pattern()` 也用正则抽取后比较；其当前内置语义把 pattern 缺席记为 `INCORRECT` 并附 `invalid_response_format`。[Inspect：Standard Scorers](https://inspect.aisi.org.uk/scorers.html#pattern) 本仓选择把抽取缺席保留为三态中的 absent，属于**不同的本仓设计判断**，不能写成“业界通用语义”。

### 2.5 保留 AI 只裁定、静态机出分

**【外部事实】**OpenAI Evals 的 model-graded 模板要求把裁判输出约束为易解析的 choice；无法匹配的 choice 会归为 `__invalid__`，可选 `choice_scores` 再把 choice 静态映射为分数。[OpenAI Evals：Parameters for model-graded evals](https://github.com/openai/evals/blob/main/docs/eval-templates.md#parameters-for-model-graded-evals) 这与本仓“先得到受约束裁定，再由声明规则处理”的方向具有可比性，但本仓 boolean verdict、负分、knockout 与 absent 仍是自己的契约。

**【本仓设计判断】**Judge 不直接出分、不直接改执行流，能把模型误差限制在评分输入层；权重、否决和阈值仍是可审计的静态表。

## 三、可能不优雅之处

### 3.1 旧词 `metric` 曾让来源类型变浑浊：已采用 `outcome`

**反例（旧词）：**

```yaml
expect:
  decision:
    dimensions:
      deterministic_evidence:
        metric: text-contains
        weight: 2
```

作者可能产生三种误读：它是数值分数、它是报告里的展示标签，或它是跨样本统计。实际上这里只是“读取名为 `text-contains` 的 outcome，再按 pass/absent 归约”。

**采用后的写法：**

```yaml
expect:
  decision:
    dimensions:
      deterministic_evidence:
        outcome: text-contains
        weight: 2
```

**理由：**

- **【外部事实】**promptfoo 的断言属性 `metric` 是显示在 UI 中的 named metric 标签。[promptfoo：Assertion properties](https://promptfoo.dev/docs/configuration/expected-outputs/#assertion-properties)
- **【外部事实】**Inspect 的 metric 用于聚合 Score；其文档示例包括 `accuracy()`、`mean()` 等数据集级统计。[Inspect：Standard Scorers — Metrics](https://inspect.aisi.org.uk/scorers.html#metrics)
- **【本仓设计判断】**本仓字段若再表示“单个 outcome 引用”，就形成第三种语义。`outcome` 与现有类型 `CriterionOutcome` 对齐，并明确它不是连续值计算器。

**为什么改名而不拆分：**第一阶段四种来源已经足够。只有未来确实支持“读取数值并按数值比较”时，才应另设明确来源类型；不要现在同时发明 `metric / score / value` 三组无实现需求的字段。

**代价：**该命名已确定；实施时会触及主规格、计划、schema、编译映射、测试和文档示例。内部 `DimensionSpec.metric` 保持不变，避免把作者体验改名扩大成运行时重构。若仓库外存在旧草稿，需要一次性迁移说明。

### 3.2 显式 `decision` 中仍有隐式维度，实际评分表不够一眼可见

**反例：**

```yaml
expect:
  judge:
    ownership: { rubric: 是否说明责任归属 }
    no_invention: { rubric: 是否没有臆造事实 }
  decision:
    dimensions:
      reasoning:
        verdict: judge.ownership
        weight: 3
      # no_invention 没写，但仍会按 weight=1、absent=zero 隐式参与
```

作者只阅读 `decision` 时，会漏掉第二个评分维及其对默认 pass、coverage 的影响。

**改进例（精调场景的作者推荐写法，无行为变化）：**

```yaml
expect:
  judge:
    ownership: { rubric: 是否说明责任归属 }
    no_invention: { rubric: 是否没有臆造事实 }
  decision:
    dimensions:
      reasoning:
        verdict: judge.ownership
        weight: 3
      no_invention:
        verdict: judge.no_invention
        weight: 1
        absent: zero
```

**理由：**保留“只写 judge 即可运行”的低门槛，同时让“写了 decision 精调”的高关注场景能完整审阅评分表。实现侧可提供展开后的 effective dimensions 作为诊断/报告证据，而不是要求作者理解隐式规则。

**代价：**显式写法更冗长，rubric 改名时要同步引用；effective dimensions 需要额外展示，但不需要新增 DSL 字段。若强制所有引用都显式化，则会破坏当前简单模式，不建议首版这么做。

### 3.3 数组 OR 很简洁，但容易被误读为 AND

**反例（作者若希望“礼貌且简洁”，下面写法不满足意图）：**

```yaml
style_ok:
  verdict: [judge.polite, judge.concise]
  weight: 2
```

它只声明一个二维值 OR：任一 verdict 为 hit，整个 `style_ok` 就得 `+2`。

**改进例（AND）：**

```yaml
polite:
  verdict: judge.polite
  weight: 1
concise:
  verdict: judge.concise
  weight: 1
```

**保留 OR 的正确例子（多种等价依据任一成立即可）：**

```yaml
acceptable_style:
  verdict: [judge.polite, judge.concise]
```

**理由：**OR 与 AND 的报告身份、maxScore 和 absent 归约都不同，不能用同一数组同时暗示两种语义。拆维是首版表达 AND 最小且精确的方式。

**代价：**AND 写法更啰嗦，并且两个维度的总权重、threshold 和 coverage 与单个 OR 维不同；作者必须把这当作有意的评分设计，而非机械展开。首版若加入任意嵌套 `all / any / not`，会显著增加三态真值表、校验与报告成本，不建议。

### 3.4 `absent: pass` 能表达宽免，也能不小心掩盖缺证据

**反例（必需维缺席却按通过计）：**

```yaml
reasoning:
  verdict: judge.ownership
  weight: 3
  knockout: true
  absent: pass
```

Judge 返回中缺少 `ownership` 时，该维映射为 hit，`knockout` 不会否决；coverage 仍低，但粗看 pass/score 可能误解为证据齐全。

**改进例（必需维）：**

```yaml
reasoning:
  verdict: judge.ownership
  weight: 3
  knockout: true
  absent: fail
```

**可选维的改进例：**

```yaml
polish:
  verdict: judge.polish
  weight: 1
  absent: zero
```

**理由：**`absent` 是作者对“没有判定数据”的明确业务选择，不是 Judge 错误重试策略。必需维通常用 `fail`，可选维用 `zero`；`pass` 应只用于确有“缺证据也宽免”的场景，并必须结合 coverage 审阅。

**代价：**`absent: fail` 会把单项缺 verdict 变成内容失败，作者需要理解它与 Judge 整体调用/解析失败的 `not-evaluated` 不同；更多显式字段会增加初学负担。

**【外部事实】**Inspect 将“scorer 完成但没有 verdict”的 unscored 与执行错误区分，默认把 unscored 排除出 metric，并保留 scored/unscored 数量。[Inspect：Scoring Policy](https://inspect.aisi.org.uk/scoring-policy.html#unscoreable-samples) 这支持“缺席和错误必须可见”的一般原则；本仓具体 `zero / pass / fail` 映射仍是自身设计。

### 3.5 `weight + threshold` 不是常见的“未中得 0 的加权平均”

**反例（若按 miss=0 直觉心算，会算错）：**

```yaml
decision:
  threshold: 0.5
  dimensions:
    reasoning: { verdict: judge.ownership, weight: 3 }
    style: { verdict: judge.polite, weight: 1 }
```

当 `reasoning=miss`、`style=hit` 时，本仓规则是：

```text
rawScore = -3 + 1 = -2
maxScore = 4
score = -2 / 4 = -0.5
pass = false
```

不是 `(0 × 3 + 1 × 1) / 4 = 0.25`。

**改进例（同一 YAML，但把预期算术写入评审样例/测试）：**

```yaml
decision:
  # 两维均在场：score = (Σ hit weight - Σ miss weight) / Σ weight
  # reasoning miss + style hit => rawScore=-2, maxScore=4, score=-0.5
  threshold: 0.5
  dimensions:
    reasoning: { verdict: judge.ownership, weight: 3 }
    style: { verdict: judge.polite, weight: 1 }
```

**理由：**负分刻意区分“明确答错”和“缺席中立”，可防止乱答比不答更划算；但它不能借用 promptfoo 的加权平均直觉而不加解释。

**【外部事实】**promptfoo 文档将 `weight` 描述为断言权重、默认 1，并为 assertion set 提供 threshold；其文档示例以通过比例解释 threshold。[promptfoo：Grouping assertions via Assertion Sets](https://promptfoo.dev/docs/configuration/expected-outputs/#grouping-assertions-via-assertion-sets) 本仓采用 hit 加分、miss 减分，不应宣称与其公式相同。

**代价：**作者教育成本更高，报告必须同时展示 rawScore、maxScore、归一分、逐维贡献和 coverage。主规格已明确 `threshold` 是任意有限数，且 Recall `expect.decision` 的 `coverage.evaluated=0` 默认 FAIL；只有作者显式 `absent: pass` 宽免时才继续判定，避免边界假绿。

### 3.6 默认 `from` 方便，但把维度名与输出协议耦合

**反例（没有输出格式约定时，作者可能把 absent 误判为内容答错）：**

```yaml
dimensions:
  choice:
    eq: beta
```

如果最终回答只是“我选择 beta”，默认行约定匹配不到，结果是 absent，不是 miss。

**改进例（输出协议与抽取规则一起写清）：**

```yaml
turns:
  - send: 最后单独输出一行 choice: alpha 或 choice: beta
expect:
  decision:
    dimensions:
      choice:
        eq: beta
        from: '^choice:\s*(.+?)\s*$'
```

若团队稳定使用默认行协议，也可省略 `from`；关键是在提示词、维度名和报告里保持同一个协议。

**理由：**默认抽取减少重复正则，自定义 `from` 处理非默认版式；二者都不能从自然语言中“猜测”实际值。

**代价：**显式正则增加 YAML 转义与维护成本；维度改名会改变默认抽取字段。自写正则的灾难性回溯防护、多行行为和 Unicode 大小写细节尚未验证，不应在首版继续扩展为任意脚本 transform。

## 四、逐轮与条件控制的发展方向

### 4.1 最后一轮评价与逐轮评价回答不同问题

| 能力           | 回答的问题                               | 第一阶段是否纳入 |
| -------------- | ---------------------------------------- | ---------------- |
| 最后一轮评价   | 最终回答是否满足内容与计分要求           | 是               |
| 逐轮评价       | 哪一轮首次满足、何时退化、准备轮是否合规 | 否               |
| 跨轮计分       | 多轮证据如何形成同一个 case 分数         | 否               |
| 动态后续提示词 | 下一轮文本如何由之前输出/结果生成        | 否               |
| 条件分支       | 不同结果是否走不同后续路径               | 否               |
| 提前终止       | 何时不再执行剩余轮次，剩余证据如何记     | 否               |

**【本仓设计判断】**第一阶段只评最终输出，不代表中间轮没有价值，而是刻意不承诺轨迹评价。报告和教程应使用“最终回答评估”，不要笼统写成“多轮 Agent 全过程评估”。

**【外部事实】**Inspect 将 solver 定义为任务执行计划，scorer 通常独立评分；同时 solver 也能产生中间 score、用 score 帮助决定是否继续，并通过 `TaskState.completed` 放弃后续 solver。[Inspect：Solvers — Scoring in Solvers / Early Termination](https://inspect.aisi.org.uk/solvers.html#scoring-in-solvers) 这说明评分与执行可以分层，也说明一旦允许执行中评分，继续/终止问题会自然出现；它不是本仓应照搬该能力的理由。

### 4.2 为什么“逐轮配置”会引出后续需求，但它们不是同一个功能

1. **逐轮评价 → 跨轮计分。** 每轮都有 verdict 后，作者会要求“最后一轮必须过”“至少两轮过”“不得从 pass 退化为 fail”。这需要稳定的 turn id、跨轮结果引用、逐轮 absent 与最终 coverage 口径，而不是把多次结果无差别塞进一个 OR。
2. **逐轮评价 → 动态后续提示词。** 一旦中间结果被用于纠偏，下一轮 `send` 就不再全是固定文本。需要定义插值输入、转义、最大长度、秘密处理、可复现记录，以及动态文本是否还属于同一张考卷。
3. **逐轮评价 → 条件分支。** 分歧处理可能从固定恢复扩展为 A/B 路径。执行模型由序列变成图，报告需记录实际路径；不同系统若走不同路径，判据集合和分母会变化。
4. **逐轮评价 → 提前终止。** 已达目标或前提不成立时继续发送可能制造无意义数据。需要区分成功完成、内容失败、基础设施失败、前提不成立 no-data、作者主动终止；未执行轮次不能记成 hit，也不能与普通 absent 混为一谈。
5. **反向不成立。** 只做逐轮证据并分别报告，不要求跨轮总分；只做跨轮静态汇总，也不要求动态提示词或分支。应在每个需求出现时单独评审，而不是预先设计一个万能场景图 DSL。

### 4.3 确定性工作流控制与模型驱动控制

**【外部事实】**LangGraph 文档把 workflows 定义为预定代码路径、按既定顺序运行，把 agents 定义为动态决定自身过程和工具使用。[LangGraph：Workflows and agents](https://docs.langchain.com/oss/python/langgraph/workflows-agents)

**【外部事实】**OpenAI Agents SDK 将编排分为“让 LLM 决定步骤”和“通过代码决定流程”；代码编排示例包括让 agent 输出结构化类别，再由代码根据类别选择下一个 agent。[OpenAI Agents SDK：Agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/#orchestrating-via-code)

据此，本仓需要区分四层，而不是只问“if 语句是不是代码”：

| 层级                            | 下一步由什么决定                    | 对当前回归矩阵的判断                 |
| ------------------------------- | ----------------------------------- | ------------------------------------ |
| A. 固定序列                     | 作者预先写死的轮次                  | 当前基线                             |
| B. 确定性条件控制               | 固定规则读取确定性状态              | 可单独设计；仍需评审主动分支的可比性 |
| C. 静态表读取 AI verdict        | 代码映射固定，但 verdict 有模型方差 | 仍是模型驱动的实验轨迹，不能当作 A/B |
| D. 模型直接选择动作/提示词/终点 | 模型在运行时决定控制流              | 当前明确禁止                         |

**关键判断：**C 层虽然满足“分类是 AI，反应是一张表”的实现形式，却仍可能让同一系统两次运行发送不同轮次、执行不同判据。它可以在未来的自适应调试或非矩阵入口讨论，不能因为分支表可审计就自动获得回归矩阵可比性。

因此，当前“LLM 只作分类器、不作控制器”与第一阶段没有冲突：Judge verdict 只进入静态计分。若未来让 verdict 影响 `send`、branch、completed 或判据集合，就不只是给 `judge` 加字段，而是修订执行语义与可比性约束。

### 4.4 后续设计的最低前置清单

- **逐轮证据：**turn id、输入证据范围、结果命名、每轮调用成本、重复运行归因。
- **跨轮评分：**序列级三态真值表、最终/逐轮分数的形状区别、coverage、未执行轮次语义。
- **动态提示词：**固定模板与模型生成内容的边界、完整审计日志、跨 target 一致性。
- **条件分支：**场景图、最大路径/步数、路径报告、矩阵可比性或独立运行入口。
- **提前终止：**完成原因枚举、no-data、剩余轮次与最终 decision 的交互、清理和取消语义。

以上任何一项都不应通过第一阶段 `judge` 的隐式副作用获得。

## 五、建议的第一阶段收口

### 5.1 作者契约

1. 保留 case 级 `expect.judge / expect.decision`，不在 `turns[]` 开放这两个内置字段。
2. 保留 KV 简写/完整 judge、KV `dimensions`、同级 `threshold`；继续拒绝重复 key、未知字段和未知引用。
3. 作者侧已确认使用 `outcome`，不拆分。每维恰选 `eq / one_of / verdict / outcome`，内部降低仍沿用 `DimensionSpec.metric`。
4. 保留 `from` 仅用于 `eq / one_of`，保留一个捕获组与 absent 语义；不增加脚本 transform。
5. 保留数组 OR，AND 拆维；不增加通用表达式、嵌套布尔代数或自定义计分函数。
6. 保留 `weight / knockout / absent / threshold / coverage` 的静态机；用至少一组含负分、一组含 absent 的算例固定作者预期。
7. 保留未引用 rubric 的隐式维度，但文档推荐精调时显式展开，并要求报告/effective config 能解释最终参与维度。

### 5.2 执行与结果

1. 只把最后一轮 `turn.text` 送给字面命中器与标准 Judge；不把对话历史、工具状态或 workspace 暗中加入。
2. Judge 一次批量返回具名 boolean verdict；分数只由 decision 静态机产生。
3. 保持单项 absent、整体 not-evaluated、DSL 定义错误三层语义，不把基础设施失败压成内容零分。
4. 报告同时保留作者维度名、实际来源、三态、贡献、rawScore/maxScore、score、coverage 和否决原因。

### 5.3 明确不做

- 不做逐轮 Judge、跨轮汇总、动态后续提示词、条件分支和提前终止。
- 不做 AI verdict 到执行动作的任何隐式映射。
- 不因为外部框架存在某字段就增加同名字段；只有第二个消费者与清晰语义同时出现时再扩展契约。
- 不在第一阶段引入连续数值 `metric` 计算、任意脚本评分或通用场景图。

### 5.4 调研后的决策校准（2026-11-01）

- 作者 DSL 已确认采用 `outcome`，内部继续映射到 `DimensionSpec.metric`。
- `threshold` 已确认为任意有限数，与负归一分保持数学一致，NaN 与 Infinity 拒绝。
- Recall `expect.decision` 的 `coverage.evaluated=0` 默认 `pass=false`；至少一个维度显式 `absent: pass` 时才允许继续按映射、knockout 与 threshold 判定。既有通用 `ScenarioSpec.aggregate` 的空考行为保持兼容。
- “数组 = OR”“miss = −weight”“抽取缺失 = absent”应在作者示例、编译测试与报告中保持可见。

## 六、证据来源

### 本仓与用户指定的一手资料

1. `docs/spec/recall-judge-dsl.md`：第一阶段目标作者接口、三态评分、最后一轮边界与后续方向。
2. `docs/plans/2026-10-31-ai-assertion-complete-scenarios.md`：当前实施拆分、KV 作者接口与首版不做事项。
3. `docs/spec/scenario-dsl.md`：可比性轴、主动分支限制、固定纠偏与 LLM 分类器/控制器边界。
4. `docs/spec/scoring-aggregation.md`：内部 `metric`、OR、weight、knockout、absent、threshold 与 coverage 的精确归约。
5. 用户指定的跨仓 `recall-author/SKILL.md`：现有作者文档中 KV 裁定池、声明即参与、decision 精调和常见反例；仅作设计证据，不要求源码引入其领域词汇。

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

## 七、未验证边界

1. **【尚未验证】作者可用性。** 没有招募真实考卷作者做 KV/列表、`metric/outcome`、OR/AND 或 absent 的对照写作实验；`outcome` 的采用依据来自语义分析和现有作者文档审阅。
2. **【尚未验证】实现行为。** 基线规格明确标记尚未实现；本文没有把计划中的 schema、编译、报告或错误语义当成已运行事实，也未新增生产代码或测试。
3. **【尚未验证】Judge 质量。** 没有运行真实 provider、测量 verdict 一致率/翻转率或校准 rubric；第一阶段仍需要固定人工标注集与显式 token 测试来验证裁判质量。
4. **【尚未验证】正则稳健性。** 未对自定义 `from` 的灾难性回溯、多行文本、Unicode 大小写和异常诊断做基准测试；首版应限制功能并用零 token 测试覆盖基本语义。
5. **【尚未验证】实现侧边界。** 规格已确认 threshold 是任意有限数、Recall `expect.decision` 零覆盖默认 FAIL；但这些规则尚未由生产实现和回归测试验证。
6. **【尚未验证】逐轮与控制原型。** 没有实现跨轮计分、动态提示词、条件分支或提前终止原型，相关章节只划定依赖和评审边界，不是目标 YAML 契约。
7. **【尚未验证】外部框架运行。** 外部事实来自本次查阅的官方文档/官方源码仓库，没有安装或运行这些框架，也没有把其当前实现细节当成本仓兼容性承诺。
8. **【尚未验证】仓库外迁移面。** 本仓文档已采用 `outcome`，但未盘点所有仓库外早期草稿；正式实施前需要确认是否存在旧 `metric` 写法，并提供一次性迁移说明。
