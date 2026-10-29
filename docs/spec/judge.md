# 通用 AI Judge

## 目的与边界

`@x-agent-suite/judge` 提供“批量 rubric → 具名 boolean verdict”的通用执行器。它回答的是“答案是否满足各项判断依据”，不回答“场景得多少分”。

核心不变量：

- AI 只产出 `{ name, pass, reason }`，不产出 score、confidence、threshold 或 overall pass。
- 单项缺失/无法识别进入 `absent`；整体调用或解析失败进入 `not-evaluated`，两者不得混为内容失败。
- Judge 不实现 Criterion，不接 Recall、decision、Aggregation、报告落盘或跨 case 调度。
- direct 与 borrowed 由 TargetTags 决策；唯一候选可自动选择，多候选须显式 mode/cliRef，任何失败都不跨 mode fallback。
- 包内不包含具体宿主、被测系统、消费者字段或领域判据名。

## judge() 公共接口

```ts
import { judge } from "@xnightsky/x-agent-suite/judge";

const outcome = await judge(
  {
    output: answer,
    rubrics: [
      { name: "requirement_met", rubric: "答案是否满足全部要求？" },
      { name: "bounded", rubric: "答案是否保留关键边界？" },
    ],
  },
  { client, timeoutMs: 30_000, maxRetries: 2 },
);
```

### 参数

| 参数                 | 类型 / 缺省                 | 必填 | 语义与约束                                           |
| -------------------- | --------------------------- | ---- | ---------------------------------------------------- |
| `input.output`       | `string`                    | 是   | 被评判的完整文本；Judge 不读文件、不自行取得答案。   |
| `input.rubrics`      | `readonly JudgeRubric[]`    | 是   | 非空；每次 attempt 全部进入一个批量调用。            |
| `rubrics[i].name`    | 非空、清单内唯一字符串      | 是   | verdict 的稳定关联键，不枚举领域词表。               |
| `rubrics[i].rubric`  | 非空字符串                  | 是   | 一项独立判断依据，Judge 不解释领域语义。             |
| `options.client`     | `JudgeModelClient`          | 是   | 模型调用 seam；核心不创建默认客户端。                |
| `options.prompt`     | `{ instructions?: string }` | 否   | 省略使用完整 judge-v1；instructions 仅追加场景约束。 |
| `options.timeoutMs`  | 正整数，缺省 `30_000`       | 否   | 每次 attempt 独立超时；到时先 abort 并等待清理。     |
| `options.maxRetries` | 非负整数，缺省 `2`          | 否   | 首次调用后的重试上限，再与错误类别预算取较小值。     |

`JudgeModelClient.complete` 只接收核心生成的 `prompt` 和当前 attempt 的 `signal`，返回未解析的 `text`。客户端不得替核心解析 verdict、计算分数或静默重试。

所有可省略项都有明确默认值：`prompt` 为现有 judge-v1、`timeoutMs=30_000`、`maxRetries=2`、工厂的 `toolPolicy=none`、`liveReviewApproved=false`，`mode/cliRef` 只在唯一候选时自动确定，direct transport 缺省为现有 fetch。`client/target/tags` 以及选中 borrowed 后的 `createDriver` 没有默认值，避免隐式发起 live 或猜用宿主执行路径。

省略 `prompt` 或传入 `prompt: {}` 会产生完全相同的默认 prompt。`prompt.instructions` 只在完整 judge-v1 之后追加场景约束，不能替换 boolean verdict、JSON 结构或“AI 不出分”的要求。

核心函数刻意不接收 `carrier/provider/model/apiKey/baseUrl/from/credential/driver/decision/weight`：模型目标归客户端工厂，打分声明归消费者。

### 返回结果

```ts
type JudgeOutcome =
  | {
      status: "completed";
      verdicts: readonly { name: string; pass: boolean; reason: string }[];
      absent: readonly string[];
      attempts: number;
    }
  | {
      status: "not-evaluated";
      failure: { kind: JudgeFailureKind; message: string };
      attempts: number;
    };
```

先按 `status` 判别。`completed` 只表示调用与整体解析完成，**不表示内容通过**；全部 rubric 都 absent 也仍是 completed。没有 overall pass、score 或 threshold。

## 客户端工厂与 TargetTags 决策

`createJudgeClient(options)` 通过通用 `decideLiveTarget` 评估完整 target，不再维护逐渠道 `allowedModes` 或 Judge 专用渠道注册表：

| 参数                 | 适用 mode | 必填     | 语义与约束                                                            |
| -------------------- | --------- | -------- | --------------------------------------------------------------------- |
| `target`             | 两者      | 是       | 现有 resolver 产出的完整 `(carrier, provider, model)`，不做二次选择。 |
| `tags`               | 两者      | 是       | 同一个 `TargetTagCatalog`，含四层公共实例与可选私密覆盖。             |
| `mode`               | 两者      | 否       | 仅唯一候选时可省略；多候选必须显式指定。                              |
| `cliRef`             | borrowed  | 否       | 多 profile 时与 mode 共同唯一确定评估项。                             |
| `toolPolicy`         | 两者      | 否       | 缺省 `none`；`read-only` 只允许 borrowed。                            |
| `liveReviewApproved` | 两者      | 否       | 仅表示本次已获显式审批，不是永久授权。                                |
| `config`             | 两者      | 否       | 现有 `LiveConfigOptions`，携带 env/homeDir/borrow hooks。             |
| `transport`          | direct    | 否       | 自定义/测试传输，缺省使用现有 fetch transport。                       |
| `createDriver`       | borrowed  | 选中后是 | 每次 attempt 创建符合 toolPolicy 的全新隔离 driver。                  |

候选选择固定为：

1. 按 TargetTags、toolPolicy、live 和显式 mode/cliRef 过滤；
2. 恰好一个候选才创建 client；无候选、多候选未明确或 cliRef 不匹配均在任何 start/网络/driver 前抛定义错误；
3. 不根据是否提供 `transport/createDriver` 猜选模式；
4. 遗留 `allowedModes` 显式拒绝，执行失败不跨 mode fallback。

工具策略：

| toolPolicy  | 候选要求                                                      | 执行行为                                                                             |
| ----------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `none`      | borrowed 需要 `cli.tools.none`                                | 保留既有协议：任何工具调用都失败。                                                   |
| `read-only` | 仅 borrowed，需要 `cli.tools.allowlist + cli.tools.read-only` | 允许保留工具证据；createDriver 必须兑现实际只读策略，不得降级 direct 或 tools.none。 |

direct 需要 `provider-model.api.complete`、`model.inference.chat` 和 API 类 usage。borrowed 需要 one-shot、unattended、ephemeral、context-files/extensions/skills.off、chat，以及 text 或 jsonl 输出，不按非 live 的 usage 计费分类过滤；live 审批与其余能力要求保持不变。`from/credential` 只描述来源，不等于 usage 或 live 授权。

`JudgeClient.mode + target + cliRef` 供报告归因；不同 mode 的结果不得默认可比。

`target.channelCarrier`（来自 `channelsFrom`）仅作为 `LiveBackend` 的借用渠道与凭据来源，backend carrier 为 `channelCarrier ?? carrier`；显式 `channel.harness` 仍优先于该来源。`target.carrier` 与 `JudgeClient.target` 始终保留原执行归因，不改写 target 对象。借用来源缺失或端点不一致必须在模型请求前显式失败，不跨渠道 fallback。

## 与现有模型配置组合

配置解析仍由调用方负责：

1. `loadLiveConfig` 读取现有配置并注入 borrow hooks；
2. `resolveLiveTargets` 得到完整 target；
3. `loadTargetTagCatalog({ liveConfig, homeDir })` 合并公共实例、home 私有全局实例与同文件可选私密覆盖；
4. `createJudgeClient` 按 TargetTags 唯一候选创建客户端；
5. `judge()` 执行。

```ts
import {
  loadLiveConfig,
  loadTargetTagCatalog,
  resolveLiveTargets,
  type LiveTargetSelection,
} from "@xnightsky/x-agent-suite/llm-fixture";
import {
  createHarnessDriver,
  createHarnessLiveConfigHooks,
} from "@xnightsky/x-agent-suite/harness";
import { createJudgeClient, judge } from "@xnightsky/x-agent-suite/judge";

const selection: LiveTargetSelection = consumerSelection;
const config = {
  env: process.env,
  ...createHarnessLiveConfigHooks(),
};
const loaded = await loadLiveConfig(config);
const resolved = resolveLiveTargets(loaded, selection);
if (resolved.kind !== "configured") {
  throw new Error(`Judge 模型目标未配置：${resolved.reason}`);
}
if (resolved.targets.length !== 1) {
  throw new Error("一次组合要求唯一 target；多 target 由调用方逐个编排");
}
const target = resolved.targets[0]!;
const tags = await loadTargetTagCatalog({ liveConfig: loaded });

const borrowedClient = createJudgeClient({
  target,
  tags,
  mode: "borrowed",
  toolPolicy: "none",
  config,
  createDriver: ({ backend }) =>
    createHarnessDriver(consumerProfile, backend, {
      serverEntry,
      allowedTools: [],
    }),
});
const outcome = await judge(
  { output: answer, rubrics },
  { client: borrowedClient, timeoutMs: 60_000, maxRetries: 2 },
);

// direct 是另一种显式选择，不是 borrowed 失败后的 fallback。
const directClient = createJudgeClient({
  target,
  tags,
  mode: "direct",
  config,
});
```

上述 directClient 仅演示替代组合，不与 borrowedClient 串联执行。多 target 时由调用方逐个创建 client、调用并记录 `mode + target + cliRef`。resolver 的 not-configured 在创建 client 前处理；工厂定义错误直接抛出；start 后的执行失败才进入 `JudgeOutcome.not-evaluated`。

## 场景、TargetTags 与 token 验收

不同 Judge 形态不得共享一套模糊标签要求。场景、静态能力和真实证据按下面分别验收：

| 场景                    | 必需 TargetTags                                                                                                                          | 执行与 token 证据                                                                                | 当前状态                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| direct 自定义 client    | `model.inference.chat`、API 类 usage、live；当前工厂另需 `provider-model.api.complete`，其他 client 自己声明 API 需求                    | 真实 API 完成一次 verdict，校验认证、usage、live、响应解析与清理，不检查 CliTags                 | 本次未覆盖，需另选明确允许 direct 的账号/target |
| borrowed 纯文本 verdict | one-shot、unattended、ephemeral、context-files/extensions/skills.off、`cli.tools.none`、chat、live、text/jsonl；不按非 live 计费分类过滤 | 真实 CLI 无会话、无上下文/扩展/skills/工具污染，一次 verdict，无重试/并发/fallback，finally 清理 | `client-live.token.ittest.ts` 精确入口覆盖      |
| borrowed 只读证据       | 与纯文本相同的干净基线，但以 `cli.tools.allowlist + cli.tools.read-only` 替代 tools.none                                                 | 真实 driver 执行只读证据读取，证明无写入、最终 verdict 与清理；缺 tag/策略不得降级               | 当前未验证；Pi 公共实例尚无 read-only 证据      |

client 也可先读取证据再注入 prompt，此时模型侧仍是纯文本 `tools.none`，不得为了给模型 bash 而放宽工具权限。中文、title + body + filepath 等输出格式属于具体 prompt/rubric，不属于 TargetTags。

本次纯文本 token 入口只覆盖获批的 `pi / kimi-coding / kimi-for-coding`、`third-party-subscription`、`live.review-required + 本次批准`：

```bash
XAS_JUDGE_LIVE_AUTHORIZATION=I_ACCEPT_LIVE_COST_AND_DATA_EGRESS \
XAS_JUDGE_LIVE_USAGE=third-party-subscription \
pnpm ittest:token:judge
```

该命令会产生真实 token、费用和数据出站。测试使用单个最小 rubric、`maxRetries=0`，最多一次真实 provider 调用，不并发、不 fallback。临时配置只含 `from: harness` 和 targetTags，不复制端点或凭据；真实渠道/登录态由现有 hooks 只读借用。缺授权值、配置、凭据或宿主时显式 skip，临时目录与进程在 finally 清理，诊断输出经过脱敏。

### direct

每个 attempt 新建 `LiveBackend`：

- `start()` 解析凭据和 redactor；
- 以单条 user message 调 `complete`，不声明 tools，并透传当前 `AbortSignal`；
- 返回工具调用按 `protocol` 失败；
- `finally stop()`，清理失败归为 `cleanup`。

### borrowed

每个 attempt 以新 backend 调用消费者 `createDriver`：

- 预先 abort 的 attempt 在 factory/start/send 之前直接拒绝，不创建 driver、不产生副作用；
- `driver.start()` 后只调用一次 `sendPrompt(prompt)`；start 挂起期间 abort 仍会 close，start 返回后必须再次检查 `signal`，已取消 attempt 不得再 `sendPrompt`；
- 已进入 `sendPrompt` 后 abort 只做 `close`，不回退也不隐式重试；
- `toolPolicy: "none"` 时，`toolCallsCount > 0` 或 `toolCalls` 非空按 `protocol` 失败；
- `toolPolicy: "read-only"` 时允许保留工具证据，`createDriver` 接收本次 `cliRef + toolPolicy` 并必须兑现实际只读策略；
- 成功、失败和 abort 都在 `finally close()`；
- 每次重试必须使用全新 driver，不能复用失败会话。

工厂必须兑现单次、隔离、no-session、禁工具契约。通用类型无法证明宿主没有历史上下文，消费者需用专用 profile 和集成测试证明；Judge 运行时拒绝工具调用只是最后一道检查。

## Prompt 与逐项解析

每次 attempt 将全部 rubrics 放进同一个 `policy: judge-v1` 调用，要求只返回：

```json
{
  "requirement_met": { "pass": true, "reason": "满足全部要求" },
  "bounded": { "pass": false, "reason": "遗漏关键限制" }
}
```

解析规则：

- 抽取第一个括号平衡的 JSON object，容忍围栏、前后散文和字符串内 braces。
- 无 object、坏 JSON、数组或非对象根是整体 `parse` 失败。
- 仅按输入 name 和顺序产出；未知额外键忽略。
- 支持 boolean 简写，以及 `true/yes/pass/y` 字符串（忽略大小写）。
- object 读取 `pass` 和可选 string `reason`；无法识别的 pass、缺项或非法值进入 `absent`。
- `score/confidence` 不会转换为分数或 pass。

## 超时、重试与失败分层

每次 attempt 独立计时。超时先 abort，等待客户端完成清理后才允许重试；direct 每次新 backend，borrowed 每次新 driver。退避为 1s、2s、4s，单次最高 8s。

| 类别             | 自动重试预算 | 语义                         |
| ---------------- | -----------: | ---------------------------- |
| `rate-limited`   |            2 | 同 target、同 mode，不切渠道 |
| `transport`      |            1 | 可恢复传输错误               |
| `timeout`        |            1 | abort 并清理后重试           |
| `not-configured` |            0 | 无配置或凭据                 |
| `empty-response` |            0 | 空响应，不放大 token 消耗    |
| `parse`          |            0 | 整体不可解析                 |
| `protocol`       |            0 | 工具调用等协议违反           |
| `cleanup`        |            0 | 清理状态不明                 |
| `client`         |            0 | 未分类客户端错误，保守处理   |

定义错误（空/重名 rubric、非法 timeout/retry、缺 client、遗留 allowedModes、无候选、多候选未明确、cliRef 不匹配、direct + toolPolicy=read-only、live 未放行等）在调用前抛 `JudgeDefinitionError`，不返回 outcome。执行失败返回 `not-evaluated`，不得转换成 `pass=false` 或 score=0。诊断不得携带完整 prompt、完整响应、认证头或凭据。

Judge 与 Assertions 来自独立公开 bundle 时，`JudgeModelError` 仍保留已知类别与对应重试预算。跨 bundle 识别必须同时满足内部共享品牌、Error 身份、已知 `kind` 与字符串 `message`；仅凭 `name/kind` 的伪造对象、畸形实例和未知普通错误仍归为 `client`，不重试并继续使用脱敏诊断。内部识别器不新增公开 API。

## 与 Criterion、decision、Recall 的关系

Judge 的结果不是 `CriterionResult`。可用 `@x-agent-suite/assertions` 的 `createJudgeAssertion` 适配为 `TurnCriterion`，或由消费者自行映射；该薄适配按每轮 `expect: JudgeRubric[]` 取规则，缺证据与不可评测显式抛错。若需聚合，再把结果交给静态聚合机。weight、threshold、knockout、decision 和 absent 计分映射均不在 Judge 内。

公开入口已支持 `createJudgeClient({mode:"borrowed"}) + profiles/pi-recall.createPiRecallDriver + createJudgeAssertion` 的直接组合。消费者的 `createDriver` 只需把 `backend/target/cliRef` 显式适配到 Pi 工厂，并提供独立的单轮 spec 与 `effects:none`；不得复制裁判生命周期、复用主运行 spec/provision/workspace，或把原考卷、评分实现和秘密环境交给裁判。最小可执行接法及合成宿主验证见 [Judge + Pi borrowed + Assertions](../tutorial/recipes/recall.md#judge--pi-borrowed--assertions)。该组合不改变不可评测/absent 语义，也不提供 judge()/assertion 级外部 signal。

原生 Recall v1 的 YAML、config、compile、run 与 CLI 不因本包改变；`expected.judge/decision` 仍不是原生 Recall 字段。默认测试使用 fake client/transport/driver，真实 provider 或具体宿主验证必须走显式 token 集成入口。
