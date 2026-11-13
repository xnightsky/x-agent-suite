---
title: Recall 断言计分
type: spec
status: active
tags: [spec, recall, scoring]
---

# Recall 断言计分

> 状态：已定稿、已实现的现行契约，位于正式规格目录，不属于 future。本文定义作者 DSL、机械接入、计分、报告、错误与验收；Judge 会话隔离与执行安全另见 [Judge DSL](./recall-judge-dsl.md)。

## 目标与边界

本设计解决“不同效果分别得多少分、如何合并和解释结果”。判断与计分分离：机械判据或 Judge 产出 boolean，框架按作者配置计算贡献，所有细项直接求和。作者不维护第二张维度表，Judge 不自由报分。

- **独立效果**：每个 `judge.<name>` 是一个 boolean rubric，不是一个裁判模型。同一评价点批量裁定，各项单独计分；复合 boolean 不自动获得部分分。
- **统一贡献**：机械与 AI 使用同一套 hit/miss 默认值和求和规则，机械自定义分值须显式 opt-in。
- **分数不放行**：可比较两个 FAIL 的表现，但正分、`miss: 0` 或高分都不能抵消失败；全部已声明断言通过才通过。
- **错误不计低分**：缺少裁定、判据结果畸形与执行/评测错误不能被当作普通 miss 或被其他正分吞掉。

不提供 Decision、weight、threshold、knockout、归一分、分类赋分或评级 DSL。Decision 分数放行仍是 [独立延后需求](./recall-judge-dsl.md#decision-分数验收政策)，不随本文转正。

## DSL 配置说明

### 配置位置与结构

```text
cases[]
├─ turns[].expect                 当前轮完成后、下一次 send 前评价
│  ├─ judge.<name>                AI 简写：{ rubric, score? }
│  ├─ judge.rubrics.<name>        AI 完整形态中的同一项
│  └─ <registered-criterion>      消费者 turn 判据原始输入
└─ expect                         全部轮次后评价
   ├─ judge                       同一 DSL；标准 Judge 只评最后一轮文本
   └─ <registered-criterion>      消费者 session 判据原始输入
```

`scope` 由判据注册决定，不是要填在 score 旁边的 YAML 字段；它只标记评价范围，不参与赋分。机械 session 判据可以使用完整会话，具体读哪些证据由插件定义；不能将此能力误当成标准 Judge 会读取整个历史。

### 字段与默认值

| 字段                                  | 必填/默认             | 类型与约束                         | 作用                                           |
| ------------------------------------- | --------------------- | ---------------------------------- | ---------------------------------------------- |
| `expect.judge.<name>`                 | 声明 Judge 时至少一项 | key 非空且不含点号                 | 稳定的 rubric 名，不再重复声明 name            |
| `rubric`                              | 必填                  | 非空字符串                         | 要求模型独立判断的一个效果                     |
| `score`                               | 可选，等价于 `{}`     | 封闭普通对象，仅允许 hit/miss      | 该 boolean 的贡献配置，不是通过条件            |
| `score.hit`                           | `1`                   | 有限 number，可为正、零、负或小数  | pass=true 时的贡献                             |
| `score.miss`                          | `-1`                  | 有限 number，可为正、零、负或小数  | pass=false 时的贡献                            |
| `expect.<registered-criterion>`       | 按需声明              | 插件自定义的原始输入               | 机械配置，没有框架统一的 score 包装            |
| 示例机械 `expect.contains-text.score` | 可选，默认 1/-1       | `{ hit?: number, miss?: number }`  | 仅该插件显式接入后生效；省略不影响机械断言执行 |
| 注册项 `assertionScore`               | 可选                  | 同步 `(expect) => { hit?, miss? }` | 显式从机械输入中解析贡献配置，不是 YAML 字段   |

省略 score、写 `{}` 都应用默认 1/-1；只覆盖一侧不改变另一侧。AI rubric 项只接受 `rubric/score`，score 不接受字符串、null、数组、NaN、Infinity 或额外字段。分值符号不推导通过状态：负的 hit 或正的 miss 虽然合法，通常会让分数难解释，只有明确需要时才用。

### Judge 完整形态

默认只需简写；需要执行参数时，所有 rubric 放入 `rubrics`，不能混写到同层：

```yaml
expect:
  judge:
    timeoutMs: 30000
    maxRetries: 2
    instructions: 只依据本次提供的回答文本，不推测未展示的工具操作
    rubrics:
      correct:
        rubric: 核心结论是否正确
        score: { hit: 3 }
      explained:
        rubric: 是否给出支持核心结论的理由
        score: { miss: 0 }
```

`rubrics` 为非空 KV；`timeoutMs` 默认 30000，须为正整数，作用于每次 attempt；`maxRetries` 默认 2，须为非负整数，仍受错误类别预算约束；`instructions` 可选，须为非空字符串。`rubrics/timeoutMs/maxRetries/instructions` 是保留键，不能作为简写 rubric 名。score 留在断言侧，不进入 Judge prompt，重试不重复计分。

## 完整示例：机械与 AI 混合计分

以下是完整考卷结构，可保存为 `.recall.yaml`；`contains-text` 是下文注册代码提供的示例判据，不是框架内建名称。执行前仍需按 [Recall 使用方式](../../tutorial/recipes/recall.md) 配置 target、批准与 registry；这些示例不构成真实 provider 调用授权。

```yaml
version: 1
id: mixed-scoring
cases:
  - id: answer-quality
    turns:
      - send: 计算 2+2，给出结论和理由，保持简洁；用“结论”标记答案。
    expect:
      contains-text:
        text: 结论
        score: { hit: 2, miss: 0 }
      judge:
        correct:
          rubric: 结论是否明确给出 2+2=4
          score: { hit: 3, miss: 0 }
        explained:
          rubric: 是否给出支持核心结论的充分理由
          score: { hit: 2, miss: 0 }
        concise:
          rubric: 是否简洁且没有重复表述
```

例如固定输出为“结论：2+2=4。”，机械检查会通过。以下演算假定 correct=true、explained=false、concise=true：

| 结果名            | 来源       | pass  | 使用的配置             | 贡献 |
| ----------------- | ---------- | ----- | ---------------------- | ---- |
| `contains-text`   | mechanical | true  | hit=2，miss=0          | 2    |
| `judge.correct`   | ai         | true  | hit=3，miss=0          | 3    |
| `judge.explained` | ai         | false | hit=2，miss=0          | 0    |
| `judge.concise`   | ai         | true  | hit=1，miss=-1（默认） | 1    |

`rawScore = 2 + 3 + 0 + 1 = 6`，但 case 仍为 FAIL，CLI=0。若四项全部通过，总分为 8；若四项全部失败，总分为 -1。不存在“6 分及格”的隐含政策。换成不同回答时，由 Judge 决定的 boolean 不保证与这些演算假设相同。

## 断言直接计分

```text
本项得分 = pass ? hit : miss
rawScore = 所有断言细项得分之和
casePass = 所有已声明断言细项的 pass 均为 true
```

每个已执行且有效的细项只计一次，不维护显式维度、隐式补维或另一套总分；没有 maxScore、分母或归一化。repeat 各次运行分别保留总分，不把不同重复的贡献拼成一个 case 分数。未声明断言不补零；执行/评测错误不产生正常评分结论。

### 示例：默认值、单侧覆盖与显式零分

下面五项分别展示不同声明，不是五种不同的 Judge：

```yaml
version: 1
id: score-defaults
cases:
  - id: independent-defaults
    turns:
      - send: 给出准确、完整、诚实、简洁且有依据的回答。
    expect:
      judge:
        accurate:
          rubric: 回答是否准确
        complete:
          rubric: 是否覆盖必要信息
          score: {}
        honest:
          rubric: 是否明确说明不确定性
          score: { hit: 3 }
        concise:
          rubric: 是否简洁
          score: { miss: 0 }
        grounded:
          rubric: 结论是否有给出的证据支持
          score: { hit: 0 }
```

| 配置                       | pass=true | pass=false | 注意                         |
| -------------------------- | --------- | ---------- | ---------------------------- |
| 省略 score                 | 1         | -1         | 默认贡献                     |
| `score: {}`                | 1         | -1         | 与省略等价                   |
| `{ hit: 3 }`               | 3         | -1         | 不自动扣 3                   |
| `{ miss: 0 }`              | 1         | 0          | 失败仍为 false，不是可选断言 |
| `{ hit: 0 }`               | 0         | -1         | 只累计失败扣分               |
| `{ hit: 0.5, miss: -2.5 }` | 0.5       | -2.5       | 有限小数同样直接求和         |

### 示例：只扣分，比较两个失败结果

```yaml
version: 1
id: penalty-only
cases:
  - id: quality-defects
    turns:
      - send: 给出准确、完整且简洁的回答。
    expect:
      judge:
        correct:
          rubric: 结论是否准确
          score: { hit: 0, miss: -1 }
        complete:
          rubric: 是否覆盖必要信息
          score: { hit: 0, miss: -1 }
        concise:
          rubric: 是否没有冗余内容
          score: { hit: 0, miss: -1 }
```

全部通过时总分为 0 且 PASS；失败一项时总分 -1 且 FAIL；失败两项时总分 -2 且 FAIL。扩成五个独立机械检查也采用同一算术，但须注册五个判据并分别 opt-in，不能把一项返回 false 的复合检查自动算成五次扣分。

### 示例：逐轮与最终分数累计

```yaml
version: 1
id: turn-scoring
cases:
  - id: staged-answer
    turns:
      - send: 先说明你掌握的信息与不确定性。
        expect:
          judge:
            clear:
              rubric: 是否清楚区分已知信息和不确定性
              score: { hit: 2 }
      - send: 基于已知信息给出清楚的最终结论。
    expect:
      judge:
        clear:
          rubric: 最终结论是否清楚
          score: { hit: 3 }
```

首轮先评价再发送第二轮，case Judge 在全部轮次完成后只评最后一轮；这是两个独立批次，不复用裁定。结果名分别为 `turn.0.judge.clear` 与 `judge.clear`，同名不覆盖。两项通过贡献 2+3=5；首轮失败、最终通过贡献 -1+3=2，但 case 仍 FAIL。首轮评测错误则不再 send 第二轮，也不计算正常总分。完整归因规则见 [轮次级断言](./recall-turn-assertion.md)。

## 机械判据的完整接入

### 机械 DSL：score 是可选字段

对于下文显式支持分值解析的 `contains-text`，作者输入是 `text` 加可选的 `score?: { hit?: number, miss?: number }`。**不写 score 完全合法：机械断言照常执行，通过贡献 +1，失败贡献 -1。**

| 机械输入中的 score 配置       | 通过贡献 | 失败贡献    |
| ----------------------------- | -------- | ----------- |
| 省略 `score`                  | +1       | -1          |
| `score: {}`                   | +1       | -1          |
| `score: { hit: 3 }`           | +3       | -1          |
| `score: { miss: 0 }`          | +1       | 0，仍未通过 |
| `score: { hit: 2, miss: 0 }`  | +2       | 0，仍未通过 |
| `score: { hit: 0, miss: -1 }` | 0        | -1          |

AI 与机械没有两套默认值；可选的是分值配置，不是该机械断言是否必须通过。这个可选字段属于插件明确支持的输入协议，不能据此给所有历史机械输入强加 score；未 opt-in 的判据仍按默认 1/-1 贡献。下面先给注册实现，再给上述各形态的完整 YAML。

### 示例 registry：保留插件输入，只显式接入分值

保存为 `score.registry.ts`，通过现有 `--registry` 选项加载。它校验输入，并真实检查最终输出是否包含声明文本，不使用恒为 true 的占位实现：

```ts
/** 示例消费者注册表：只读最终轮文本，不启动 Driver 或联网。 */
import { parseAssertionScore } from "@x-agent-suite/assertions";
import type {
  RecallCriterionRegistration,
  RecallRegistry,
} from "@x-agent-suite/recall";

function inputOf(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("contains-text 输入必须是对象");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "text" && key !== "score")) {
    throw new Error("contains-text 存在未知字段");
  }
  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    throw new Error("contains-text.text 必须是非空字符串");
  }
  return { text: input.text, score: input.score };
}

const containsText = {
  name: "contains-text",
  scope: "session",
  assertionScore: (expect: unknown) => {
    const { score } = inputOf(expect);
    return parseAssertionScore(score === undefined ? {} : score);
  },
  evaluate(session, context) {
    const last = session.turns.at(-1);
    if (session.exhausted || !last) throw new Error("缺少完整的最终输出");
    const { text } = inputOf(context.expect);
    const pass = last.text.includes(text);
    return {
      pass,
      score: pass ? 1 : 0,
      reason: pass ? "最终输出包含声明文本" : "最终输出缺少声明文本",
    };
  },
} satisfies RecallCriterionRegistration;

/** 示例 registry：同一判据也可通过通用工厂注册，resolver 协议不变。 */
const registry: RecallRegistry = {
  criteria: [containsText],
  profiles: {},
  effectsProfiles: {},
};
export default registry;
```

- `assertionScore` 仅对实际引用，在装配期按 execution、scenario、scope 与出现位置同步解析并缓存；运行、重试和报告不再次调用 resolver。
- resolver 读取原始 expect，必须返回只含 hit/miss 的同步普通对象；省略分值时返回 `{}`。不能返回 undefined、null、数组、Promise、额外字段或非有限数，也不能联网、启动 Driver。
- 误返回 Promise 时立即按定义错误拒绝，不等待异步完成；其后续拒绝不产生未处理异常，不得覆盖 CLI=2 或泄漏原始异常堆栈。
- `evaluate` 返回的 `score` 仍是 0..1 标准分，不是 YAML 配置的贡献；不能返回 2 或 -1 来代替 resolver。
- `text` 和 `score` 是这个示例插件自己的输入协议，不是所有机械判据必须接受的字段；真实输入格式和校验由插件负责。

### 完整 YAML：机械 score 的省略、空对象与部分覆盖

下面仅使用已注册的 `contains-text`，不调用 Judge：

```yaml
version: 1
id: mechanical-scoring
cases:
  - id: default-score
    turns:
      - send: 请写出“结论”。
    expect:
      contains-text:
        text: 结论
  - id: custom-score
    turns:
      - send: 请写出“结论”。
    expect:
      contains-text:
        text: 结论
        score: { hit: 2, miss: 0 }
  - id: empty-score
    turns:
      - send: 请写出“结论”。
    expect:
      contains-text:
        text: 结论
        score: {}
  - id: hit-only
    turns:
      - send: 请写出“结论”。
    expect:
      contains-text:
        text: 结论
        score: { hit: 3 }
  - id: miss-only
    turns:
      - send: 请写出“结论”。
    expect:
      contains-text:
        text: 结论
        score: { miss: 0 }
  - id: penalty-only
    turns:
      - send: 请写出“结论”。
    expect:
      contains-text:
        text: 结论
        score: { hit: 0, miss: -1 }
```

以上六个 case 与机械配置表逐项对应：default-score 和 empty-score 均为 +1/-1，custom-score 为 +2/0，hit-only 为 +3/-1，miss-only 为 +1/0，penalty-only 为 0/-1。若从注册项移除 `assertionScore`，Recall 不再解释该插件的 `input.score`，所有 case 都按默认 +1/-1 贡献；插件是否接受该字段仍由插件协议决定，不是框架替它保证兼容。

历史判据若接收数组或标量，保持原输入，不得为了通用 score 加一层强制包装。例如消费者已有 `required-terms: [结论, 证据]`，没有 resolver 时按整体 boolean 默认 +1/-1；想配置不同分值，应由该插件另行声明兼容的解析协议，不在数组后拼装 score，也不从项数推导贡献次数。

## 执行流程与报告契约

```text
YAML 解析/封闭校验 → 判据引用与 scope 校验 → resolver 预检缓存
  → 创建主执行 → 当前轮观测 → 本轮机械/批量 Judge → 下一轮
  → case 机械/最终批量 Judge → 验证原始结果
  → 每个 boolean 计算贡献 → 统一求和与报告投影
```

Assertions 提供 rubric 结果展开、score 校验和贡献原语；Observation 校验 boolean pass、字符串 reason 与 0..1 有限标准分；Recall 负责 DSL、评价点、registry 装配、缓存与报告，不维护第二套断言引擎。通用聚合机的 weight、归一分和缺席映射不是本 DSL，不能混用。

| 报告位置                       | 内容                                                       | 不变量                                          |
| ------------------------------ | ---------------------------------------------------------- | ----------------------------------------------- |
| `result.hardPass`              | 原始全部断言判断                                           | 不按 rawScore 重算                              |
| `result.artifact.outcomes[]`   | name、scope、turnIndex（逐轮时）、pass、reason、原始 score | 原始 score 保持 0..1                            |
| `result.artifact.assertions[]` | name、source（mechanical/ai）、pass、reason、score         | 这里的 score 是 hit/miss 贡献，可以为负或大于 1 |
| `result.artifact.rawScore`     | 全部细项贡献之和                                           | 不包含另一层成绩                                |

以下是混合示例结果的**节选**，只保留 explained 项，总分仍对应全四项，不是该节选的求和：

```json
{
  "hardPass": false,
  "artifact": {
    "outcomes": [
      {
        "name": "judge.explained",
        "scope": "session",
        "pass": false,
        "score": 0,
        "reason": "未给出充分理由"
      }
    ],
    "assertions": [
      {
        "name": "judge.explained",
        "source": "ai",
        "pass": false,
        "reason": "未给出充分理由",
        "score": 0
      }
    ],
    "rawScore": 6
  }
}
```

终端的 `-vv` 明细用 `score` 显示原始标准分、`contribution` 显示实际贡献；例如 correct 通过时 `score=1 contribution=3`。逐项结构化报告中的 `assertions[].score` 对应后者。完整机械/AI 明细不因本示例节选而省略，实际失败原因仍保留。

## 错误、反例与兼容性

### 非法 DSL 反例

以下 YAML 片段**必须拒绝**，不能把 null 解释为默认值：

```yaml
# INVALID: miss 不是有限数
expect:
  judge:
    correct:
      rubric: 结论是否正确
      score: { miss: null }
```

| 配置/情况                                        | 结果                 | 拒绝或保留原因                       |
| ------------------------------------------------ | -------------------- | ------------------------------------ |
| `score: { weight: 2 }`                           | 定义错误，CLI=2      | score 只接受 hit/miss，不叠加 weight |
| `score: { hit: "3" }`、`.inf`、`.nan`            | 定义错误，CLI=2      | 不转换字符串，分值必须有限           |
| `score: null`、`score: []`                       | 定义错误，CLI=2      | 不等价于省略或空对象                 |
| rubric 缺文本、空名称、名称带点号、重复 YAML key | 定义错误，CLI=2      | 名称和 schema 必须有效               |
| 完整 Judge 同层混入具名 rubric                   | 定义错误，CLI=2      | 使用 rubrics 容纳全部项              |
| 机械判据未注册或 scope 不匹配                    | 定义错误，CLI=2      | 不启动主 Driver，不能静默漏评        |
| resolver 非法返回或抛错                          | 定义错误，CLI=2      | 预检失败，不启动主 Driver            |
| 机械内容不匹配、合法 Judge 返回 false            | 内容失败，CLI=0      | 按 miss 贡献，但 case 未通过         |
| 缺裁定、畸形判据结果、调用/解析/超时错误         | 执行/评测错误，CLI=1 | 不按 miss/0 分伪装正常结果           |
| `expect.decision`                                | 定义错误，CLI=2      | 当前没有作者 Decision DSL            |

既有不写 score 的考卷保持默认 1/-1；历史插件字段原样透传，未 opt-in 不抢占 `input.score`；原始 CriterionOutcome 与通用 Judge/聚合机公共调用保持不变。可选的是分值配置，不是断言是否必须通过。评分配置或 rubric 变化后，rawScore 的尺度随之变化，不应直接横比不同评分版本或不同检查集合的原始总分。

## 验收与未验证范围

零 token 验收必须同时覆盖：

1. 简写/完整 Judge、turn/case 位置、保留键与严格 schema。
2. 省略、空对象、独立默认、显式零分、负分与有限小数。
3. 独立 rubric 的不同贡献、只扣分、机械/AI 混合及正总分仍 FAIL。
4. 机械输入校验、显式 opt-in、未接入默认、resolver 预检缓存与错误前置。
5. 逐轮时机、同名归因、跨轮累计、repeat 独立、错误后停止与清理。
6. 原始标准分不变、贡献与 rawScore 对齐、失败原因和错误不被分数覆盖。

现有回归入口为 `packages/assertions/tests/score.test.ts`，以及 `packages/recall/tests/` 下的 `recall-assertion-scoring.test.ts`、`recall-mechanical-scoring.test.ts`、`recall-judge-schema.test.ts`、`recall-judge-assertion.test.ts`、`recall-turn-assertion.test.ts`。机械配置矩阵须通过官方 CLI 验证六种配置及有限小数、turn/case、repeat 独立、resolver 缓存、未 opt-in 默认贡献，以及标准分与贡献分离；非法异步 resolver 同时验证 CLI=2、零主执行与异常不泄漏。文档示例还须经真实解析/编译、示例 registry 类型检查与固定 boolean 的计分核验，不能只证明 YAML 可解析。

真实 token 接线验收使用独立的 [评分合成考卷](../../../integrations/itrepos/recall-scoring/README.md)，显式入口为 `pnpm ittest:token:recall-scoring`，不进入默认回归。只选择一个已批准 target、repeat=1、Judge 零重试，验证真实主输出、turn/case Judge、机械/AI 贡献与 PASS/FAIL 报告；退出 0 不能替代预期细项和总分检查。

2026-11-09 的限定真实验证见上述考卷的实测记录：真实主执行与 turn/case Judge 经 Pi borrowed 路径调用单一已批准 provider/model，复验得到正例 6 分 PASS、负例 5 分 FAIL，逐项原始分与贡献、原生 usage 和资源清理均已核对。首轮原始 Judge JSON 曾出现 boolean 与理由矛盾，明确 rubric 通过条件后的复验不能抹去该失败。

这只证明该目标下的合成接线与计分，不证明真实 Judge 准确率、模型稳定性、其他渠道或所有消费者机械插件接入；作者体验与模型方差仍需单独验证。固定 boolean 算例和 fake 接线更不能替代这些证据。

## 组合断言与计分

`turn.expect` 与 `case.expect` 的 `allOf/anyOf/firstOf` 契约统一见 [Recall 组合断言与计分](./recall-composition-scoring.md)。组合原语、DSL、诊断与 repeat/suite 汇总已实现，默认零 token 回归与可运行考卷已交付；真实 token 验收仍待授权。

普通兄弟断言仍全部执行且必过；组合内部原始失败只保留为诊断，不摊平成额外套层计分项。执行、缺裁定与清理错误始终走 ERROR，不被任何组合结果吞掉。evidence 节点、平铺 rubric 和主执行线性顺序保持原义。

新行为不能凭既有 firstOf 的真实 token 回执视为已验收。实现收口须同时通过默认零 token 回归与另行授权的真实 token 验收；报告、进度、repeat/suite 和错误诊断同属交付范围。
