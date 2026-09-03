# Scenario 评分与报告

## 目标

用 fixture 驱动一个真实 Agent CLI 完成端到端场景：让它调用被测系统的某个工具，并通过外部证据验证结果。

## Observation 与 ArtifactEvidence

借鉴评测实践的验证体系设计：把宿主输出归一成 `Observation`，把外部状态作为独立的 `ArtifactEvidence`，两者分开评分。

### Observation

`Observation` 定义见 [contracts.md](./contracts.md)。所有 driver 统一返回该类型。

关键字段：

- `toolCalls`：该轮内发生的工具调用（含入参）。
- `toolCallsCount`：工具调用总数。
- `steps`：模型轮数（不是工具调用数）。
- `status`：每个 `ToolCall` 携带宿主报告的状态，用于区分「调用过」与「调用成功」。
- `events`：底层事件流，供排查。

### ArtifactEvidence

消费者自定义的证据类型，例如文件系统状态、数据库记录、被测系统侧查询结果。框架只透传，不认识语义。

```ts
export interface ScenarioResult {
  observation: Observation;
  evidence: unknown; // 消费者自定义的 ArtifactEvidence
  dryPass: boolean;
  hardPass: boolean;
  fuzzyPass: boolean;
  enumerate?: { hallucinated: string[]; missing: string[] };
  latencyMs: number;
  costUsd?: number;
  error?: string;
}
```

## 评分层

借鉴评测实践的分层评分：先硬判，后模糊，最后才 LLM judge。

| 层               | 例子                                                                  | 实现                 |
| ---------------- | --------------------------------------------------------------------- | -------------------- |
| **Dry contract** | fixture 结构合法、fake provider 能启动、工具 schema 正确              | `dryChecks()`        |
| **Hard**         | 期望工具被调用**且 `status === "completed"`**、入参正确、外部证据匹配 | `hardChecks()`       |
| **Fuzzy**        | 返回文本包含 `done=true`                                              | regex / contains     |
| **LLM judge**    | 模型回复是否自然                                                      | 可选，`--judge` 模式 |

默认 Dry + Hard 必须全过；Fuzzy 兜底；LLM judge 仅人工评估时开启。

## 执行不变量

从实际 runner 实践中沉淀的硬约束。违反不会立即抛错，但会污染评估结果。

| 不变量                            | 含义                                                             | 违反后果                           |
| --------------------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| **源 fixture 只读**               | `scenarios/` / `fixtures/` 只读；一切写操作发生在 sandbox        | 源被污染 → 评估不可复现            |
| **写任务 record→verify→rollback** | 写操作前记录 before → 操作 → 用 after 校验 → rollback → 重建状态 | 场景不可幂等重跑                   |
| **dry / live 语义清晰**           | dry 只跑确定性层；live 才调用真实模型/宿主                       | 误以为跑了 live，实际 dry          |
| **trace 优先，stdio 兜底**        | 有结构化事件就以它为准；损坏/缺失才退回刮 stdout/stderr          | 单位错配（把工具调用数当模型轮数） |
| **确定性层 vs 行为层退出码分离**  | 仅 schema/环境/崩溃使进程非零退出；AI 行为项不参与               | 把波动当失败，CI 假红              |
| **error-storm / 撞顶判失败**      | 连续工具失败达阈值或撞 `maxSteps` 均判该场景失败                 | 死循环被当成「完成」               |

## 评估数据流

一次 scenario 从驱动到报告的数据路径：

```text
driver 事件流 / trace
→ Observation（结构化）
→ dry / hard / fuzzy / enumerate 判据
→ ScenarioResult
→ md + json 报告
```

关键口径：

- **steps 与 toolCalls 是两个单位**：`steps` = 模型轮数，`toolCallsCount` = 工具调用总数。一轮可并行多调，因此恒有 `toolCallsCount ≥ steps`。
- **证据必须在 sandbox 销毁前采集**。文件态、游标、数据库记录在 cleanup 后不可复得。
- ** grounding 时序**：首次需要某外部状态之前，是否已先查询过该状态。先撞错再补取不算成功。

## 列举类核对（enumerate）

模型列出的**每一条**都要和真实状态核对，不能只靠正则查「某条在不在」。

```ts
export interface EnumerateCheck {
  extract: RegExp;
  requireComplete: boolean;
}

export interface EnumerateResult {
  hallucinated: string[];
  missing: string[];
}
```

- `hallucinated`：列出来但实际不存在的 id；
- `missing`：存在但没列出来的 id（`requireComplete=true` 时检查）。

## Fixture 脚本结构

自研 fake provider 的 fixture 不是「请求/响应对」，而是一份**按轮次的脚本**（`FixtureTurn[]`）。轮次由请求体判定，不用全局计数器。

```ts
const script: FixtureTurn[] = [
  { toolCall: { name: "someTool", args: { target: "B", payload: "hello" } } },
  { text: "已完成操作。" },
];
```

工具名由 profile 补齐：

```ts
const wireName = profile.toolName("myServer", call.name);
const wireNamespace = profile.toolNamespace?.("myServer");
```

同一份脚本可跨宿主复用，这是把工具命名收敛到 `HarnessProfile` 的直接收益。

## Live 模式与评估

Live 模式下不限制模型输出，只评估**是否完成目标**。

| 指标               | 计算方式                                |
| ------------------ | --------------------------------------- |
| `toolCallAccuracy` | 是否调用了期望的 tool，参数是否满足约束 |
| `completionRate`   | 场景是否走到最终状态                    |
| `latencyMs`        | 从 sendPrompt 到结果返回耗时            |
| `costUsd`          | 从响应 usage 字段估算                   |
| `exhaustedRate`    | `Observation.exhausted === true` 的比例 |
| `errorCategory`    | 无 tool call / 参数错误 / 超时 / 异常   |

Live 模式断言 model-agnostic：不断言具体文本，只断言行为形态。

## 报告格式

每次跑同时出 `.md` 结论和 `.json` 明细：

```text
.tmp/xas-reports/
├── <stamp>-<encoded-scenario>-report.md
└── <stamp>-<encoded-scenario>-report.json
```

`scenarioId` 在文件名中使用 URI 编码压成单个安全段；JSON/Markdown 内容仍保留原始 ID。带 `/` 的约定 ID 不会创建隐式子目录，`../` 也不能逃逸输出目录。

`.tmp/` 不入库。报告内容：

- scenario / carrier / prompt 变体；
- `dryPass` / `hardPass` / `fuzzyPass`；
- `toolCalls`（含入参）；
- `enumerate` 结果；
- `latencyMs` / `costUsd`；
- `stdoutTail` / `stderrTail`（排查用）。

## 文件清单

```text
packages/observation/src/
├── checks.ts         # dry / hard / fuzzy / enumerate
└── report.ts         # md/json 报告生成

packages/contracts/src/
├── observation.ts    # Observation / ScenarioResult 类型
└── checks.ts         # HardExpectation / EnumerateCheck
```

## 验收标准

- 三端各自在 fixture 模式下完成一个基础场景（同一份 `FixtureTurn[]` 脚本跨端复用）。
- 断言基于 `ToolCall.status` 与消费者自定义证据，**不依赖退出码或末条文本**。
- 列举类场景使用 `enumerate` 核对，不依赖正则。
- 生成 `.md` + `.json` 报告到 `.tmp/xas-reports/`。
