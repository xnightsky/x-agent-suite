# 原生 Recall 声明式评测

## 目的与信任边界

`@x-agent-suite/recall` 把 Recall YAML 编译为现有 `ScenarioSpec[]`，再复用同一个 Runner 的 repeat、判据调度和报告。**没有执行级 ProvisionPlan，也不做执行 provision 与场景 provision 合并。**

四种输入职责固定：

| 输入                  | 职责                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| Recall YAML           | case 测试意图、文件内 `plans`、全局/case `context`，最终只编译为 `ScenarioSpec.provision`。               |
| 执行 Plan YAML        | 只声明 `version: 1` 与 `effects: none/use/inline`。不得包含 driver、mode、cliRef、criteria 或 provision。 |
| 独立 registry TS 模块 | 注册 Criterion、CLI/临时 Client execution profiles、EffectsProfile 与可选 transport；不是 Recall config 闭包。 |
| `.env.e2e.yaml`       | 复用 carrier/provider/model、Carrier kind/clientRef/channelsFrom、凭据与私密 TargetTags，不建立第二套模型配置。 |

不读取、发现或兼容 `x-agent-suite.config.ts`。旧 `--config` 会返回定义错误。包内不预置 metric、具体宿主 profile 或领域 EffectsProfile。

## CLI 与 target 选择

```bash
x-agent-suite recall \
  --carrier <id> [--provider <id>] [--model <id>] \
  [--live-config <path>] [--registry <module.ts>] [--plan <yaml>] \
  [--approve-live] [--repeat <n>] [--out-dir <path>] [--root-dir <path>] \
  [YAML|目录]
```

- 三个 target 参数至少出现一个；无参数直接返回用法/定义错误，**即使只有一个 default 也不执行**。
- `--carrier` 展开该 carrier 的 default targets，保持声明顺序，可多个，由外层逐 target 执行。
- `--provider` 在已选范围继续过滤 defaults；`--model` 从可选目录继续定位具体模型，歧义时失败。显式选择不追加其他 default。
- `--live-config` 映射为本次 `E2E_LIVE_CONFIG_PATH`；省略时沿用既有配置发现链。
- CLI 不提供 `--mode/--cli-ref`。direct/borrowed 由 effects、场景 provision、TargetTags 和注册实现共同决定。
- `kind: ephemeral-client` 的 Carrier 通过 `clientRef` 选择同 carrier 注册 Adapter，使用自定义 direct 路径；未注册或 carrier 不匹配即失败，不回退内置 direct。详见 [ephemeral-client.md](./ephemeral-client.md)。
- 考卷显式目标优先；否则读取 cwd 下 `.recall/*.{yaml,yml}` 第一层，不递归。显式 `--plan` 位于该目录时从默认考卷发现中排除。

## 实际执行链

```text
--carrier/--provider/--model + --live-config
  → loadLiveConfig / resolveLiveTargets
  → loadTargetTagCatalog（含同文件私密 overlay）
  → 每个 target 经 TargetTags/live 审批
  → 根据 Carrier kind、effects 与场景 provision 选择内置 direct、唯一 borrowed profile 或临时 Client Adapter
  → 原有 ScenarioSpec / runScenarioRepeat
  → metadata.recallExecution 报告归因
```

独立 `--registry` 和 `--plan` 在 Driver 前加载；所有考卷、metric、plans、context、资源、target 和候选均先校验。未配置、选择歧义、live 未审批、实现不唯一或 effects 非法均 fail-closed，不创建 Driver，不 fallback。

## 无 Plan、direct、borrowed 与 ephemeral-client

- 无 Plan 等价于 `effects: none`。只有**所有场景均无 provision**时，才允许内置 direct 多轮纯文本 Driver；不声明 tools，返回工具调用会失败。
- 任一场景有 provision 而没有 `--plan`：定义错误，direct 不得隐式挂载。
- 显式 Plan 为 `effects: none` 且场景有 provision：允许 borrowed，由注册 profile 物化 `ScenarioSpec.provision`。
- effects 为 inline/use：要求 borrowed。TargetTags borrowed 候选与 registry 中同 carrier profile 的交集必须恰好一个；cliRef 由此归因，不靠 CLI 或 Plan 猜选。
- ephemeral-client 始终通过 `clientRef` 使用自定义 direct Adapter；Adapter 接收 `spec.provision` 与显式 effects Plan，不受内置 direct 的纯文本、无 provision 限制。
- 临时 Client 复用 `registry.profiles[clientRef]`，其 `carrier` 必须与临时 Carrier ID 一致；`createDriver` 上下文中的 `cliRef/clientRef` 恰居其一。
- `review-required` 只有当前命令带 `--approve-live` 才放行；`disallowed/unknown` 不因审批放行。direct 与 borrowed 之间不降级、不回退。

## 独立 registry

`--registry` 是显式模块路径；无路径时使用空注册表，不读取任何默认 TS 文件。考卷引用 metric、使用 borrowed/ephemeral-client 或 `effects.use` 时，必须在 registry 注册对应实现。

```ts
import type { RecallRegistry } from "x-agent-suite/recall";

const registry: RecallRegistry = {
  criteria: consumerCriteria,
  profiles: {
    "consumer-cli-profile": {
      carrier: "consumer-carrier",
      createDriver: ({ spec, backend, target, cliRef, effects }) =>
        createConsumerDriver({
          backend,
          target,
          cliRef,
          effects,
          scenarioProvision: spec.provision,
        }),
    },
  },
  effectsProfiles: {
    "read-only-v1": {
      tools: "read-only",
      commands: { allow: ["read-file"], deny: [] },
      maxSteps: 2,
      timeoutMs: 30_000,
      workspace: "isolated",
      cleanup: "required",
    },
  },
  // transport 仅用于自定义/测试传输；生产缺省为现有 fetch。
};

export default registry;
```

重复判据、非法 profile、未知 registry 字段均在执行前拒绝。registry 只注册实现，不参与 model/default 或 Carrier kind 选择。

## 执行 Plan DSL：仅 effects

顶层只接受 `version` 和必填 `effects`；`provision/plans` 或其他字段均拒绝。

```yaml
version: 1
effects: none
```

使用独立 EffectsProfile：

```yaml
version: 1
effects:
  use: read-only-v1
```

inline：

```yaml
version: 1
effects:
  tools: read-only
  commands:
    allow: [read-file]
    deny: [read-file]
  maxSteps: 1
  timeoutMs: 30000
  workspace: isolated
  cleanup: required
```

规则：

- `effects: none` 使用安全缺省，无额外模型工具或命令副作用。
- `effects.use` 只查当前显式 registry 的 `effectsProfiles`，未注册即失败；与任何 inline 字段互斥，不继承、不深合并。
- `tools` 默认 `none`，可选 `read-only/allowlist`；TargetTags 分别要求相应 CLI 能力，注册 profile 必须实际兑现。
- `commands.allow/deny` 默认 `[]`，只支持**完整命令字符串精确匹配**；deny 优先，未命中 allow 即拒绝，未引入 glob 语义。
- `maxSteps=1`、`timeoutMs=30000` 默认且必须为正整数；`workspace` 当前仅 `isolated`，`cleanup` 当前仅 `required`。
- 权限只来自这个受信任执行 Plan；case YAML 不能声明 tools、commands 或其他提权字段。

## Recall YAML：场景与文件内 plans

```yaml
version: 1
id: project-rules
plans:
  local:
    resources:
      - source: fixtures
        destination: fixtures
        kind: directory
      - source: CONTEXT.md
        destination: docs/CONTEXT.md
context:
  plan: local
cases:
  - id: inherit
    turns:
      - send: 第一轮
        expect:
          text-contains: [first]
  - id: clear-resources
    context:
      plan: none
    turns:
      - send: 无资源回答
  - id: use-files
    context:
      files: [OTHER.md]
    turns:
      - send: 改用文件资源
```

- 顶层字段为 `version/id/context/plans/cases`；case 可另含 `context`，与 `id/turns/timeoutMs/metadata` 并列。
- `plans.<name>.resources` 只是**当前 Recall YAML 文档内部**的资源别名注册表；禁止覆盖内置 `none`，不支持 extends、继承、深合并或跨 YAML 引用。
- 全局 `context.plan` 是所有 case 的默认；case 未声明 context 时继承，声明时整块覆盖。`context.plan: none` 清空全局资源；case 也可改用 `context.files`。
- 同一 context 的 `files` 与 `plan` 互斥。未注册 plan 或跨文件引用在 Driver 前失败。
- `context.files` 仍编译为 `{ context: { files: [{ path, content }] } }`；`context.plan` 编译为 `{ plan: <name>, resources: [...] }`。两者都是 `ScenarioSpec.provision`，Runner 不再合并其他资源层。

### resources 字段与路径

| 字段          | 缺省   | 规则                                                                                                                 |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `source`      | 必填   | 相对 `--root-dir`，realpath 后仍须在 rootDir 内；缺失、绝对路径、`..`/符号链接逃逸和 file/directory 类型不符均失败。 |
| `destination` | 必填   | 相对隔离 `sandbox.cwd` 的归一化路径；绝对路径、逃逸及任意前缀冲突均失败。                                            |
| `kind`        | `file` | `file` 或 `directory`。                                                                                              |
| `readOnly`    | `true` | 当前仅允许 `true`；物化禁止覆盖并设置只读。                                                                          |

`materializeRecallProvision` 可供注册 profile 在 `sandboxSetup` 等 hook 中物化上述 provision。`cleanup: required` 由隔离 Driver 的 close/finally 兑现。**无执行级 ProvisionPlan**；挂载/物化成功也不等于模型实际读取，行为证据仍由 Observation/Criterion 提供。

## 报告、退出码与验证

每次 case/repeat 都创建独立 backend/Driver，同一 case 的内置 direct 多轮保留消息历史；自定义 Adapter 的多轮与生命周期由其执行契约兑现。报告写入：

```text
metadata.recallExecution = {
  target: { carrier, provider, model },
  mode,
  cliRef?,
  kind?,          // ephemeral-client 时显式归因
  clientRef?,
  channelCarrier?,
  provision,   // none | files | plan:<name>
  effects      // none | inline | use:<name>
}
```

多 default target 使用 `<outDir>/<carrier>/<provider>/<model>/` 分目录，避免报告覆盖。provision/effects 是配置归因，不是实际读取或权限执行证据。

- 用法、registry、Plan、YAML、资源、target 和候选定义错误：退出码 2。
- Driver、超时、报告写入等基础设施错误：退出码 1。
- 行为判据不通过：`hardPass=false`，退出码仍为 0。
- 默认测试使用临时配置、合成 TargetTags、fake transport 和 MockDriver，零 token；覆盖 ephemeral-client 自定义 Adapter、缺注册拒绝与 provision/Plan 接线。真实 provider 没有默认 Recall token 入口。
