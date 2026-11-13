---
title: "原生 Recall 声明式评测"
type: spec
status: active
tags: [spec, recall]
---

# 原生 Recall 声明式评测

## 目的与信任边界

`@x-agent-suite/recall` 把 Recall YAML 编译为现有 `ScenarioSpec[]`，再复用同一个 Runner 的 repeat、判据调度和报告。**没有执行级 ProvisionPlan，也不做执行 provision 与场景 provision 合并。**

五种输入职责固定：

| 输入                  | 职责                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Recall YAML           | case 测试意图、文件内 `plans`、全局/case `context` 与三层 `vars`，编译场景 provision 和静态变量上下文。                       |
| 执行 Plan YAML        | 只声明 `version: 1` 与 `effects: none/use/inline`。不得包含 driver、mode、cliRef、criteria 或 provision。                     |
| 独立 registry TS 模块 | 注册 Criterion 与通用判据工厂、CLI/临时 Client execution profiles、EffectsProfile 与可选 transport；不是 Recall config 闭包。 |
| `.env.e2e.yaml`       | 复用 carrier/provider/model、Carrier kind/clientRef/channelsFrom、凭据与私密 TargetTags，不建立第二套模型配置。               |
| 本次命令执行参数      | `--execution-params <JSON对象>`，仅交给已选 Profile/Adapter；不参与渠道、权限或执行路径选择。                                 |

不读取、发现或兼容 `x-agent-suite.config.ts`。旧 `--config` 会返回定义错误。Recall 不预置 metric、具体宿主 profile 或领域 EffectsProfile；独立消费者配置投影入口见 [宿主配置保真](./host-config-projection.md)。

## CLI 与 target 选择

```bash
x-agent-suite recall \
  --carrier <id> [--provider <id>] [--model <id>] \
  [--live-config <path>] [--registry <module.ts>] [--plan <yaml|use:profile>] \
  [--execution-params <json-object>] [--approve-live] [--repeat <n>] [--out-dir <path>] [--root-dir <path>] \
  [--verbose [0..3]] [-v|-vv|-vvv] \
  [YAML|目录]
```

- 三个 target 参数至少出现一个；无参数直接返回用法/定义错误，**即使只有一个 default 也不执行**。
- `--carrier` 展开该 carrier 的 default targets，保持声明顺序，可多个，由外层逐 target 执行。
- `--provider` 在已选范围继续过滤 defaults；`--model` 从可选目录继续定位具体模型，歧义时失败。显式选择不追加其他 default。
- `--live-config` 映射为本次 `E2E_LIVE_CONFIG_PATH`；省略时沿用既有配置发现链。
- CLI 不提供 `--mode/--cli-ref`。路径只由 Carrier kind 决定：`cli`（含省略 kind）必须 borrowed，`ephemeral-client` 必须注册自定义 direct Adapter；effects/provision 只约束执行能力，不改变路径。
- `kind: ephemeral-client` 的 Carrier 通过 `clientRef` 选择同 carrier 注册 Adapter，使用自定义 direct 路径；未注册或 carrier 不匹配即失败，不回退其他实现。详见 [ephemeral-client.md](./ephemeral-client.md)。
- 考卷显式目标优先；否则读取 cwd 下 `.recall/*.{yaml,yml}` 第一层，不递归。显式 `--plan` 位于该目录时从默认考卷发现中排除。
- 所有可选路径参数（`target/--live-config/--registry/--plan/--root-dir/--out-dir`、程序 API 的 `cwd/homeDir`）只在省略时使用缺省；一旦显式提供就必须是非空字符串。空串、空白串、null 或其他类型是定义错误，不得回退默认发现。`approveLive` 提供时必须是严格 boolean，不能用 truthy 字符串绕过 live 审批。

## 流式输出与 verbosity

Recall 默认以行式事件流报告执行进度，不等待全部 target/case 结束后集中打印。完成加载和判据装配后先输出运行头；每个 case 的报告写入或失败脱敏完成后立即输出结果；全部结束后输出 passed/failed/errors/total/duration 汇总。行为失败与基础设施失败继续分别使用 `FAIL/stdout` 和 `ERROR/stderr`，退出码规则不变。

| 级别      | 参数示例                         | 在上一级基础上增加                                                                                 |
| --------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| 0（默认） | 无参数、`--verbose 0`            | case `PASS/FAIL/ERROR`、耗时、`rawScore`、断言通过数、失败原因、最终汇总                           |
| 1         | `-v`、`--verbose`、`--verbose 1` | case `RUN`、repeat 开始/结束及每次 `rawScore`、Markdown/JSON 报告路径                              |
| 2         | `-vv`、`--verbose 2`             | turn 开始/结束、逐判据归一化 `score`、实际 `contribution` 与理由                                   |
| 3         | `-vvv`、`--verbose 3`            | 完整 prompt、逐轮 Observation（含 toolCalls/events/usage/metadata）、repeat 结果与基础设施错误堆栈 |

- `-v` 是可重复计数短标志：`-vv` 等价于两个 `-v`。`--verbose` 省略数值时增加 1；`--verbose 2` 与 `--verbose=2` 增加指定级数。不同形式混用时累加，总数必须是 0..3 的整数；`-vvvv` 或大于 3 的数值是定义错误。
- 高级别严格包含低级别事件，verbosity 只改变渲染，不改变执行顺序、repeat、判据、报告或退出码。`runRecall` 通过可选事件监听器暴露同一事件序列，程序调用方可自行渲染。
- 分数口径与报告完全一致：`score` 是 Criterion 的 0..1 归一化结果，布尔通过为 1；`contribution` 是按该断言 `hit/miss` 配置计算的实际贡献；`rawScore` 是当前 case/repeat 的全部贡献之和，`assertions=通过数/总数` 单独披露覆盖。没有断言时不虚构 `rawScore`。总分可以为 0 或负数，但 `hardPass` 仍要求全部断言通过，正分不能抵消失败。
- 程序事件中的 `contributions` 与 `criteria-completed.outcomes` 按索引一一对应；`repeat-completed.result` 与 case 结果一样使用 Recall 报告投影，包含可用的 `assertions/rawScore`。
- 级别 3 是完整的人类诊断，不是机器 JSON reporter，也不保证逐 token 推送。每轮 `sendPrompt` 返回后立即输出该轮结构化 Observation；尚未返回的 Driver 原始内容仍由具体 Driver 自己管理。
- 所有 prompt、Observation、判据理由、结果与错误堆栈在进入 CLI 前应用当前 case/repeat 已创建的 Driver redactor；判据继续消费原始 Observation。多 repeat 的 redactor 组合顺序与报告一致。
- TTY 自动使用图标、颜色、运行中状态行和汇总框；即使级别 0 也在 case 开始即显示状态。普通日志输出前清除状态行，case 完成或失败后清除状态再打印结果，避免动态帧覆盖中间日志。`NO_COLOR` 或 `TERM=dumb` 只关闭颜色，不取消实时状态。
- 非 TTY 保持既有纯文本行式输出与 `SUMMARY`，不写 ANSI 颜色、清屏或光标控制序列，便于管道、CI 和脚本解析。stdout/stderr 分开消费时不承诺跨文件描述符的统一全序。

业界依据与“测试事件流不等于原始内容流”的边界见 [测试运行器流式输出与详细级别调研](../research/test-runner-streaming-verbosity.md)。

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
- 场景 provision 显式来自考卷的 context/plans，不要求额外 `--plan`；无执行 Plan 时保持 `effects: none`，由注册 Profile/Adapter 物化并清理隔离资源，不增加模型工具或命令权限。
- 显式 Plan 为 `effects: none` 且场景有 provision：与无执行 Plan 等价；需要模型工具或命令副作用时才显式提供其他 effects。
- CLI 的 TargetTags borrowed 候选与 registry 中同 carrier profile 的交集必须恰好一个；cliRef 由此归因，不靠 CLI 参数或 Plan 猜选。effects 只约束工具/会话/隔离等能力。
- ephemeral-client 始终通过 `clientRef` 使用自定义 direct Adapter；Adapter 接收 `spec.provision` 与显式 effects Plan，其多轮、工具策略和生命周期由消费者兑现。
- 临时 Client 复用 `registry.profiles[clientRef]`，其 `carrier` 必须与临时 Carrier ID 一致；`createDriver` 上下文中的 `cliRef/clientRef` 恰居其一。
- `review-required` 只有当前命令带 `--approve-live` 才放行；`disallowed/unknown` 不因审批放行。direct 与 borrowed 之间不降级、不回退。
- borrowed 测试阶段暂不按非 live 的 usage 计费分类过滤，不要求为运行补写或推断 subscription；direct 的 API 用量要求保持原样。缺少 live 策略仍 fail-closed，`--approve-live` 不放行 live unknown/disallowed。
- 兼容性变更：旧“省略 kind、无 provision、effects:none”的 HTTP direct 用法须迁移为 `kind: ephemeral-client` 并注册 `clientRef`，不能通过缺注册 Profile 降级为 HTTP。

## 独立 registry

`--registry` 是显式模块路径；无路径时使用空注册表，不读取任何默认 TS 文件。考卷引用自定义 metric、使用 borrowed/ephemeral-client 或 `effects.use` 时，必须在 registry 注册对应实现；内置 `expect.judge` 由框架提供。

```ts
import type { RecallRegistry } from "@xnightsky/x-agent-suite/recall";

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

### 通用判据工厂

`criteria` 支持静态 Criterion 与通用工厂混合注册，用于扩展自定义判据。工厂只声明 `name`、`scope` 与 `create`，加载期要求 `evaluate` 与 `create` 恰有一个；编译期按 name/scope 描述符验证自定义判据引用。

运行前按已选 target 装配实际引用的自定义工厂，每 target 每工厂恰好调用一次，全部完成于任何主 Driver 创建之前，case 与 repeat 复用同一闭包。装配上下文提供同源的 target/config/tags/live 批准、cliRef/clientRef 与 effects，具体契约见 [Recall 运行时组合](./recall-runtime-composition.md)。

`turn:judge` 与 `turn:judge.*` 是框架的标准保留命名空间，registry 为其他自定义判据提供实现。

### 考卷侧驱动：expect 即判据输入

> 内置 Judge 与断言直接计分是现行契约；case 与线性逐轮评价位置分别见 [Judge DSL](./recall-judge-dsl.md) 和 [轮次级断言](./recall-turn-assertion.md)，decision 仍留在未来。
>
> case 的执行过程与断言配置分离，`expect` 是断言根：

```yaml
cases:
  - id: answer-quality
    turns:
      - send: 先阅读规则
      - send: 介绍这个仓库
    expect:
      judge:
        准确性:
          rubric: 回答必须说出三个核心包
        诚实性:
          rubric: 不确定的内容必须明说
```

标准 Judge 在 `turn.expect` 配置时只评当前轮、并在下一次 send 前完成；在 `case.expect` 配置时只评最后一轮。默认使用主流程的 AI 配置，每次裁定创建独立会话。机械断言与每个 AI rubric 在自己的声明中配置分值：score 可选，默认 hit=1／miss=-1；命中配 3 就加 3，miss 不写默认扣 1，显式配 0 才不扣分，hit=0 可只累计失败扣分。框架统一求和，所有已声明断言通过测试才通过，正总分不能抵消失败。不提供 decision、评分维度、阈值、否决、归一分或缺席映射。Judge 缺少必需裁定或评测失败仍报错，不伪装成正常零分。完整作者接口见 [Recall 内置 Judge 与断言计分 DSL](./recall-judge-dsl.md)。

其他 expect 键继续按名称引用 registry 自定义判据，值原样透传给对应 `evaluate`。标准 Judge 与自定义判据可以在同一 turn 或 case 级 `expect` 组合。

| 谁            | 能决定什么                                                              | 在哪写         |
| ------------- | ----------------------------------------------------------------------- | -------------- |
| 考卷作者      | 各评价位置的 rubric、各断言分值、是否启用标准 Judge、引用哪些自定义判据 | 考卷 YAML      |
| 命令行调用方  | 主执行与默认 Judge 同源使用的 target 与 live 批准                       | CLI 参数       |
| registry 作者 | 自定义判据、执行 profile、transport 与其他扩展实现                      | TS 模块        |
| 框架          | 标准 Judge 装配、独立裁定会话与结果映射                                 | Recall / Judge |

## 单次运行参数

`--execution-params <JSON对象>` 是通用对象透传；程序 API 对应 `LoadRecallOptions.executionParams`。省略时 Adapter 接收 `{}`；每个 case/repeat 获得独立副本，适用于 PTY/JSONL/SDK 等不同机制。解析错误不回显输入，不将原始参数写入日志或报告。

框架只校验对象与可序列化形状。消费者 Profile/Adapter 必须校验字段和类型、拒绝不支持的参数，并映射到宿主原生参数/隔离 settings。参数不得改变 target、凭据、权限 Plan 或 live 审批；禁止经此入口注入 secret、原始命令或任意宿主配置。Pi 的 `thinkingLevel` 由独立消费者入口解释，未提供时继承宿主默认，不在 Recall case YAML、Plan 或 TargetTags 中建第二份事实源。

## 执行 Plan DSL：仅 effects

命令可直接用 `--plan use:<name>` 显式选择当前 registry 的 `effectsProfiles[name]`，
无需为已有权限配置另建 YAML。未注册或空名称在执行前失败；省略 `--plan` 仍为 `effects: none`。
`use:` 为保留前缀，同名本地文件需以 `./use:<name>` 显式指定；目录发现只排除实际 Plan 文件，不把权限引用当作文件路径。

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
- 消费者 Profile 必须真正兑现命令白名单，不能仅裁剪工具名称；具体脚本路径与结果判据仍由消费者注册，核心包不识别脚本语义。
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

- 顶层字段为 `version/id/context/plans/cases/vars`；plan 与 case 也可声明 `vars`，按 case > 选中 plan > 文档浅合并。case 可另含 `context` 与 `expect`，与 `id/turns/timeoutMs/metadata/vars` 并列。线性 turn 不需要额外标识字段，逐轮评价与位置归因见 [Recall 轮次级断言](./recall-turn-assertion.md)。变量仅用于显式 opt-in 的判据字段，详见 [Recall 变量机制](./recall-variables.md)。内置 Judge 与逐项计分目标契约见 [Recall 内置 Judge 与断言计分 DSL](./recall-judge-dsl.md)。
- `plans.<name>.resources` 只是**当前 Recall YAML 文档内部**的资源别名注册表；禁止覆盖内置 `none`，不支持 extends、继承、深合并或跨 YAML 引用。plan 映射使用无原型记录且只按 own property 查找，原型链名称不得被误认为已注册 plan。
- YAML parser 错误只输出固定类别（普通解析失败或重复 key）与 file/line/column，不回显 parser 的源行、插入符或原始错误 message。显式 null 不得被 `??` 当作字段缺省；缺省只适用于字段省略。
- 全局 `context.plan` 是所有 case 的默认；case 未声明 context 时继承，声明时整块覆盖。`context.plan: none` 清空全局资源；case 也可改用 `context.files`。
- 同一 context 的 `files` 与 `plan` 互斥。未注册 plan 或跨文件引用在 Driver 前失败。
- `context.files` 仍编译为 `{ context: { files: [{ path, content }] } }`；`context.plan` 编译为 `{ plan: <name>, resources: [...] }`。两者都是 `ScenarioSpec.provision`，Runner 不再合并其他资源层。

### resources 字段与路径

| 字段          | 缺省     | 规则                                                                                                                                                                                                                                              |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`      | 必填     | 资源来源的非空路径字符串。启用时相对 `--root-dir`，realpath 后仍须在 rootDir 内；缺失、绝对路径、`..`/符号链接逃逸和 file/directory 类型不符均失败；目录资源内的符号链接一律拒绝，物化前按段 lstat 重验来源。禁用时不读取来源，也不要求实体存在。 |
| `install`     | `true`   | 布尔值，控制是否把资源复制到本次隔离现场，不运行原生安装器。`false` 跳过该项；省略保持旧行为。字符串、数字或 null 均拒绝。                                                                                                                        |
| `destination` | 条件必填 | `install: true` 或省略时必填；`install: false` 时禁止出现，包括 null。相对隔离 `sandbox.cwd` 的归一化路径；不接受 `~`、`~/` 主目录简写、绝对路径或逃逸路径。启用项之间任意目标前缀冲突均失败；目标根、父目录与目标叶的符号链接均拒绝，禁止覆盖。  |
| `kind`        | `file`   | `file` 或 `directory`。                                                                                                                                                                                                                           |
| `readOnly`    | `true`   | 当前仅允许 `true`；物化禁止覆盖（目标叶已存在的文件、目录与符号链接一律拒绝），并设置文件 0444 / 目录 0555。                                                                                                                                      |

安装与跳过分别声明，其他输入资源可照常保留在两组计划中：

```yaml
plans:
  installed:
    resources:
      - source: fixtures/resource-bundle
        install: true
        destination: resources/resource-bundle
        kind: directory
  absent:
    resources:
      - source: fixtures/resource-bundle
        install: false
```

禁用项仍校验字段、source 字符串、install 类型、kind 与 readOnly，但不解析来源实体、不参与目标冲突检查，也不进入编译后的资源清单。跳过不负责卸载其他位置的资源；只有消费者隔离了其他启用的发现来源，才能把它作为未安装对照。context 的整块覆盖规则保持不变，不引入计划合并。

启用的 resource destination 与 context file 目标在编译期做重复预检：路径别名、大小写/Unicode 归一后相同或互相为前缀的 resource 目标、以及归一后重复的 context 文件目标均拒绝，不等到物化阶段才报“目标已存在”。

安装位置由 destination 指定，框架不推断载体目录。保留既有运行时 sandbox，本轮不增加 `sandbox`、`base` 或 `skills` DSL 字段；资源只复制到隔离 cwd，源仓库与用户全局目录不作为安装目标。当前 repo 用于读取考卷、配置和来源，默认报告仍写入 `.tmp/x-agent-suite`；资源隔离由注册 Profile/Driver 兑现，不等同于操作系统级文件访问隔离。

`materializeRecallProvision` 可供注册 profile 在 `sandboxSetup` 等 hook 中物化上述 provision。`cleanup: required` 由隔离 Driver 的 close/finally 兑现。**无执行级 ProvisionPlan**；挂载/物化成功也不等于模型实际读取，行为证据仍由 Observation/Criterion 提供。

物化发生在 `sandboxSetup` 内，因此来源校验在编译后重跑一次：`compiled.source` 是编译期 realpath 得到的物理绝对路径，物化前逐段 `lstat`，任一祖先或叶成为符号链接即失败——覆盖编译→物化之间被替换的场景；目标根 `sandbox.cwd` 同样先 `lstat`，被替换为链接时不 realpath、不写入链接目标。来源内容若被替换成另一份实体文件则无法检测，属完整性范畴，不在本契约内。

目标父目录创建成功或遇到 `EEXIST` 后均重新 `lstat`：并发出现的真实目录可继续使用，符号链接或非目录显式拒绝。
物化期间调用方须独占来源与目标目录树，并在物化结束后才启动会修改它们的进程。
逐段路径检查不提供原子的目录句柄相对遍历，无法保证抵御检查与复制、写入或设权限之间的任意并发替换；
上述链接防护与只读权限契约均以目录树不被并发修改为前提。POSIX 下设置文件 `0444` / 目录 `0555`；
Windows 仅保留文件只读语义，不保证 POSIX 的精确权限位。

## 报告、退出码与验证

### 场景测试仓

`integrations/itrepos/<name>/` 是仓库级声明式集成验证入口，与包测试目录独立。
当前 `cedar/` 内维护 `.recall.yaml`、`AGENTS.md` 和任务素材，直接由 Recall 驱动并判定，无额外测试脚本包装。
资源的 source 相对调用 cwd（或显式 `--root-dir`），由 Profile 物化到一次性隔离工作区；不直接在模板仓执行模型工具。
Pi 的项目规则发现由显式消费者 registry 通过 `contextFiles: "project"` 开启，不在核心包枚举宿主语义。
Skill 的原生安装由操作者按各场景仓自己的 README 准备；Recall 只消费已声明的资源，`install` 仅控制隔离现场的资源复制，不运行原生安装器。
`cedar/skills-def/change-summary/.recall.yaml` 覆盖自然任务触发、无关任务和未安装对照，真实调用通过显式只读权限引用执行。
消费者判据 `skill-loaded` 使用 `{name, loaded}`：按名字匹配原生读取的 `SKILL.md`，不绑定源目录或安装目录；当前假设名字唯一，路径原样保留作诊断。
`cedar/skills-def/change-report/.recall.yaml` 覆盖带脚本的生成、无关任务、仅解释方法与非法输入；显式命令许可通过 `use:skill-script` 选择。
Skill 与 scripts 作为只读安装态快照，输入只读，输出目录不预置。消费者 Profile 在清理前采集输出文件到观测 metadata，注册判据分别检查原生命令事件和实际 JSON，不把模型回复当作产物证据。
入口、带规则/无规则对照和真实 token 命令见 [`integrations/README.md`](../../integrations/README.md)。

### 执行结果

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

多 default target 使用 `<outDir>/<carrier>/<provider>/<model>/` 分目录，避免报告覆盖。carrier/provider/model 是安全路径段：必须非空且不得为 `.`/`..`，分隔符经 URI 编码，拼出的目录必须仍位于 outDir 下。报告 Markdown 与 JSON 默认以 `0600` 权限创建。provision/effects 是配置归因，不是实际读取或权限执行证据。

Recall 捕获每个主 Driver 暴露的可选 `redactor`，按创建顺序去重组合后应用于 Markdown/JSON 报告，以及失败结果和 CLI 错误。脱敏只发生在报告与诊断出口，判据求值仍看到原始 Observation；不得在 `sendPrompt` 返回边界提前改写证据。

报告入口兼容历史 `JSON.stringify` 对对象字段的省略行为：对象值中的 `undefined`、function、symbol 字段会被丢弃；NaN、Infinity、BigInt、循环引用和不可安全编码的结构仍显式拒绝。该兼容只属于报告投影，不放宽 `executionParams` 或共享 JSON 严格校验。

- 用法、registry、Plan、YAML、资源、target 和候选定义错误：退出码 2。
- Driver、超时、报告写入等基础设施错误：退出码 1。
- 行为判据不通过：`hardPass=false`，退出码仍为 0。
- 默认测试使用临时配置、合成 TargetTags、fake transport 和 MockDriver，零 token；覆盖 ephemeral-client 自定义 Adapter、缺注册拒绝与 provision/Plan 接线。`pnpm ittest:token:cedar` 显式运行真实场景考卷，不进入默认回归，且脚本本身不预填渠道。

## 有序择档断言实施补充

`turn.expect` 与 `case.expect` 的 `allOf/anyOf/firstOf` 已确认迁移契约统一见 [Recall 组合断言与计分](./recall-composition-scoring.md)。该文档当前处于文档先行阶段，运行时尚未完成迁移。普通兄弟断言仍全部执行且必过；组合只提交一个顶层结果和有效贡献，内部原始失败保留为诊断而不独立计分。执行、缺裁定与清理错误不触发降级，也不被其他分支结果吞掉。evidence 节点、平铺 rubric 和主执行线性顺序保持原义。

本扩展开发与验收中，不能据此视为已获真实 token 验证。实现收口须同时通过默认零 token 回归与另行授权的真实 token 验收；报告、进度、repeat 和错误诊断同属交付范围。
