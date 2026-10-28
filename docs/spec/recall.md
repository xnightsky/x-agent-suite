# 原生 Recall 声明式评测

## 目的与信任边界

`@x-agent-suite/recall` 把 Recall YAML 编译为现有 `ScenarioSpec[]`，再复用同一个 Runner 的 repeat、判据调度和报告。**没有执行级 ProvisionPlan，也不做执行 provision 与场景 provision 合并。**

五种输入职责固定：

| 输入                  | 职责                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Recall YAML           | case 测试意图、文件内 `plans`、全局/case `context`，最终只编译为 `ScenarioSpec.provision`。                     |
| 执行 Plan YAML        | 只声明 `version: 1` 与 `effects: none/use/inline`。不得包含 driver、mode、cliRef、criteria 或 provision。       |
| 独立 registry TS 模块 | 注册 Criterion、CLI/临时 Client execution profiles、EffectsProfile 与可选 transport；不是 Recall config 闭包。  |
| `.env.e2e.yaml`       | 复用 carrier/provider/model、Carrier kind/clientRef/channelsFrom、凭据与私密 TargetTags，不建立第二套模型配置。 |
| 本次命令执行参数      | `--execution-params <JSON对象>`，仅交给已选 Profile/Adapter；不参与渠道、权限或执行路径选择。                   |

不读取、发现或兼容 `x-agent-suite.config.ts`。旧 `--config` 会返回定义错误。Recall 不预置 metric、具体宿主 profile 或领域 EffectsProfile；独立消费者配置投影入口见 [宿主配置保真](./host-config-projection.md)。

## CLI 与 target 选择

```bash
x-agent-suite recall \
  --carrier <id> [--provider <id>] [--model <id>] \
  [--live-config <path>] [--registry <module.ts>] [--plan <yaml>] \
  [--execution-params <json-object>] [--approve-live] [--repeat <n>] [--out-dir <path>] [--root-dir <path>] \
  [YAML|目录]
```

- 三个 target 参数至少出现一个；无参数直接返回用法/定义错误，**即使只有一个 default 也不执行**。
- `--carrier` 展开该 carrier 的 default targets，保持声明顺序，可多个，由外层逐 target 执行。
- `--provider` 在已选范围继续过滤 defaults；`--model` 从可选目录继续定位具体模型，歧义时失败。显式选择不追加其他 default。
- `--live-config` 映射为本次 `E2E_LIVE_CONFIG_PATH`；省略时沿用既有配置发现链。
- CLI 不提供 `--mode/--cli-ref`。路径只由 Carrier kind 决定：`cli`（含省略 kind）必须 borrowed，`ephemeral-client` 必须注册自定义 direct Adapter；effects/provision 只约束执行能力，不改变路径。
- `kind: ephemeral-client` 的 Carrier 通过 `clientRef` 选择同 carrier 注册 Adapter，使用自定义 direct 路径；未注册或 carrier 不匹配即失败，不回退其他实现。详见 [ephemeral-client.md](./ephemeral-client.md)。
- 考卷显式目标优先；否则读取 cwd 下 `.recall/*.{yaml,yml}` 第一层，不递归。显式 `--plan` 位于该目录时从默认考卷发现中排除。

## 实际执行链

```text
--carrier/--provider/--model + --live-config
  → loadLiveConfig / resolveLiveTargets
  → loadTargetTagCatalog（公共实例 + home 私有全局实例 + 同文件私密 overlay）
  → 每个 target 经 TargetTags/live 审批
  → 根据 Carrier kind 选择唯一 borrowed profile 或临时 Client direct Adapter
  → 原有 ScenarioSpec / runScenarioRepeat
  → metadata.recallExecution 报告归因
```

独立 `--registry` 和 `--plan` 在 Driver 前加载；所有考卷、metric、plans、context、资源、target 和候选均先校验。未配置、选择歧义、live 未审批、实现不唯一或 effects 非法均 fail-closed，不创建 Driver，不 fallback。

## 无 Plan、direct、borrowed 与 ephemeral-client

- 无 Plan 等价于 `effects: none`，但不等于 direct。`kind: cli`（含省略 kind）始终需要唯一注册的 borrowed Profile；不再内建 HTTP direct Driver。
- 任一场景有 provision 而没有 `--plan`：定义错误，direct 不得隐式挂载。
- 显式 Plan 为 `effects: none` 且场景有 provision：允许 borrowed，由注册 profile 物化 `ScenarioSpec.provision`。
- CLI 的 TargetTags borrowed 候选与 registry 中同 carrier profile 的交集必须恰好一个；cliRef 由此归因，不靠 CLI 参数或 Plan 猜选。effects 只约束工具/会话/隔离等能力。
- ephemeral-client 始终通过 `clientRef` 使用自定义 direct Adapter；Adapter 接收 `spec.provision` 与显式 effects Plan，其多轮、工具策略和生命周期由消费者兑现。
- 临时 Client 复用 `registry.profiles[clientRef]`，其 `carrier` 必须与临时 Carrier ID 一致；`createDriver` 上下文中的 `cliRef/clientRef` 恰居其一。
- `review-required` 只有当前命令带 `--approve-live` 才放行；`disallowed/unknown` 不因审批放行。direct 与 borrowed 之间不降级、不回退。
- borrowed 接受真实的 `api-payg/api-credit/api-free` 及既有 CLI/CI/第三方订阅、CLI-free；不得伪造 subscription。缺少 usage 或 live 声明仍 fail-closed，`--approve-live` 不放行 unknown。
- 兼容性变更：旧“省略 kind、无 provision、effects:none”的 HTTP direct 用法须迁移为 `kind: ephemeral-client` 并注册 `clientRef`，不能通过缺注册 Profile 降级为 HTTP。

## 独立 registry

`--registry` 是显式模块路径；无路径时使用空注册表，不读取任何默认 TS 文件。考卷引用 metric、使用 borrowed/ephemeral-client 或 `effects.use` 时，必须在 registry 注册对应实现。

```ts
import type { RecallRegistry } from "x-agent-suite/recall";

const registry: RecallRegistry = {
  criteria: consumerCriteria,
  profiles: {
    "consumer-cli-profile": {
      carrier: "consumer-carrier",
      createDriver: ({
        spec,
        backend,
        target,
        cliRef,
        effects,
        executionParams,
      }) =>
        createConsumerDriver({
          backend,
          target,
          cliRef,
          effects,
          executionParams,
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

## 单次运行参数

`--execution-params <JSON对象>` 是通用对象透传；程序 API 对应 `LoadRecallOptions.executionParams`。省略时 Adapter 接收 `{}`；每个 case/repeat 获得独立副本，适用于 PTY/JSONL/SDK 等不同机制。解析错误不回显输入，不将原始参数写入日志或报告。

框架只校验对象与可序列化形状。消费者 Profile/Adapter 必须校验字段和类型、拒绝不支持的参数，并映射到宿主原生参数/隔离 settings。参数不得改变 target、凭据、权限 Plan 或 live 审批；禁止经此入口注入 secret、原始命令或任意宿主配置。Pi 的 `thinkingLevel` 由独立消费者入口解释，未提供时继承宿主默认，不在 Recall case YAML、Plan 或 TargetTags 中建第二份事实源。

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

| 字段          | 缺省   | 规则                                                                                                                                                                                                                             |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`      | 必填   | 相对 `--root-dir`，realpath 后仍须在 rootDir 内；缺失、绝对路径、`..`/符号链接逃逸和 file/directory 类型不符均失败；目录资源内的符号链接（含指向 rootDir 内）一律拒绝；物化前按段 lstat 重验来源，祖先或叶被替换为链接同样失败。 |
| `destination` | 必填   | 相对隔离 `sandbox.cwd` 的归一化路径；绝对路径、逃逸及任意前缀冲突均失败；目标根与逐段父目录均以 lstat 判定，任一段是既有符号链接即拒绝（不 realpath 后把链接目标当作合法根）。                                                   |
| `kind`        | `file` | `file` 或 `directory`。                                                                                                                                                                                                          |
| `readOnly`    | `true` | 当前仅允许 `true`；物化禁止覆盖（目标叶已存在的文件、目录与符号链接一律拒绝），并设置文件 0444 / 目录 0555。                                                                                                                     |

`materializeRecallProvision` 可供注册 profile 在 `sandboxSetup` 等 hook 中物化上述 provision。`cleanup: required` 由隔离 Driver 的 close/finally 兑现。**无执行级 ProvisionPlan**；挂载/物化成功也不等于模型实际读取，行为证据仍由 Observation/Criterion 提供。

物化发生在 `sandboxSetup` 内，因此来源校验在编译后重跑一次：`compiled.source` 是编译期 realpath 得到的物理绝对路径，物化前逐段 `lstat`，任一祖先或叶成为符号链接即失败——覆盖编译→物化之间被替换的场景；目标根 `sandbox.cwd` 同样先 `lstat`，被替换为链接时不 realpath、不写入链接目标。来源内容若被替换成另一份实体文件则无法检测，属完整性范畴，不在本契约内。

目标父目录创建成功或遇到 `EEXIST` 后均重新 `lstat`：并发出现的真实目录可继续使用，符号链接或非目录显式拒绝。
物化期间调用方须独占来源与目标目录树，并在物化结束后才启动会修改它们的进程。
逐段路径检查不提供原子的目录句柄相对遍历，无法保证抵御检查与复制、写入或设权限之间的任意并发替换；
上述链接防护与只读权限契约均以目录树不被并发修改为前提。POSIX 下设置文件 `0444` / 目录 `0555`；
Windows 仅保留文件只读语义，不保证 POSIX 的精确权限位。

## 报告、退出码与验证

每次 case/repeat 都创建独立 backend/Driver；多轮消息与生命周期均由选中的 CLI Profile/Client Adapter 按执行契约兑现。报告写入：

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
