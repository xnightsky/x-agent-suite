# TargetTags：四层实例与访问决策

## 目标与边界

TargetTags 用统一的 TagKey/TagValue 描述 CLI、provider、provider × model 和 canonical model 的能力，并据此评估完整 live target 的 direct / borrowed 候选与 live 门禁。

它是一套独立通用能力，不隶属 Judge；Judge 是其中一个消费者，通过 `decideLiveTarget` 使用相同目录和决策，不另建渠道注册表。

硬约束：

- `packages/*/src/` 只实现通用机制，不枚举具体 CLI、provider 或 model；真实公共实例放在根目录组合层 `config/target-tags/`。
- 不复制 live 端点、凭据、账号信息或模型选择配置，不发起网络请求。
- `loadLiveConfig / resolveLiveTargets` 仍是配置发现、可选目录、default 和完整 target 解析的唯一入口。
- 标签描述已声明事实，不证明当前健康、剩余额度或运行必然成功。

## 文件职责

```text
config/target-tags/
├── keys.yaml                  # TagKey/TagValue 词典，不含真实实例
└── instances.yaml             # 可公开复用且有证据的四层实例

packages/llm-fixture/src/
├── target-tag-types.ts        # 公开类型
├── target-tags.ts             # YAML 加载、校验与私密覆盖合并
└── target-tag-decision.ts     # direct / borrowed / live 纯决策
```

### 词典

`keys.yaml` 注册合法标签。TagId 形态为：

```text
<TagKey>.<TagValue> = <scope>.<dimension>.<value>
```

TagKey 有三种状态：

| 状态         | 含义                       | 实例是否可使用     |
| ------------ | -------------------------- | ------------------ |
| `maintained` | 当前维护的 key/value       | 可以               |
| `reserved`   | 预留未来维度，当前无 value | 不可以，不产生能力 |
| `deprecated` | 仅为历史解释保留           | 新实例不可以       |

未注册 key/value、reserved 或 deprecated 赋值、作用域错配、重复声明和未知字段都会抛 `TargetTagDefinitionError`。实例 schema 不开放 `apiKey`、`baseUrl` 等字段，避免把秘密或第二份模型配置塞进标签文件。

### 四层实例

| 层                  | 身份与关联                                                | 描述内容                                                  |
| ------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| `CliTags`           | `id + carrier`，另有 `wires`                              | CLI 产品能力目录；必要时以后可拆同 carrier 的调用 profile |
| `ProviderTags`      | `id`                                                      | provider 默认 auth、usage 与 live 敏感策略                |
| `ProviderModelTags` | `providerRef + model`，可选 `modelRef/modelRevision/wire` | provider 对模型别名提供的 API、认证和 usage 差异          |
| `ModelTags`         | canonical `id + revision?`                                | 模型自身 inference 能力                                   |

不维护 CLI × provider 交叉标签。direct 使用 Provider / ProviderModel / Model；borrowed 还需使用 Cli，并检查 CLI 与 ProviderModel 的 wire 兼容。

CLI 条目当前是**产品能力目录**，不是默认执行状态。例如 `cli.session.ephemeral` 和 `cli.tools.none` 只表示 CLI 能提供对应开关；borrowed 调用方仍须实际落实 no-session、禁工具等启动参数，运行失败不得自动换模式。

需要干净 borrowed 启动时，上下文隔离必须精确到 `cli.context.context-files.off`、`extensions.off` 和 `skills.off`，分别对应禁止发现 AGENTS/CLAUDE 指令、禁止 extensions 和禁止 skills；不能由笼统的 `resources.off` 或单次新进程反推。

工具需求由具体任务决定：纯文本判定可以要求 `cli.tools.none`；需要读取仓库证据时应要求 `cli.tools.allowlist`，并在确实具备只读工具或执行策略时另要求 `cli.tools.read-only`。allowlist 不等于命令级只读，调用方必须落实实际工具/命令策略，缺失时不得降级放行。

## 公共实例与私密覆盖

### 公共实例

`instances.yaml` 只收可公开复用且有证据的条目，不镜像全部本机配置，也不收私有渠道。当前基线：

| 层            | 当前实例                                                                                                | 已声明事实                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| CLI           | `pi`、`kimi`                                                                                            | 官方文档可确认的 execution/session/context/tools/io 能力             |
| Provider      | `kimi-coding`                                                                                           | 仅保留公共父引用；账号 tags 为空                                     |
| ProviderModel | `kimi-coding/k3`、`kimi-coding/kimi-for-coding`（OpenAI Chat）、`kimi-coding/kimi-for-coding-anthropic` | 各 wire 分别声明 `complete`、`tools`；同 canonical model 不共享 wire |
| Model         | `k3`、`kimi-for-coding`                                                                                 | `chat`、`reasoning`、`vision`                                        |

`k3` 与 `kimi-for-coding` 是不同 canonical 条目，不互相设置别名。公共实例出现不代表它必然在当前 `.env.e2e.yaml` 的可选目录或 default 中；是否可选仍由 live 配置决定。

大部分实例 tag 使用行内后缀注释记录证据和边界。ModelTags 只映射 Pi bundled catalog 中明确的 `type/reasoning/input` 字段，不从模型名、价格或 CLI 功能猜测其他能力。当前未做各 CLI 参数组合的运行验证。

空 `tags` 表示未声明，不表示官方禁止。账号 auth、usage 和 live 不得从 `from/credential/apiKey` 或历史调用成功推断。

### 私密 `targetTags`

私有或自定义渠道留在私密 live 配置，不进入公共 `instances.yaml`。现有配置文件可在根级增加与 `carriers` 并列的可选 `targetTags`：

```yaml
carriers:
  example-carrier:
    providers:
      private-provider:
        models: [default/private-model]
        # wire/baseUrl/凭据仍按现有 live 配置维护，此处不复制。

targetTags:
  version: 1
  providers:
    - id: private-provider
      tags: [provider.usage.api-payg, provider.usage.live.review-required]
  providerModels:
    - id: private-provider/default-private-model
      providerRef: private-provider
      model: default/private-model
      modelRef: private-canonical
      wire: openai-chat
      tags: [provider-model.api.complete]
  models:
    - id: private-canonical
      tags: [model.inference.chat]
```

这样，非规范模型别名可以在本机声明自己的 canonical `modelRef`，无需把私有渠道写进仓库。真实 `~/.env.e2e.yaml` 不由框架自动修改。

调用 `loadTargetTagCatalog({ liveConfig })` 且 `liveConfig.kind === "loaded"` 时，加载器复用已经发现的 `liveConfig.path`，读取同文件根级 `targetTags` 并与公共实例合并；不另建配置发现顺序，也不把 `carriers` 或凭据返回在 catalog 中。

合并规则：

1. CLI、Provider、ProviderModel 按 `id` 合并；Model 按 `id + revision` 合并。
2. 同 ID 的 tags 求去重并集；覆盖项中已定义的标量生效，省略的可选字段保留公共值。
3. 新私有 ID 追加到对应层；合并后统一检查引用和 ProviderModel 身份唯一性。
4. live 不按普通并集放行，仍执行下述最严格优先规则，私密覆盖不能抹掉公共 `disallowed`。

## Provider 默认值与 canonical 引用

ProviderModel 可以只写差异，避免逐模型复制 provider 默认值：

- `provider.auth` 在 ProviderModel 未声明 auth 时映射为生效的 `provider-model.auth`；一旦模型级声明 auth，该维度使用模型级声明。
- `provider.usage` 的非 live 值按同样方式继承；ProviderModel 只声明 live 值时，不会抹掉 provider 的非 live usage 默认值。
- live 值始终单独按敏感策略合并，不当作普通 usage 继承。

`modelRef` 必须指向已声明的 canonical ModelTags；有 revision 时必须同时精确匹配。相同 provider 模型字符串不自动共享 ModelTags，未确认 canonical 对应时省略 `modelRef`，相应模型能力保持未知。

## 决策 API

```ts
const live = await loadLiveConfig(config);
if (live.kind !== "loaded") {
  // 按现有 not-configured 流程处理。
}

const catalog = await loadTargetTagCatalog({ repoRoot, liveConfig: live });
const result = decideLiveTargets(live, catalog, {
  selection: consumerSelection,
  requirements: consumerRequirements,
  liveReviewApproved: false,
});
```

`decideLiveTargets` 内部调用现有 `resolveLiveTargets(load, selection)`，不重新实现模型匹配。selection 至少包含 carrier/provider/model 之一；无参数会拒绝，carrier-only 可展开多个 defaults，provider/model 继续过滤。`requirements.direct` 与 `requirements.borrowed` 都由调用方按用途声明：

已有完整 `ResolvedLiveTarget` 的消费者可调用 `decideLiveTarget(target, catalog, options)`；它使用同一套 requirements/live 参数但不需要 `selection`，避免 Judge 等调用方为了决策重新构造 `LiveConfigLoad`。

- `allOf`：每一项都必须满足；
- `anyOf`：每一组至少满足一项；
- direct 不得声明 `cli.*` 需求；
- 所有需求 TagId 同样经过词典校验。

结果保持 `configured / not-configured` 分层。每个已解析 target 返回：

- `evaluations`：全部 direct / borrowed 评估，含 `missingGroups` 和兼容性问题；
- `candidates`：其中当前允许的所有候选，不设置 direct 或 borrowed 优先级；
- `live`：合并策略与本次审批后的放行状态；
- `target`：原有完整 `(carrier, provider, model)`，供归因。

borrowed 评估保留 `cliRef`。如果同一 target 有多个候选，标签层返回全部，不替调用方选择，也不在执行失败后跨模式回退。

### live 门禁

相关 ProviderTags 与 ProviderModelTags 按固定顺序合并：

```text
disallowed > review-required > allowed > unknown
```

- 任一 `live.disallowed`：禁止，direct 和 borrowed 都不得绕过。
- 否则任一 `live.review-required`：只有本次已显式审批后才允许。
- 否则任一 `live.allowed`：允许。
- 全部未声明：`unknown`，默认不允许；它不等同于明确禁止。

`liveReviewApproved: true` 只能表示调用方已经取得本次审批，不能把 disallowed 或 unknown 变成允许。`live` 参数缺省为 `true`；仅在做 fixture/非 live 能力判断时显式设为 `false`，此时仍返回真实 live 策略供诊断。

候选的 `allowed` 同时要求能力需求、引用/wire 兼容和 live 门禁通过。决策函数只返回结果，不执行 direct 或 borrowed 调用。

## 验证与未验证项

零网络回归入口：

```bash
pnpm exec tsx --test packages/llm-fixture/tests/target-tags.test.ts
pnpm --filter @x-agent-suite/llm-fixture typecheck
```

覆盖词典与实例校验、私密合并且不带出凭据、provider 默认值、双候选、wire、live 优先级、真实公共实例 unknown 不放行，以及 target 解析失败透传。

未验证项保持不变：CLI 各版本与参数组合的实际运行、具体账号套餐/授权、真实 direct/borrowed 调用和运行时健康均不由静态标签证明。
