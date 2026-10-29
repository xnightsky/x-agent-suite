# Recall：显式 target、场景 plans 与 effects-only Plan

这一教程用临时 live 配置、独立 registry 和 MockDriver 跑通“target 选择 → 文件内 plans → borrowed profile → 单 Runner → 双格式报告”，零真实 token。

## 运行

```bash
pnpm tutorial:recall
```

源码：[`examples/tutorial/17-recall.test.ts`](../../../examples/tutorial/17-recall.test.ts)，独立注册表：[`examples/tutorial/fixtures/tutorial-recall.registry.ts`](../../../examples/tutorial/fixtures/tutorial-recall.registry.ts)。不再读取或生成 `x-agent-suite.config.ts`。

## 最小输入

```text
.recall/
├── project-rules.yaml   # case 与文件内 plans/context
└── execution.yaml       # 可选：需要模型工具或命令副作用时显式提供
registry.ts              # 独立 Criterion/profile/EffectsProfile 注册表
private-live.yaml        # 私密 target/凭据/TargetTags，不入库
```

Recall YAML 只在当前文档内注册资源计划：

```yaml
version: 1
id: project-rules
plans:
  local:
    resources:
      - source: CONTEXT.md
        destination: CONTEXT.md
context:
  plan: local
cases:
  - id: multi-turn
    turns:
      - send: first
        expect:
          text-contains: [first]
      - send: second
        expect:
          text-contains: [second]
```

全局 `context.plan` 默认作用于全部 case；case context 可整块覆盖，`plan: none` 清空，`files` 与 `plan` 互斥。不得跨 YAML 引用 plans，也没有执行级 ProvisionPlan。

## 控制资源安装状态与位置

`resources` 的 `install` 控制是否将资源复制到隔离现场，`destination` 控制隔离工作区内的位置：

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

- `install: true` 或省略时，destination 必填；省略与旧考卷行为一致。
- `install: false` 时禁止填写 destination，包括 null；不读取来源，不要求它已存在，不复制，也不卸载其他位置的资源。
- source 相对 `--root-dir`，destination 相对隔离 cwd。目标不接受 `~`、`~/`、绝对路径或逃逸路径；修改 destination 即可选择另一个载体支持的项目目录。
- 目录沿用 `kind: directory`，普通文件沿用默认 `file`；此开关不调用载体安装器，也不改变模型工具权限。

case 使用 `context: { plan: installed }` 或 `context: { plan: absent }` 切换现场，其他输入资源应保持一致。运行时 sandbox 沿用注册 Profile/Driver 的实现，不新增 sandbox DSL；未安装对照还需隔离载体的其他发现来源。

## 执行权限与命令

执行 Plan 只声明 effects：

```yaml
version: 1
effects: none
```

显式执行：

```bash
x-agent-suite recall   --carrier consumer-carrier   --live-config private-live.yaml   --registry registry.ts   --plan .recall/execution.yaml   --out-dir .tmp/recall   .recall/project-rules.yaml
```

- 无 `--carrier/--provider/--model` 时拒绝，不运行任何 default。
- `--carrier` 可展开多个 defaults；`--provider/--model` 继续过滤，不追加其他 default。
- `kind: cli`（含省略 kind）始终走唯一 borrowed Profile；纯渠道调用使用 `kind: ephemeral-client + clientRef` 的自定义 direct Adapter。场景 provision 不要求额外执行 Plan，省略 `--plan` 时保持 `effects: none`。
- `--config`、`--mode`、`--cli-ref` 均不是合法 Recall 参数。
- 单次运行参数经 `--execution-params <JSON对象>` 交给选中的 Profile/Adapter，不改路由或权限。例如思考强度由消费者映射到隔离配置；未指定时继承宿主默认，见[宿主配置保真](../../spec/host-config-projection.md)。

## 实际执行链

```text
.env.e2e.yaml → 显式 target/default 集合 → TargetTags/live
  → effects-only Plan + 唯一 borrowed profile
  → Recall YAML 编译出的 ScenarioSpec.provision
  → 既有 runScenarioRepeat → metadata.recallExecution
```

Runner 只消费场景 provision，不做执行 provision 合并。资源 source/destination 经过 realpath 与逃逸校验；profile 负责物化和 finally cleanup。挂载不等于模型实际读取，行为仍由 Observation/Criterion 验证。

## Judge + Pi borrowed + Assertions

现有公开能力可以直接组合，不需要消费者另写裁判启动、发送、清理或普通 verdict 转换。运行同一教程即可覆盖这条链：

```bash
pnpm tutorial:recall
```

最小接法如下（教程仓内使用 workspace 入口，外部消费者使用下列公开分发入口）：

```ts
import { createJudgeAssertion } from "@xnightsky/x-agent-suite/assertions";
import { createJudgeClient } from "@xnightsky/x-agent-suite/judge";
import { createPiRecallDriver } from "@xnightsky/x-agent-suite/profiles/pi-recall";

const judgeEffects = {
  kind: "none",
  attribution: "none",
  tools: "none",
  commands: { allow: [], deny: [] },
  maxSteps: 1,
  timeoutMs: 30_000,
  workspace: "isolated",
  cleanup: "required",
} as const;

const client = createJudgeClient({
  target,
  tags,
  config,
  liveReviewApproved: approved, // 与主运行本次授权同源，分别显式传递。
  mode: "borrowed",
  toolPolicy: "none",
  createDriver: ({ backend, target, cliRef }) =>
    createPiRecallDriver({
      backend,
      target,
      cliRef,
      spec: { id: "judge/single-turn", turns: [{ send: "judge" }] },
      effects: judgeEffects,
      executionParams: {},
    }),
});

const criterion = createJudgeAssertion({
  name: "answer-quality",
  client,
  maxRetries: 0,
});
const registry = {
  criteria: [criterion],
  profiles: mainProfiles, // 主运行已有实现仍由消费者保留。
  effectsProfiles: {},
};
```

这里只有 `createDriver` 的上下文形状适配。Judge 仍负责每次 attempt 的 `start/sendPrompt/close`，Pi driver 仍负责单轮 JSONL、隔离配置和进程退出，Assertions 仍负责把明确 verdict 转为普通判据结果。裁判使用独立单轮 spec，不复用主运行的 spec/provision/workspace，只接收本轮文本与显式 rubrics。

人话清单：

- 可以删除：自写的裁判 `start/sendPrompt/close` 包装、每 attempt 创建 driver/backend 的重复代码，以及与现有语义相同的 `pass:false → score 0`、`not-evaluated/absent → 显式抛错` 转换。
- 仍需保留：主运行 spec/provision/workspace、证据选择、主运行 profile、`target/tags/config`、本轮文本与 rubrics、秘密最小化策略，以及真实宿主/provider 的独立验收。
- 一次用户授权可以覆盖主运行和裁判，但 Recall 与 Judge 要分别显式传参；不能从 `--approve-live` 自动推断 Judge 已批准。离线示例的 `commandOverride` 只用于合成 CLI，生产不应照抄。
- `judge()` 和 `createJudgeAssertion` 当前没有外部 `signal` 选项；只有 `client.complete({ signal })` 的既有取消接缝。整场取消需要消费者另行接线，本示例没有扩张接口。

教程源码为 [`examples/tutorial/fixtures/judge-pi.ts`](../../../examples/tutorial/fixtures/judge-pi.ts) 与 [`examples/tutorial/17-recall.test.ts`](../../../examples/tutorial/17-recall.test.ts)，公开打包回归为 [`scripts/tests/judge-pi-assertion-artifact.test.ts`](../../../scripts/tests/judge-pi-assertion-artifact.test.ts)。它们使用合成 JSONL 子进程验证真实工厂和生命周期，不证明真实 Pi/provider live 已验证。

## 教程断言

`TUTORIAL_SUMMARY` 包含：

- `exitCode: 0`、`reports: 1`；
- `scenario: tutorial-recall/multi-turn`、`turns: 2`；
- `contextPath: CONTEXT.md`；
- 报告 mode 为 `borrowed`、provision 为 `plan:local`、effects 为 `none`。

完整 CLI、effects.use/inline、TargetTags、报告分目录和失败语义见[原生 Recall 规范](../../spec/recall.md)。默认教程、单测和 CI 不调用真实 provider；真实场景仓入口见 [`integrations/README.md`](../../../integrations/README.md)。
