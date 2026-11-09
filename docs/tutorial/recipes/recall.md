---
title: "Recall：显式 target、场景 plans 与 effects-only Plan"
type: tutorial
status: active
tags: [tutorial, recall]
---

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

## 逐轮断言与位置归因

线性 turn 不需要额外的节点标识字段。直接在各轮声明 `expect` 即可，框架用 0-based `turnIndex` 归因：

```yaml
cases:
  - id: linear-turns
    turns:
      - send: 准备回答
        expect:
          judge:
            ready:
              rubric: 是否准确说明准备结果
      - send: 给出最终结论
        expect:
          text-contains: [最终答案]
          judge:
            grounded:
              rubric: 是否使用了本轮证据
    expect:
      judge:
        final_quality:
          rubric: 最终答案是否满足任务要求
```

当前轮断言在下一次 `send` 前完成。上例产生 `turn.0.judge.ready`、`turn.1.judge.grounded`、机械判据原名 `text-contains` 和 `judge.final_quality`；各评价点独立调用和计分。既有旧考卷不需要补任何标识字段。

可直接验收的落盘考卷是 [`packages/recall/tests/fixtures/turn-assertion/.recall.yaml`](../../../packages/recall/tests/fixtures/turn-assertion/.recall.yaml)，由 `packages/recall/tests/recall-turn-assertion.test.ts` 经官方 CLI 验证位置归因、调用顺序和 rawScore。完整契约见 [Recall 轮次级断言](../../spec/recall-turn-assertion.md)。

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

## 流式进度与详细诊断

默认模式已经逐 case 流式输出结果和最终汇总。排障时直接增加 verbosity，不需要另跑一套命令：

```bash
x-agent-suite recall --carrier consumer-carrier --registry registry.ts -vv .recall/project-rules.yaml
```

- `-v`：查看 case/repeat 开始与结束、耗时和报告路径；
- `-vv`：继续查看每轮开始/结束和逐判据理由；
- `-vvv`：继续查看完整脱敏 prompt、Observation、DriverEvent、repeat 结果与错误堆栈；
- 也可使用 `--verbose`、`--verbose 2`、`--verbose=3`；混合出现时累加，最高 3。

所有级别都保持相同执行顺序、报告和退出码。`-vvv` 在每轮完成时立即输出该轮结构化事件，不把某个宿主的原始 token 协议当作通用接口。完整级别表见 [Recall 规范](../../spec/recall.md#流式输出与-verbosity)。

直接终端运行时会自动显示图标、颜色、运行中状态和汇总框；管道到文件或 CI 时保持纯文本，不包含动态清屏。需要关闭颜色时设置 `NO_COLOR=1`，实时 case 进度仍然保留。

结果行会同时给出 `rawScore=贡献总和` 和 `assertions=通过数/总数`。`-vv` 的逐判据行中，`score` 是 0..1 归一化结果，`contribution` 才是 `hit/miss` 配置的实际贡献；例如通过且 `hit: 3` 时显示 `score=1 contribution=3`，case 对应 `rawScore=3`。

## 实际执行链

```text
.env.e2e.yaml → 显式 target/default 集合 → TargetTags/live
  → effects-only Plan + 唯一 borrowed profile
  → Recall YAML 编译出的 ScenarioSpec.provision
  → 既有 runScenarioRepeat → metadata.recallExecution
```

Runner 只消费场景 provision，不做执行 provision 合并。资源 source/destination 经过 realpath 与逃逸校验；profile 负责物化和 finally cleanup。挂载不等于模型实际读取，行为仍由 Observation/Criterion 验证。

## case 级断言直接计分（已实现）

一期作者配置可直接声明机械 session 判据与内置 Judge；简写 Judge 如下，完整形态另支持 `rubrics/timeoutMs/maxRetries/instructions`：

```yaml
cases:
  - id: answer-quality
    turns:
      - send: 准备回答
      - send: 给出最终结论
    expect:
      output-shape:
        required: [summary]
        score: { hit: 2, miss: 0 }
      judge:
        accurate:
          rubric: 是否准确
          score: { hit: 3 }
        concise:
          rubric: 是否简洁
          score: { miss: 0 }
```

多个 `judge.*` 分别判断效果并贡献分值，同一评价点仍批量裁定，不代表调用多个裁判模型。不同效果不同分数不需要 Decision；`score` 可选，`scope` 仅区分评价范围。

上例 `output-shape` 是消费者注册、且显式 opt-in 分值解析的机械判据，不是所有机械判据都可直接添加 score。支持自定义分值的插件应允许省略 score，并沿用统一默认值；既有输入形状不变。resolver 按插件协议提取分值，例如：

```ts
const criterion = {
  name: "output-shape",
  scope: "session" as const,
  assertionScore: (expect: unknown) =>
    (expect as { score?: { hit?: number; miss?: number } }).score ?? {},
  evaluate: () => ({ pass: true, score: 1, reason: "结构合法" }),
};
```

resolver 仅对实际引用在装配预检同步调用并按 case 缓存；非法返回或抛错为 CLI=2。未注册 resolver 时，Recall 不解释插件 `input.score`。score 省略或空对象默认 hit=1/miss=-1，部分覆盖独立默认。

报告 `artifact.outcomes` 保留原始 0..1 分数，`artifact.assertions` 保存 name/source/pass/reason/贡献，`artifact.rawScore` 为贡献和；所有断言通过才通过，正总分不抵消失败。缺裁定/判据结果与调用、超时、解析失败为 CLI=1，非法定义为 CLI=2，内容失败为 CLI=0。计分正式契约见 [Recall 断言计分](../../spec/recall-scoring.md)，Judge 执行契约见 [Judge DSL](../../spec/recall-judge-dsl.md)。

可复制的真实场景仓见 [Recall 断言计分示例](../../../integrations/itrepos/recall-scoring/README.md)：`mechanical/.recall.yaml` 覆盖六种机械分值各自的命中/未命中，根 `.recall.yaml` 演示机械/AI 混合及逐轮/最终同名归因。README 给出字段说明、全部预期贡献、零 token 回归与各自独立的显式 token 入口；扩展机械示例不增加最小混合考卷的五次调用预算。

> 本 recipe 的 `pnpm tutorial:recall` 仍展示消费者手动组合 Judge client 与 Assertions；一期内置 DSL 的默认验证位于 `packages/recall/tests`，使用 fake transport 和官方 CLI 子进程，零 token。
>
> 真实宿主补充验证：`E2E_PI_RECALL=1 pnpm exec tsx --test examples/tutorial/18-recall-judge-host.ittest.ts`。该用例默认 skip，显式开启后使用真实 Pi headless + loopback fake provider，验证两次主单轮请求、独立 Judge、报告和清理，零 token；不覆盖共享 PTY 历史。真实 provider 另有 Cedar 单轮 live smoke，见 integrations/itrepos/cedar/README.md。

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

## 局部标准 / 降级：firstOf

将参与降级的条件圈在 `expect.firstOf.<评价点>` 下，其他普通机械断言、平铺 Judge 和其他评价点仍全部必过。数组顺序决定优先级，不按 hit 大小排序。

```yaml
expect:
  judge:
    honesty: { rubric: 不得虚报未运行的验证 }
  firstOf:
    quality:
      - name: standard
        score: { hit: 3, miss: -1 }
        expect:
          judge:
            complete: { rubric: 入口、完整清单及所有安全底线均正确 }
      - name: downgrade
        score: { hit: 1, miss: -1 }
        expect:
          judge:
            minimum: { rubric: 入口与安全底线均正确，允许省略清单 }
```

标准通过后不请求降级 Judge；完整合法的内容失败才进入下一档，缺裁定、超时、解析或清理错误不能降级。一个组合只贡献 +3、+1 或一次 -1；普通 honesty 的贡献另算，它失败时总分为正也不能通过。档内 rubric 不允许独立 score，不支持嵌套 firstOf。`turn.expect` 同样支持，且完成评价后才允许下一轮 send。

完整可运行考卷、素材、预期结果和授权 token 入口见 [firstOf 场景](../../../integrations/itrepos/recall-scoring/first-of/README.md)，契约见 [firstOf 规格](../../spec/recall-first-of.md)。先运行默认安全回归：

```sh
pnpm exec tsx --test scripts/tests/recall-first-of-config.test.ts
```

该回归使用临时配置、fake Driver/裁定、真实 provision 与消费者 evidence，经官方 CLI 核对 11 个样本；不产生 token。真实模型验收必须另行授权，不能用 skip 或 fake 回归替代。
