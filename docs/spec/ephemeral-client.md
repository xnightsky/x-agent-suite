# Ephemeral Client Carrier

> 状态：已实现 Carrier 配置解析与 Recall 执行接线；真实 Provider 验证不属于默认测试。

## 目的

让多种基于渠道的临时真实 Client 与 CLI Carrier 同级声明和选择，同时复用现有 target、provider/model、TargetTags 与 live 审批语义。

本契约固定 Carrier 配置形态、解析边界与 Recall Adapter 接线。Client Adapter 复用 `registry.profiles`，不从配置声明推断真实验证已经通过。

## 模型决策

- **Carrier 是执行载体的逻辑标识**，不再仅限于宿主 CLI。
- 每个 Carrier 与 `pi` 同级，使用可选 `kind` 区分实现类型；缺省为 `cli`，保持现有配置兼容。
- `ephemeral-client` 使用 `clientRef` 引用消费者注册的真实 Client Adapter。
- 多个 Carrier 可以复用同一渠道目录，但不复制 endpoint、凭据或模型配置，也不引入根级 `ephemeralClients + target` 第二套选择模型。
- Target 仍是 `(carrier, provider, model)`；Carrier 的不同执行实现必须形成不同的报告归因。

不采用 `carriers.cli.pi` / `carriers.ephemeralClients.*` 分组，因为那会改变现有 Carrier ID、TargetTags 引用和报告身份。

## 配置格式

```yaml
carriers:
  pi:
    # kind 可省略；缺省即为 cli。
    kind: cli
    providers:
      kimi-coding:
        models: [kimi-for-coding]
        # 现有 wire/baseUrl/凭据声明保持不变。
    default: kimi-for-coding

  recall-http:
    kind: ephemeral-client
    clientRef: recall-http
    channelsFrom: pi
    default: kimi-for-coding

  recall-sdk:
    kind: ephemeral-client
    clientRef: recall-sdk
    channelsFrom: pi
    default: kimi-for-coding
```

`recall-http` 与 `recall-sdk` 是和 `pi` 同级的两个 Carrier。二者复用 `pi` 的渠道目录，但分别选择不同的临时 Client Adapter。

## 字段与不变量

| 字段           | 适用 kind                 | 语义                                                               |
| -------------- | ------------------------- | ------------------------------------------------------------------ |
| `kind`         | 全部                      | `cli` 或 `ephemeral-client`；省略时归一为 `cli`                    |
| `clientRef`    | `ephemeral-client`        | 必填，引用消费者 registry 中的临时 Client Adapter                  |
| `providers`    | 全部                      | 当前 Carrier 自己持有的可选渠道目录，沿用现有结构                  |
| `channelsFrom` | 主要为 `ephemeral-client` | 引用另一个 Carrier 的渠道目录，避免复制连接与凭据声明              |
| `default`      | 全部                      | 当前 Carrier 自己的默认 target 集合，不从渠道来源 Carrier 隐式继承 |

约束：

1. `clientRef` 对 `ephemeral-client` 必填，对 `cli` 禁用。
2. `channelsFrom` 与本地 `providers` 互斥，避免同一 Carrier 出现两份渠道事实源。
3. `channelsFrom` 只能指向直接持有 `providers` 的 Carrier；禁止链式引用与循环。
4. 来源 Carrier 只提供可选渠道目录，不转移自己的 `default`、`kind` 或执行实现。
5. `channelsFrom` 若涉及 `from: harness` 或借用凭据，backend 的借用解析仍以来源 Carrier 为键；执行报告继续使用当前 Carrier，二者不得混用。
6. `kind/clientRef/channelsFrom` 是 Carrier 级元数据，不得作为普通继承字段下传到 Provider 或 LiveChannel。
7. 无参数执行仍然拒绝；`default` 只在显式选择当前 Carrier 后展开。

## Target 解析

以 `recall-http` 为例，目标解析关系为：

```text
carrier   = recall-http
kind      = ephemeral-client
clientRef = recall-http
channel   = 从 carriers.pi.providers 解析
provider  = kimi-coding
model     = kimi-for-coding
```

最终 Target 仍为：

```text
(recall-http, kimi-coding, kimi-for-coding)
```

其中 `recall-http` 是执行归因身份，`pi` 只是渠道目录来源；报告不得把这次调用归因为 `pi` 的 CLI 执行。

## Recall Adapter 接线

临时 Client 复用现有 `registry.profiles`，以配置中的 `clientRef` 作为键：

```ts
const registry: RecallRegistry = {
  criteria: consumerCriteria,
  profiles: {
    "recall-http": {
      carrier: "recall-http",
      createDriver: ({ spec, backend, target, clientRef, effects }) =>
        createConsumerEphemeralDriver({
          scenarioProvision: spec.provision,
          backend,
          target,
          clientRef,
          effects,
        }),
    },
  },
  effectsProfiles: {},
};
```

Profile 的 `carrier` 必须与临时 Carrier ID 一致。`createDriver` 上下文中的 `cliRef/clientRef` 恰居其一；ephemeral-client 接收 `clientRef`、`spec.provision`、本次 `executionParams` 与显式 effects Plan，生命周期由 Adapter 兑现。未注册或 carrier 不匹配时在 Driver 创建前失败，不回退其他实现。

## direct / borrowed 边界

- `kind: cli`（含省略 kind）始终走真实 CLI 的唯一 borrowed Profile，即使无 provision 且 effects:none 也不走 HTTP direct。
- 基于渠道直接请求 Provider 的 `kind: ephemeral-client` 属于 direct 模型调用路径，但只由 `clientRef` 指定的临时 Client Adapter 执行，不存在内置 direct fallback。
- 如果实际执行是“临时启动真实 CLI，再由 CLI 请求 Provider”，Carrier 本质仍是 `kind: cli`，临时性由该 CLI 的 execution profile 兑现，不应另建 channel-client Carrier。
- 任一实现失败不得跨 Carrier、跨 `clientRef` 或跨 direct/borrowed 静默回退。
- 每次命令可用 `--execution-params <JSON对象>` 向选中的 `createDriver` 传入运行参数（如思考强度）。框架不解释宿主字段，不修改 kind/渠道/权限；Client Adapter 只在自己确实需要时读取自己的配置，不因 channelsFrom 自动读取 Pi settings。
- 原先依赖内置 HTTP direct 的调用须迁移为显式 `ephemeral-client + clientRef`；没有跨路径兼容 fallback。

## Recall 选择

Recall 继续使用现有 target 参数，不增加 `--ephemeral-client`：

```bash
x-agent-suite recall \
  --carrier recall-http \
  --provider kimi-coding \
  --model kimi-for-coding \
  --live-config ~/.env.e2e.yaml \
  --registry ./registry.ts \
  --approve-live \
  .recall/project-rules.yaml
```

选择 `pi` 表示 CLI 路径；选择 `recall-http` 或 `recall-sdk` 表示对应的临时 Client 路径。现有多 default 展开规则保持不变，需要单一 target 时仍须显式选择 provider/model。

## 配置归因与运行证据

配置只证明“选择了哪个临时 Client 验证项”，不证明真实 live 已完成。报告需要分开表达：

- **配置归因**：Carrier、kind、clientRef、渠道来源、provider/model 与 direct/borrowed。
- **运行证据**：真实 Client 创建、隔离与 no-session 状态、真实 Provider 响应、行为判据，以及成功/失败/skip 全路径清理。

运行证据字段仍由具体 Adapter 与消费者验证定义；不得仅由 `kind: ephemeral-client` 或 `clientRef` 生成 `verified=true`。

## 验证分层

- `packages/llm-fixture/tests/live-config-carriers.test.ts` 与 `packages/recall/tests/recall.test.ts` 使用临时合成配置、fake transport 或 MockDriver，覆盖 schema、渠道引用、target 解析、fail-closed、provision/Plan 接线、归因与脱敏，不声称完成 ephemeral-client live。
- 真实 Client Adapter 访问真实 Provider 的验证属于 `*.token.ittest.ts`，必须经过显式 token 入口、live 审批、限额、脱敏与清理。
- 现有 Recall fake 测试通过，不等于新增 Carrier 的真实 direct/borrowed 路径已获验证。
