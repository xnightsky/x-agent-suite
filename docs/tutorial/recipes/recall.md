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

## 教程断言

`TUTORIAL_SUMMARY` 包含：

- `exitCode: 0`、`reports: 1`；
- `scenario: tutorial-recall/multi-turn`、`turns: 2`；
- `contextPath: CONTEXT.md`；
- 报告 mode 为 `borrowed`、provision 为 `plan:local`、effects 为 `none`。

完整 CLI、effects.use/inline、TargetTags、报告分目录和失败语义见[原生 Recall 规范](../../spec/recall.md)。默认教程、单测和 CI 不调用真实 provider；真实场景仓入口见 [`integrations/README.md`](../../../integrations/README.md)。
