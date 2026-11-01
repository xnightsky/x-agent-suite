# AI 断言如何测试：确定性接线、Agent 评估与 Judge 质量分层

> 调研日期：2026-10-31
>
> 范围：model-graded assertion / LLM-as-a-judge 的测试方法，以及 Recall 从 `.recall.yaml` rubric 到报告的完整验证方案。
>
> 证据约束：公开外部事实采用官方文档、公开官方源码和原始论文；设计取舍与本仓契约交叉校准。
> 落地计划：[AI 断言完整测试场景 Implementation Plan](../plans/2026-10-31-ai-assertion-complete-scenarios.md)

## 结论

1. **默认 CI 使用固定输入验证完整接线。** 注入 fake/mock Judge，固定主执行输出和结构化裁定，覆盖 `.recall.yaml` rubric → 内置标准装配 → `createJudgeAssertion` → `turn.text` → Judge → verdict → `CriterionResult` → 报告。promptfoo 的 `handleLlmRubric` 单元测试 mock `matchesLlmRubric`，直接检查参数与返回结果；Inspect AI 的 model-graded 测试用 `mockllm/model` 和 `custom_outputs` 固定主模型及裁判输出，再走真实 `eval()`。[promptfoo 官方测试源码](https://github.com/promptfoo/promptfoo/blob/main/test/assertions/llmRubric.test.ts)、[Inspect AI 官方测试源码](https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/tests/scorer/test_model_graded.py)
2. **完整链路分别验证 PASS、明确 FAIL、不可评测和缺证据。** OpenAI Evals 使用 `__invalid__` 标记非法裁定，Inspect AI 使用 unscored 表达无效 verdict；本仓完整场景对应验证显式 `pass=false`、`[not-evaluated:<kind>]` 与 `[absent]` 的结果和报告。[OpenAI Evals 模板文档](https://github.com/openai/evals/blob/main/docs/eval-templates.md)、[OpenAI Evals 实现](https://github.com/openai/evals/blob/main/evals/elsuite/modelgraded/classify.py)、[Inspect AI 非法裁定测试](https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/tests/scorer/test_model_graded.py)
3. **Judge 质量通过人工 gold set 独立评估。** MT-Bench 论文以受控人类偏好和众包偏好检验 LLM Judge 一致性，Braintrust 使用 human review 构建 ground truth 并评估自动评分。固定候选输出、人工标签、开发集和保留集共同构成质量评估基础。[Zheng et al., 2023](https://arxiv.org/abs/2306.05685)、[Braintrust Human review](https://docs.braintrust.dev/annotate/human-review/)
4. **重复运行服务于分布与稳定性测量。** 默认 CI 的 fake 链路运行一次；Judge 稳定性和 Agent 成功率按预设样本量重复，保留每次原始 verdict 与运行条件。Inspect AI 的多 grader 与 reducer 展示了显式质量协议的实现方式。[Inspect AI scorer 源码](https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/src/inspect_ai/scorer/_model.py)
5. **live 冒烟独立报告 provider 兼容性。** 显式 live 使用固定 target、明显 PASS 与明显 FAIL，记录模型版本、响应解析和清理结果；默认 CI、live 冒烟与离线质量评估分别形成证据。

## 三类问题必须分开

| 问题                | 被测对象                                | 应固定什么                        | 典型结论                               |
| ------------------- | --------------------------------------- | --------------------------------- | -------------------------------------- |
| 测试测试框架接线    | Recall 内置装配、Judge 适配、解析与报告 | 主 Agent 输出、Judge verdict/错误 | 输入是否准确传递，结果与退出码是否正确 |
| 评估被测 Agent      | 消费者 Agent / 场景                     | Judge 配置、数据集、运行条件      | Agent 在该评估协议下的通过率及不确定性 |
| 评估 Judge 本身质量 | 指定 model + prompt + rubric + parser   | 同一样本、人工标签、版本信息      | 人机一致性、误判方向、偏差与稳定性     |

零 token 全链路测试只回答第一类。即使主执行和 Judge 都是真实模型，PASS 也主要是第二类结果，仍不自动回答第三类。第三类需要人工参照，不能由同一个 Judge 自证。

## 一手证据与可迁移方法

### 1. 官方框架如何做确定性回归

- **promptfoo：在边界 mock 评分函数。** `llm-rubric` 官方文档规定裁判输出含 `reason`、`score`、`pass` 的 JSON，并允许显式覆盖 grader provider 与参数；其官方测试把 `matchesLlmRubric` 替换为 `vi.fn()`，再验证渲染后的 rubric、输出和上下文参数以及 `GradingResult` 原样返回。这是“固定裁定、验证适配层”的直接样本。[llm-rubric 文档](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/)、[官方测试](https://github.com/promptfoo/promptfoo/blob/main/test/assertions/llmRubric.test.ts)
- **Inspect AI：用内置 mock model 跑完整任务。** 官方 `test_model_graded.py` 使用 `mockllm/model`、`ModelOutput.from_content` 和 `custom_outputs`，同时走 dataset、task、scorer、`eval()` 与 log；测试还检查 grader role 选择和 grading event，而非只测正则。这支持本仓采用 fake transport 但保留 registry、CLI、runner、报告等真实组件。[Inspect AI 官方测试](https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/tests/scorer/test_model_graded.py)
- **OpenAI Evals：把输出协议限制为可解析类别。** 官方模板文档建议让评估模型输出多选或 yes/no，未列入 `choice_strings` 的输出解析为 `__invalid__`，只有配置的 `choice_scores` 才转为指标。可迁移原则是让 PASS/FAIL 只来自受控 verdict，不从自由文本猜测。[OpenAI Evals 模板文档](https://github.com/openai/evals/blob/main/docs/eval-templates.md)

### 2. 失败、缺席与结构化 verdict

建议统一采用下表语义；其中本仓行为是本地设计，外部实现仅提供交叉证据。

| Judge 情况                                         | 测试语义          | 结果证据                                     |
| -------------------------------------------------- | ----------------- | -------------------------------------------- |
| 全部 rubric 明确 `pass=true`                       | PASS              | `score=1`，CLI=0，报告通过                   |
| 至少一项明确 `pass=false` 且其余齐全               | 明确 FAIL         | `score=0`，失败 rubric/reason 留痕，CLI=0    |
| Judge 调用、超时、响应或整体解析失败               | `not-evaluated`   | 基础设施 failure 保留类别，CLI=1             |
| 简单模式：整体解析成功但请求中的 rubric 缺 verdict | `absent`          | 缺少的 rubric 名进入诊断，CLI=1              |
| 非布尔值、非法 verdict、空响应                     | 解析失败/不可评测 | 失败类别与原始诊断分类留痕                   |
| decision 模式：单项缺 verdict                      | `absent`          | 按对应维度的 absent 映射处理；内容结果 CLI=0 |

OpenAI 的 `__invalid__` 与 Inspect 的 unscored 都支持“协议失败不猜分”。Inspect 还测试最终非法 `GRADE:` 不得回退到 reasoning 中较早出现的合法字母，并测试被评文本中的结构分隔符注入会被中和；本仓后续可把恶意 `turn.text` 中伪造 JSON/标签作为独立单元测试候选，但不扩大本次 Recall 八场景范围。[Inspect AI 非法裁定与注入测试](https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/tests/scorer/test_model_graded.py)

### 3. 真实模型、CI 与质量评估分层

| 车道               | 模型                                         | 重复次数         | 默认断言/指标                                            | 目的                  |
| ------------------ | -------------------------------------------- | ---------------- | -------------------------------------------------------- | --------------------- |
| 默认单元 CI        | fake client 或 fake transport                | 1                | 精确 prompt 关键片段、verdict 映射、报告、退出码、调用数 | 接线回归              |
| 显式 token 冒烟    | 固定且记录版本的真实 Judge；主输出最好仍固定 | 1                | 调用完成、schema 可解析、一个已知样例的裁定、清理        | provider/渠道兼容性   |
| Agent 离线评估     | 真实 Agent + 固定 Judge 配置                 | 按方差与成本预设 | 每案例通过率、置信区间、失败类别；保留每次原始结果       | 比较 Agent/提示词版本 |
| Judge 离线质量评估 | 固定主输出 + 待评 Judge                      | 每样本可多次     | 人机一致率、混淆矩阵、偏差切片、重测不一致率             | 选择/验收 Judge       |

Braintrust 官方建议 scorer 在手工样例、dataset 与真实 logs 上迭代测试，并明确 LLM Judge 比 custom code 成本高、延迟大；LangSmith 将 LLM-as-judge 放在 offline evaluation，也提供在线评估入口。这支持把真实模型质量测量从每次提交的基础设施回归中拆出。[Braintrust Write scorers](https://docs.braintrust.dev/evaluate/write-scorers)、[LangSmith LLM-as-a-judge](https://docs.langchain.com/langsmith/llm-as-judge)

## Judge 校准、偏差与重复采样

### Gold set 是否必要

**若要把 AI 断言当作质量门禁，则需要；若只验证 Recall 接线，则不需要。** gold set 应来自消费者真实或代表性样本，包含清晰正例、清晰负例、边界例、历史误判和对抗性文本；每条保存输入、待评输出、rubric、人工标签及必要理由。人工标注指南必须先于模型结果审阅固定，避免看 Judge 答案后改标签。调 rubric 的开发集与最终验证的保留集应分开，避免把对调参样本的拟合误当成泛化能力。[promptfoo 校准工作流](https://www.promptfoo.dev/docs/guides/llm-as-a-judge/)

Braintrust 的 human review 明确用于建立 ground truth、评估自动评分，并支持把生产样本转为评估数据；LangSmith 则能把人工对 evaluator 分数的纠正作为 few-shot examples 来改善人机偏好对齐。两者是校准机制，不是“无需独立验收集”的依据。[Braintrust Human review](https://docs.braintrust.dev/annotate/human-review/)、[LangSmith LLM-as-a-judge](https://docs.langchain.com/langsmith/llm-as-judge)

### 衡量什么

对本仓二值 rubric，离线报告至少包含：

- 与人工标签的**观察一致率**，同时给出样本数和置信区间；
- 以人工 PASS 为参照的 **false-pass / false-fail 数与比例**，并查看混淆矩阵，避免类别不平衡下一致率虚高；
- 按 rubric、长度、语言、来源模型等切片的一致率与误判方向；
- 同一固定输出重复裁判的**逐样本不一致率**，以及多次运行间 verdict 翻转率；
- `not-evaluated` 与 `absent` 单独计数，**不得从一致性分母中静默删除，也不得算作内容 FAIL**。

多人标注时保留独立盲评，再报告标注者一致性与仲裁规则。Braintrust 对同一样本保存各 reviewer 的独立分数，并提供 blind reviews；其多 reviewer 数值分自动取平均、文本类不平均，说明“汇总值”和“原始分歧”都应保留。[Braintrust Multiple reviewers](https://docs.braintrust.dev/annotate/human-review/multiple-reviewers/)

MT-Bench/Chatbot Arena 原论文报告 GPT-4 与人类偏好超过 80% 一致，且与人类之间的一致水平相当，但这是该论文任务与设置的结果，**不是本仓 rubric 可直接继承的阈值**。论文同时识别 position、verbosity、self-enhancement bias 和推理能力限制；因此本仓若涉及成对比较，应交换位置；单输出 rubric 也应做等义不同长度、Judge 自己生成/他模型生成等偏差切片。[Zheng et al., 2023](https://arxiv.org/abs/2306.05685)

### 何时需要多次运行

- **接线 CI 不需要。** fake verdict 与主输出均固定，重复只会放大耗时。
- **显式 live 冒烟默认不需要。** 一次成功只作兼容性检查；失败按预先定义的基础设施/内容分类处理，不用自动重跑掩盖。
- **估计 Judge 随机性时需要。** 固定同一份 Agent 输出，对 Judge 独立重复，报告逐样本翻转与聚合区间；temperature=0 也不能被当成跨 provider 或跨版本绝对确定性的证明。promptfoo 官方支持固定 grader 参数并以内建 OpenAI grader `temperature=0` 提高可复现性，但这只是配置手段，不是可靠性证明。[promptfoo llm-rubric](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/)
- **估计 Agent 成功率时需要。** Agent 与 Judge 两层都在变化，应保存配对原始轨迹，区分“Agent 输出变化”与“同一输出裁判翻转”；必要时采用固定输出复评来分解方差。
- **多裁判多数表决是质量协议选择，不是默认 CI 修补。** Inspect AI 的 panel 默认 majority，无多数 unscored；本仓目前无 panel/reducer，不应为本次测试方案新增契约。[Inspect AI scorer 源码](https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/src/inspect_ai/scorer/_model.py)

## 评分决策声明位置：判据内部与 case 组合层

### 公开框架同时提供两种结构

- **判据内部映射：** OpenAI Evals 的 model-graded 配置用 `choice_scores` 把裁定类别映射为指标分；promptfoo 也允许单个 assertion 声明 `weight` 与 `threshold`。这种结构适合语义集中在单个评分器的场景。[OpenAI Evals 模板](https://github.com/openai/evals/blob/main/docs/eval-templates.md)、[promptfoo Assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/)
- **组合层归约：** promptfoo 的 `assert-set` 将多个 assertion 组成一组，并在组上声明 threshold/weight；子项可以属于不同类型。Inspect AI 允许 Task 声明多个独立 scorer，也允许一个 scorer 返回多个具名值以共享昂贵计算，`multi_scorer` 再用 reducer 形成单一结果。[promptfoo Assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/)、[Inspect Multiple Scorers](https://inspect.aisi.org.uk/multiple-scorers.html)

这些一手资料证明嵌套与分离都有成熟实现。它们没有规定所有框架必须采用同一种声明位置。

| 声明位置          | 主要收益                                                                | 适用场景                           |
| ----------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| Judge/scorer 内部 | 配置与单个评分器保持局部，适合一批 rubric 或一组同源 verdict 的内部归约 | 单轮、单 Judge、结果只来自该 Judge |
| case/任务组合层   | 混合确定性与 AI 判据，统一处理多来源结果、coverage 与报告               | 多判据、多轮、需要统一场景出口分   |

Inspect 对“一个 scorer 返回多个具名值以共享昂贵计算”的支持，尤其适合批量 Judge：一次模型调用产生多个 `judge.<rubric>` 结果，再由组合层消费。这与本仓批量 rubric 的执行形态一致。

### 本仓选择 case 级 decision 的依据

本仓已有 `ScenarioSpec.aggregate`、`resolveAggregate` 与 `AggregateResult`，已经定义混合 metric、weight、knockout、absent、threshold、rawScore、coverage 和逐维明细。case 级 `expect.decision` 可以承接这套执行契约，但作者接口保留独立的 KV 维度与 `eq / one_of / verdict / metric` 命中来源，再由编译层降低为数组与结果引用。

第一阶段只评 case 最后一轮输出，每个含 `judge` 的 case 批量裁定一次。逐轮评价、跨轮计分、条件分支与提前终止属于后续独立研究方向，不能从现有多轮聚合能力反推作者 DSL 已支持这些玩法。

因此，case 级分离是本仓基于现有聚合与混合判据需求作出的本地设计，而非业界唯一模式。单 Judge 内部归约可作为后续独立语法糖设计，其语义应明确限定为单轮、单 Judge 的内部评分。

## 决策模型的设计校准与取舍

> 以下候选结论与公开框架和本仓现有契约交叉核对，校准后的有效部分直接纳入本仓设计。

| 候选设计                                                 | 校准结果                                                                                | 对本仓的有效部分                                                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| AI 只产具名 boolean verdict，静态 decision 唯一算分      | 与 OpenAI 的裁定/choice_scores 分层、Inspect 的 scorer/reducer 分层及本仓聚合机一致     | **采纳。** Judge 输出 `judge.<rubric>`，case 级 decision 统一计算出口                                             |
| `absent: zero/pass/fail` 与 `(evaluated/total)` coverage | 与本仓 `AbsentMapping`、`AggregateResult.coverage` 一致；Inspect 也区分 scored/unscored | **采纳。** 整体不可评测继续走基础设施失败；decision 内的单项缺 verdict 进入 absent 映射                           |
| 未被 decision 显式引用的 rubric 仍默认参与               | 可通过归一化与 merge 测试验证，防止精调部分维度后忽略其余 rubric                        | **采纳并统一默认值。** 隐式维沿用本仓 `weight=1`、`knockout=false`、`absent=zero`                                 |
| verdict OR、knockout、正负 weight                        | 与本仓现有 metric 数组、knockout 短路、rawScore 可为负的语义一致                        | **采纳。** 直接复用 `resolveAggregate`，避免第二套评分机                                                          |
| 直接答案/answers-file 作为离线输入                       | 与固定候选输出的 Judge 校准方法一致                                                     | **采纳。** 质量评估使用固定 output，分离主 Agent 方差与 Judge 方差                                                |
| Judge grader/timeout 配置                                | timeout 与 retry 已有本仓 `judge()` 原生支持；主 AI 同源是已确认的默认路径              | **采纳执行参数。** 使用 `timeoutMs/maxRetries/instructions`；默认 target 继续复用主流程，显式 Driver 选择另设设计 |
| 每个 case 一次批量 Judge 调用                            | 与第一阶段“一个 case 评一个最终答案”的作者模型一致                                      | **采纳。** case 级 `expect.judge` 只评最后一轮输出；逐轮评价另设设计                                              |
| `eq/one_of/from` 字面字段抽取                            | 字面精确命中与 AI 分类是正交输入，复用同一静态聚合机即可                                | **采纳。** 在 `expect.decision` 保留字面命中器与可选抽取器，不交给 Judge，也不强制注册为分类 Criterion            |
| 无法识别的字符串 verdict 的兜底                          | 非法字符串不应被猜测为有效裁定，解析规则需要单一且稳定                                  | **保留本仓语义。** 继续使用现有 `judge()` 的 absent/parse 规则                                                    |

### 校准后对当前设计的指导

1. case 级 `expect` 是断言根；`judge` 使用 KV 简写或完整对象，完整对象提供 `timeoutMs`、`maxRetries`、`instructions` 与 KV `rubrics`。
2. `expect.decision.dimensions` 使用 KV，每维恰选 `eq / one_of / verdict / metric`，编译后复用 `AggregationSpec`。
3. 简单模式保持全部通过才 PASS、缺 verdict 为 `[absent]`；decision 模式将单项缺失交给对应维的 absent 映射。
4. decision 存在时，显式维度按声明精调，未引用 rubric 自动形成默认维度，coverage 始终进入报告。
5. Judge 整体调用或解析失败统一进入 `[not-evaluated:<kind>]`，环境失败在聚合前终止。
6. 首版只把最后一轮文本送入一次批量 Judge；具名 verdict 与字面命中结果再由现有聚合机计算 rawScore、归一分、coverage 和逐维明细。

## 本仓落地路径

实施步骤、文件落点与验收命令统一见 [AI 断言完整测试场景 Implementation Plan](../plans/2026-10-31-ai-assertion-complete-scenarios.md)。

1. **默认完整场景：** 新建 `recall-judge-assertion.test.ts` 与 `recall-judge-decision.test.ts`，以 case 级 `expect.judge`、`expect.decision`、固定最终答案和脚本化 Judge transport 覆盖九个场景：简单结果、多轮只评最终回答、精确字面命中、加权否决、absent 映射、混合判据与整体不可评测。
2. **真实 live 冒烟：** 通过显式 token 入口运行明显 PASS 与明显 FAIL，记录 target、Judge 版本、响应解析、清理和脱敏证据。
3. **Judge 质量评估：** 使用固定输出、人工标注开发集与保留集，报告一致率、混淆矩阵、偏差切片、未评测计数和重复裁判翻转率。

## 未验证边界

- 本文只读源码与官方材料，未新增或执行 Recall 测试，未发起真实 provider 调用；简单与 decision 场景的报告细节和脱敏文本需实现时按现有 runner 契约确认。
- 未建立本仓 Judge 的人工 gold set，因而没有人机一致率、偏差切片、重测翻转率或推荐阈值。
- 未验证 temperature=0 在所选真实 provider 上的跨版本确定性，也未验证多 Judge panel；本仓当前没有 panel/reducer。
- 本次未找到 DeepEval 相对上述来源更直接、且能改变本方案的 fake-model 或 Judge 校准方法，因此不以它补充论据；LangSmith 仅用于人工纠正/few-shot 校准证据，不外推其效果。
- MT-Bench 的结论针对开放问答偏好判断，不能直接证明本仓逐 rubric 布尔判断的准确性；这里仅迁移“与人类校准、检查偏差”的方法。

## 来源

以下来源均为本文实际使用的一手材料，访问日期为 2026-10-31 至 2026-11-01：

1. OpenAI Evals，model-graded eval templates：<https://github.com/openai/evals/blob/main/docs/eval-templates.md>
2. OpenAI Evals，`ModelBasedClassify` 实现：<https://github.com/openai/evals/blob/main/evals/elsuite/modelgraded/classify.py>
3. promptfoo，`llm-rubric` 官方文档：<https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/>
4. promptfoo，`handleLlmRubric` 官方测试：<https://github.com/promptfoo/promptfoo/blob/main/test/assertions/llmRubric.test.ts>
5. Inspect AI，model-graded scorer 官方实现：<https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/src/inspect_ai/scorer/_model.py>
6. Inspect AI，model-graded scorer 官方测试：<https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/tests/scorer/test_model_graded.py>
7. Braintrust，Write scorers：<https://docs.braintrust.dev/evaluate/write-scorers>
8. Braintrust，Human review：<https://docs.braintrust.dev/annotate/human-review/>
9. Braintrust，Multiple reviewers：<https://docs.braintrust.dev/annotate/human-review/multiple-reviewers/>
10. LangSmith，How to define an LLM-as-a-judge evaluator：<https://docs.langchain.com/langsmith/llm-as-judge>
11. Zheng et al., “Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena”, NeurIPS 2023 Datasets and Benchmarks：<https://arxiv.org/abs/2306.05685>
12. promptfoo，LLM-as-a-judge 校准、偏差与分层评估工作流：<https://www.promptfoo.dev/docs/guides/llm-as-a-judge/>
13. promptfoo，assertion weight/threshold 与 assert-set：<https://www.promptfoo.dev/docs/configuration/expected-outputs/>
14. Inspect AI，multiple scorers、multi-value scorer 与 reducer：<https://inspect.aisi.org.uk/multiple-scorers.html>
