# Pi `models.json` 与 `auth.json` 的关联及凭据解析

> 研究对象：本机安装的 `@earendil-works/pi-coding-agent@1.4.0` 与同版本 `@earendil-works/pi-ai@1.4.0`。
>
> 本文只使用安装包内官方文档、编译后 JS 与类型声明。未读取真实 `~/.pi/agent/auth.json`、`models.json` 或其他真实凭据，未执行凭据命令，未发起 live provider 请求。结论不自动适用于其他 Pi 版本。

## 1. 证据口径与路径缩写

- **[文档明示]**：Pi 官方文档直接说明的行为。
- **[源码结论]**：沿当前安装版调用链得到的静态结论，不代表已做 live 验证。
- **[未验证]**：需要真实服务、真实凭据、交互 UI 或其他版本才能确认，不在本次验证范围内。

路径缩写：

- `$PI` = 包管理器解析出的 `@earendil-works/pi-coding-agent` 安装根目录；引用均写成包内相对路径。
- `$AI` = `$PI` 内 `@earendil-works/pi-ai` 依赖目录（通常为 `node_modules/@earendil-works/pi-ai`）。
- 版本依据：`$PI/package.json:2-4`、`$AI/package.json:2-4`。

## 2. 结论速览

| 目标问题                        | 结论                                                                                                                                                                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 两个文件如何关联                | `models.json.providers` 的对象键就是 provider ID；`auth.json` 以**完全相同的 provider ID**索引凭据。不是按 `name`、`baseUrl`、API 类型或模型 ID 匹配。                                                                                                                        |
| 凭据优先级                      | 对同一 provider：`--api-key` 运行时覆盖 → `auth.json` 条目 → `models.json` 的 `apiKey` → 内建 provider 的环境变量或 ambient credentials。后两级依赖 provider 是否有对应解析器；provider 扩展可改变行为。                                                                      |
| 自定义 provider 能否用 `/login` | **API key 可以。** 普通静态自定义 provider 会获得默认 API-key 登录方法，`/login` 按 provider ID 写入 `auth.json`，之后该存储条目优先于 `models.json.apiKey`。**OAuth 不是通用能力**：必须有内建、扩展或 `oauth: "radius"` 提供的 OAuth 处理器。                               |
| 条目结构                        | API key：`{ type: "api_key", key?: string, env?: Record<string, string> }`；OAuth：`{ type: "oauth", access: string, refresh: string, expires: number, ...providerSpecificFields }`。`expires` 与 `Date.now()` 比较，是毫秒时间戳。                                           |
| 何时解析、是否回退              | 配置加载与可用性检查会读取部分凭据；实际请求前还会解析。缺失条目才进入下一来源；已有条目的类型无匹配处理器、OAuth 刷新失败、`models.json.apiKey` 插值/命令失败均不会静默改选更低优先级来源。存储 API-key 解析器可以在自身内部按字段补环境值，这是例外而非通用的“失败后回退”。 |

## 3. provider 键与 `auth.json` 条目如何匹配

### 3.1 文档明示

`models.json` 的每个 `providers` 键都是 provider ID；内建 ID 表示修改内建 provider，其他 ID 表示新增 provider。证据：`$PI/docs/models-configuration.md:9-12`。Azure 文档也明确要求同一个 ID 用于 `auth.json`、`models.json`、`settings.json` 和模型引用，证据：`$PI/docs/providers.md:136-140`。

### 3.2 源码结论

关联链是直接的字符串索引，没有别名或规范化步骤：

1. `ModelConfig.load()` 遍历 `Object.entries(parsed.providers)`，原样以 `providerId` 放入 Map；`getProvider(providerId)` 原样查询。证据：`$PI/dist/core/model-config.js:152-160`，关键函数 `ModelConfig.load`、`getProvider`。
2. 自定义模型生成时，`modelFromJson()` 把同一个 `providerId` 写入 `model.provider`。证据：`$PI/dist/core/provider-composer.js:83-115`，关键函数 `modelFromJson`。
3. `AuthStorage.read(provider)` 直接读取 `data[provider]`。证据：`$PI/dist/core/auth-storage.js:376-384`，关键函数 `AuthStorage.read`。
4. 登录成功时，`ModelsImpl.login()` 用所选 `provider.id` 调用 `credentials.modify(providerId, ...)`，把返回凭据写到同一条目。证据：`$AI/dist/models.js:357-403`，关键函数 `ModelsImpl.login`。

因此关联键是**区分大小写的精确 provider ID**。同一个逻辑服务若配置成两个 provider ID，就需要两份独立凭据；同一 provider ID 下则只有一个当前存储凭据。

## 4. 四类来源的准确优先级

### 4.1 总顺序

**[文档明示]** 官方给出的顺序为：运行时 `--api-key` → 存储的 `auth.json` 凭据 → `models.json` 的 `apiKey` → provider 环境变量或 ambient cloud credentials；provider 扩展可定义自己的认证行为。证据：`$PI/docs/models.md:17-24`。

**[源码结论]** 当前实现与文档一致，但需补充以下边界：

| 优先级 | 来源                        | 实现与范围                                                                                                                                                                                                                                          |
| ------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | CLI `--api-key`             | `RuntimeCredentials.read()` 先查 provider 维度的内存覆盖，命中就构造 `{ type: "api_key", key }`，不读取持久条目。证据：`$PI/dist/core/runtime-credentials.js:8-21`。                                                                                |
| 2      | `auth.json`                 | `resolveProviderAuthWithSignal()` 先读存储条目；OAuth 条目交给 OAuth 处理器，API-key 条目交给 API-key 处理器。证据：`$AI/dist/auth/resolve.js:14-34`。                                                                                              |
| 3      | `models.json.apiKey`        | 没有存储条目时，组合后的 API-key 解析器先处理 `rawKey`；其值来自 `models.json`（若无更高层扩展覆盖）。证据：`$PI/dist/core/provider-composer.js:225-227,284-302`，关键函数 `configuredApiKey`、`composeApiKeyAuth.resolve`。                        |
| 4      | provider 环境变量 / ambient | 没有存储条目且没有 `models.json.apiKey` 时，才调用继承自内建 provider 的 `resolve()`。证据：`$PI/dist/core/provider-composer.js:293-302`。标准环境变量解析器依次读取其声明的变量，证据：`$AI/dist/auth/helpers.js:7-29`，关键函数 `envApiKeyAuth`。 |

`models.json.apiKey: "$SOME_VAR"` 虽然也从环境取值，但在来源顺序上仍属于第 3 级“配置的 API key”，不是第 4 级内建 provider 的自动环境认证。普通、无内建基座的自定义 provider 不会凭空知道某个环境变量；应通过 `apiKey` 插值、`/login` 或扩展显式提供。

### 4.2 `--api-key` 的精确定位

**[文档明示]** 它是非持久 API-key 覆盖，需要通过 `--model` 或 `--models` 选定模型，不负责在多个 provider 之间做选择。证据：`$PI/docs/cli.md:63-72`。

**[源码结论]** CLI 在模型已选定后调用 `setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey)`，所以覆盖键是**所选模型的 provider**，不是全局所有 provider。证据：`$PI/dist/main.js:667-676`。模型解析使用全部模型以支持首次提供 key，并明确“inline key 去所选 provider、不能用来消除跨 provider 歧义”，证据：`$PI/dist/core/model-resolver.js:308-335`。

## 5. 自定义 provider、`/login` 与条目结构

### 5.1 普通自定义 provider 可以使用 `/login` 写入的 API key

**[源码结论]** 可以，且不需要 provider 扩展：

1. 对没有内建基座的普通静态 provider，`composeApiKeyAuth()` 合成一个默认 `login()`，提示输入 secret 并返回 `{ type: "api_key", key }`。只有“无继承 API-key 方法、无配置 key、但存在 OAuth”的 OAuth-only 情况才不合成该方法。证据：`$PI/dist/core/provider-composer.js:244-259`。
2. `/login` 的 provider 列表枚举所有已组合 provider 的 `auth.apiKey` / `auth.oauth`；API-key 方法存在 `login` 时进入 API-key 登录对话框。证据：`$PI/dist/modes/interactive/interactive-mode.js:4784-4816,4860-4869`。
3. 登录结果按 provider ID 写入存储，证据见第 3.2 节。
4. 后续解析时存储条目先于 `models.json.apiKey`，证据见第 4 节。

这也意味着：若同一个自定义 provider 同时有 `models.json.apiKey` 和 `/login` 写入的 API key，实际优先使用后者；`/logout` 删除存储条目后才会重新使用配置来源。官方文档明确 `/logout` 不会移除 `models.json` 认证，证据：`$PI/docs/providers.md:10-18`。

### 5.2 OAuth 不能靠添加一段 JSON 通用启用

**[文档明示]** 需要存储凭据、自定义解析或登录方法的集成应使用原生 provider 认证；OAuth provider 注册后出现在 `/login`，返回凭据存入 `auth.json`。证据：`$PI/docs/custom-provider.md:126-141`。仅改内建 provider 的 `baseUrl` 会保留其模型与认证，证据：`$PI/docs/models.md:67-77`。

**[源码结论]** 存储 OAuth 条目只有在当前 provider 具有 `auth.oauth` 时才会使用；否则直接返回未配置，不会转成 API key 或改用环境变量。证据：`$AI/dist/auth/resolve.js:24-38`。

`models.json` 的声明式 OAuth 字段在当前 schema 中仅接受 `"radius"` 且要求 `baseUrl`，证据：`$PI/dist/core/model-config.js:66-83`、`$PI/docs/models-configuration.md:15-23`。`ModelRuntime.configureRadiusProviders()` 为该自定义 provider ID 构造 Radius 内建 provider，因而获得真实 OAuth 流程。证据：`$PI/dist/core/model-runtime.js:119-132`。

所以应分三种情况：

- **普通自定义静态 provider**：默认支持 `/login` 写 API key；不支持任意 OAuth。
- **以内建 provider ID 做覆盖**：保留该内建 provider 原有 OAuth 能力。
- **需要新 OAuth 流程**：使用 provider 扩展，或使用当前 schema 明确支持的 `oauth: "radius"`；不能只手写一个 `type: "oauth"` 条目就获得刷新和令牌转换逻辑。

### 5.3 `auth.json` 内部结构

**[源码结论]** 顶层是 `Record<providerId, Credential>`，每个 provider 一个带 `type` 判别字段的条目。类型契约见 `$AI/dist/auth/types.d.ts:11-32`；持久化 Map 类型见 `$PI/dist/core/auth-storage.d.ts:5-7`。

API key 条目：

```json
{
  "example-provider": {
    "type": "api_key",
    "key": "<secret-or-$ENV_OR_!COMMAND>",
    "env": {
      "PROVIDER_SCOPED_NONSECRET_CONFIG": "<value>"
    }
  }
}
```

- `key` 可省略，`env` 可省略；`env` 是 provider 作用域环境/配置值，不一定都是 secret。证据：`$AI/dist/auth/types.d.ts:11-19`。
- `key` 可写成前导 `!` 的命令；命令在首次需要时执行，stdout 在进程生命周期内缓存。证据：`$PI/docs/providers.md:71-84`、`$PI/dist/core/auth-storage.js:376-384`。
- 存储条目的 `env` 可优先于进程环境中的同名校验/配置值；官方示例见 `$PI/docs/providers.md:86-102`。

OAuth 条目：

```json
{
  "example-provider": {
    "type": "oauth",
    "access": "<access-token>",
    "refresh": "<refresh-token>",
    "expires": 1893456000000,
    "providerSpecificField": "<optional-value>"
  }
}
```

- 三个必需数据字段是 `access`、`refresh`、`expires`，另有 `type: "oauth"`；允许 provider 特定扩展字段。证据：`$AI/dist/auth/types.d.ts:20-32`。
- `expires` 与 `Date.now()` 比较，当前实现按 Unix epoch 毫秒处理。证据：`$AI/dist/auth/resolve.js:100-106`。
- 只读存储校验同样要求 `access`/`refresh` 为字符串、`expires` 为有限数字；API-key 校验允许可选字符串 `key` 和字符串值 `env` 对象。证据：`$PI/dist/core/auth-storage.js:184-210`。
- OAuth 的令牌转换由 provider 的 `toAuth()` 决定，不能假定所有 provider 都简单地把 `access` 当 API key。接口约束见 `$AI/dist/auth/types.d.ts:211-235`。

## 6. 凭据解析时机、缓存与失败回退

### 6.1 解析时机

**[源码结论]** 不是只有 HTTP 请求前才读取认证：

1. `ModelRuntime.create()` 加载 `models.json`，构造运行时并做初始 refresh；`ModelConfig` 自身只是 credential-blind 的结构快照。证据：`$PI/dist/core/model-runtime.js:79-117`、`$PI/dist/core/model-config.js:1-2,117-157`。
2. 可用性刷新会执行 `models.checkAuth()` 并读取凭据元数据，用于决定哪些 provider/model 可用。证据：`$PI/dist/core/model-runtime.js:189-210`。`checkAuth()` 会读取存储条目，证据：`$AI/dist/models.js:288-307`。其中 OAuth 检查只根据存储条目和 OAuth 处理器是否存在来判定可用，并不在这一步验证上游是否接受 token，证据：`$AI/dist/models.js:266-286`。
3. 打开 `/model` 会重载 `models.json`。证据：`$PI/docs/models.md:65-67`。
4. 实际 chat 请求经 `lazyStream` 调用 `prepareRequest()`，此时再次 `getAuth()`，再把解析出的 `apiKey`、headers、env 交给 provider。证据：`$PI/dist/core/model-runtime.js:452-484,486-492`，关键函数 `prepareRequest`、`stream`。
5. 模型目录刷新也可能读取或刷新存储 OAuth 凭据，证据：`$AI/dist/models.js:180-209,236-257`。

两种命令值的缓存语义不同：

| 配置位置                                  | 时机与缓存                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.json` 的 `api_key.key = "!command"` | 首次读取并需要该 key 时执行，结果（包括失败得到的 `undefined`）按命令字符串缓存到进程结束。文档：`$PI/docs/providers.md:71-84`；源码：`$PI/dist/core/auth-storage.js:376-384`、`$PI/dist/core/resolve-config-value.js:181-187`。首次需要可能发生在启动可用性检查，不应理解为只在 HTTP 前执行。 |
| `models.json` 的 `apiKey = "!command"`    | 请求时执行且不缓存；文档明确说明见 `$PI/docs/models.md:63-67`。实现走 `resolveConfigValueOrThrow()` → `resolveConfigValueUncached()`，证据：`$PI/dist/core/resolve-config-value.js:192-217`。                                                                                                  |

### 6.2 缺失与失效时的回退矩阵

**[源码结论]** 优先级是“选择哪个来源”，不是所有错误都依次尝试下一个来源：

| 情况                                          | 当前行为                                                                                                                                     | 证据                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 没有 `auth.json` 条目                         | 继续尝试 `models.json.apiKey`，再尝试继承的环境/ambient 解析器。                                                                             | `$AI/dist/auth/resolve.js:24-38`；`$PI/dist/core/provider-composer.js:284-302`。                   |
| 有存储条目，但类型没有对应处理器              | 返回 `undefined`，不进入 `models.json` 或 ambient。                                                                                          | `$AI/dist/auth/resolve.js:24-38`。源码注释也明确“无匹配 handler 不静默环境回退”，见同文件 `:4-9`。 |
| OAuth 距到期不足默认 5 分钟                   | 在存储锁内刷新并持久化；刷新失败抛 `ModelsError("oauth")`，不改用 `models.json` 或环境变量。                                                 | `$AI/dist/auth/resolve.js:46-47,62-95,100-122`。                                                   |
| `models.json.apiKey` 的环境插值缺值或命令失败 | `resolveConfigValueOrThrow()` 抛错，不转入继承的环境解析器。                                                                                 | `$PI/dist/core/provider-composer.js:293-301`；`$PI/dist/core/resolve-config-value.js:199-217`。    |
| 所有来源都未配置                              | 请求准备阶段抛 `Provider is not configured: <provider>`；模型选择器则只显示有可用认证的模型。                                                | `$PI/dist/core/model-runtime.js:452-463`；`$PI/docs/models.md:27-30,209-217`。                     |
| API key 已被选择但被上游判定无效              | 本地解析器不探测上游有效性；请求链只把当次解析结果交给 provider，没有“收到 401 后换下一来源”的逻辑。实际 401、重试与刷新表现未做 live 验证。 | `$AI/dist/auth/helpers.js:16-28`；`$PI/dist/core/model-runtime.js:452-492`。                       |

一个必须保留的细粒度例外：**存储 API-key 条目存在，不等于其 provider 解析器绝不读取环境。** `ApiKeyAuth.resolve` 的契约允许 `credential.key ?? env(...)`、`credential.env?.NAME ?? env(...)` 的按字段合并，证据：`$AI/dist/auth/types.d.ts:166-195`。例如：

- 标准 `envApiKeyAuth` 在存储 key 为空时会继续读其声明的环境变量：`$AI/dist/auth/helpers.js:16-27`。
- Bedrock 可用只有 `env.AWS_PROFILE`、甚至没有 `key` 的存储条目，再与 ambient AWS 链组合：`$AI/dist/providers/amazon-bedrock.js:39-81`。
- Vertex 会按字段组合存储 key/env 与 `GOOGLE_CLOUD_API_KEY`、ADC 文件、project/location：`$AI/dist/providers/google-vertex.js:59-82`。

这属于**当前 provider 自己的存储 API-key 解析逻辑**，不是回退到 `models.json`，也不能推广成 OAuth 刷新失败后的通用回退。

## 7. 对可选 `.env.auth.yaml` 设计的借鉴边界

以下是设计启示，不是 x-agent-suite 已采纳的契约。

### 7.1 可借鉴

1. **以消费者提供的 provider/profile ID 做显式命名空间。** 凭据查找与模型配置使用同一个稳定 ID，避免把 secret 错投给另一个 endpoint。核心只透传 ID，不枚举任何具体 provider。
2. **把一次性覆盖与持久凭据分层。** 可借鉴“运行时非持久覆盖 > 显式认证文件 > 模型/endpoint 配置 > 显式允许的 ambient”的确定性顺序，并让覆盖只作用于指定 provider/profile。
3. **用 `type` 判别凭据结构。** API key 与 OAuth 不共享一套含混字段；解析器按类型分派。provider 特定的附加配置应留在扩展数据或消费者 profile，而不是扩张通用核心契约。
4. **诊断记录来源，不记录秘密。** Pi 的 `AuthResult.source` 与无 secret 的 `list()` 值得借鉴（`$AI/dist/auth/types.d.ts:33-37,57-67,86-97`）。x-agent-suite 可报告 runtime/stored/config/ambient 等来源标签，但报告、事件和错误中不得回显 key/token。
5. **区分“可解析”与“上游已接受”。** 枚举模型时做本地可用性检查，真正请求前再解析；不要把“文件里有 key”宣称成“凭据有效”。
6. **环境插值比明文更适合可选认证文件。** `$NAME`/`${NAME}` 能避免把 secret 写入场景与报告；若支持 secret manager 引用，应明确执行时机、超时、缓存与失败语义。
7. **缺失与失败要显式。** 对指定来源的解析失败直接给出 provider/profile、来源和缺失变量名，不静默换用另一身份，尤其避免测试意外命中本机 ambient 凭据。

### 7.2 不可照搬

1. **不要把 Pi 的 provider 名、环境变量或云 ambient 链写进核心。** x-agent-suite 的领域中立要求决定了这些只能由消费者 profile/plugin 注册；Pi 的内建 provider 解析器不是通用框架契约。
2. **不要在默认测试中自动读取真实用户认证或发起刷新。** 本仓 live provider 测试必须走显式 token 集成测试车道。可选 `.env.auth.yaml` 应是显式配置输入，而不是默认回归隐式读取 `~/.pi`、云 SDK 或本机登录态的理由。
3. **不要原样复制交互式 `/login` 生命周期。** 浏览器登录、OAuth 刷新、跨进程锁和写回共享文件不适合无交互评测默认路径；若消费者确需 OAuth，应由其插件显式承担刷新、持久化与清理。
4. **不要默认引入 `!command`。** 在认证 YAML 中执行 shell 是代码执行边界，且 Pi 对 `auth.json` 与 `models.json` 的缓存策略不同。若未来确需该能力，必须另有信任、超时、脱敏和缓存设计，不能把“支持 YAML”自然扩张成“支持执行命令”。
5. **不要把“每 provider 仅一个凭据”当成所有评测场景的充分模型。** 同 provider 的多账号、多租户或并行矩阵若需要并存，应以消费者 profile/凭据集 ID 区分，而不是同时改写一份全局文件。
6. **不要复制陈旧快照容错。** Pi 的 `AuthStorage.reload()` 在读取/解析失败时保留最后有效内存快照（`$PI/dist/core/auth-storage.js:311-327`）；可复现测试更适合对显式认证文件的损坏、schema 错误和 secret 引用失败快速报错。
7. **不要把 ambient 当作可复现性的等价替代。** 本机环境可能随时间变化，且 Pi 在请求前会重新解析。评测若允许 ambient，应记录非秘密来源标签并限制在显式 live 配置中，不应让它悄然改变默认矩阵结果。

## 8. 未验证行为与证据边界

- **[未验证]** 未执行 `/login`，因此“普通自定义 provider 出现在交互选择器并写文件”是完整静态调用链结论，不是 UI 实测。
- **[未验证]** 未使用真实 OAuth token，未验证具体 provider 的刷新端点、额外字段、撤销、`invalid_grant` 或 token 轮换。
- **[未验证]** 未发送请求，未验证上游 401/403、网络重试或 provider 扩展自定义认证行为。
- **[未验证]** 未比较其他 Pi 版本，也未使用第三方博客、逆向所得真实文件或本机凭据作为旁证。
- 本研究已覆盖的官方主源包括：`models.md`、`providers.md`、`models-configuration.md`、`custom-provider.md`、`cli.md`，以及 `ModelRuntime`、provider 组合、认证存储、`pi-ai` 统一解析器和必要的内建 provider 实现。安装包文档已足够回答目标问题，因此未额外引用 pi.dev。

## 9. 补充：所谓“显式绑定”究竟指什么

本补充继续限定于 Pi/Pi AI `1.4.0`，检索范围扩大至安装包全部相关官方 docs、`schemas/models.schema.json`、coding-agent dist JS/d.ts、pi-ai dist JS/d.ts，以及 SDK 示例和 MCP 配置实现。结论是：**`models.json` 没有通用凭据条目引用字段，但确实存在几种不同层次的显式选择；另外，`mcp.json` 有一个容易与模型配置混淆的真正 `auth.provider` 引用。**

### 9.1 `models.json` 有没有 `authRef` / `authProvider` / `credentialRef`

**[源码结论] 没有。** 当前 provider 配置的完整字段集合是 `name`、`baseUrl`、`apiKey`、`api`、`oauth`、`headers`、`compat`、`authHeader`、`models`、`modelOverrides`。证据：

- 生成 schema 的 provider 属性清单：`$PI/schemas/models.schema.json:18-63,204-205`。
- TypeScript 源 schema 对应的编译声明：`$PI/dist/core/model-config.d.ts:378-515`。
- 实际加载使用的 `ProviderConfigSchema`：`$PI/dist/core/model-config.js:66-90`。

对官方 docs、schemas、dist JS/d.ts 与 pi-ai dist 的精确检索中，`authRef`、`credentialRef`、`credentialsRef` 均无命中；`authProvider` 的命中只属于 MCP 传输实现，见第 9.4 节。这里没有模型认证条目 ID、认证 profile 名或任意 handler 名的间接引用层。`api` 字段选择的是请求协议实现，也不是认证 handler 引用。

该“无”只对当前安装版成立，不能据此推断其他版本或第三方扩展没有同名字段。

### 9.2 provider ID 同名是不是文档要求的显式绑定约定

**是“同键关联”的显式约定，不是“引用字段”的显式绑定。** 可以把它称为显式绑定，但必须说明绑定方式：用户在 `models.json.providers.<id>` 与 `auth.json.<id>` 两处书写同一个 provider ID，运行时就以该 ID 查找凭据；不会根据 endpoint、显示名或模型相似度推断关联。

- **[文档明示]** 通用配置文档把每个 `providers` 键定义为 provider ID：`$PI/docs/models-configuration.md:9-12`。Azure 小节进一步明确同一个 ID 要作为 `auth.json`、`models.json`、`settings.json` 的键：`$PI/docs/providers.md:136-140`。
- **[源码结论]** `AuthStorage.read(provider)` 直接读取 `data[provider]`：`$PI/dist/core/auth-storage.js:376-384`；登录也按 `provider.id` 写回：`$AI/dist/models.js:357-378`。

因此上一份研究的“精确 provider ID 匹配”结论不变。更准确的术语是：**唯一的内建持久凭据关联键**，而不是 `authRef` 式二级引用。通用文档没有统一使用“binding”术语，不能把 Azure 的明确示例扩张成另一种 schema 机制。

### 9.3 各配置分别绑定什么

| 机制                                                  | 显式选择的对象                                                                                   | 不属于什么                                            | 证据                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `models.json.providers.<id>` 与 `auth.json.<id>` 同键 | 某个 provider 的持久凭据条目                                                                     | 不是条目 UUID、profile 引用或 handler 引用            | `$PI/dist/core/auth-storage.js:376-384`                                                                                 |
| `models.json.apiKey`                                  | 直接附着于该 provider 的**凭据值来源**：字面量、环境插值或命令输出                               | 不引用 `auth.json`，也不选择 OAuth handler            | `$PI/docs/models-configuration.md:15-18`；`$PI/dist/core/provider-composer.js:225-227,284-302`                          |
| `models.json.oauth: "radius"`                         | **命名的 OAuth 流程/handler 选择**；当前 schema 只允许 Radius，并要求 `baseUrl`                  | 不引用某个 OAuth 凭据条目，不能填写任意 handler 名    | `$PI/docs/models-configuration.md:19-20`；`$PI/dist/core/model-runtime.js:119-132`；`$AI/dist/providers/radius.js:7-24` |
| `models.json.headers`                                 | 请求头字段及其字面量/环境/命令值，属于**请求构造**                                               | 不选择凭据来源或认证 handler                          | `$PI/docs/models-configuration.md:20-22`；`$PI/dist/core/provider-composer.js:305-308`                                  |
| `models.json.authHeader`                              | 把当前已解析的 API key **投影**为 `Authorization: Bearer`，属于输出映射                          | 不决定 key 来自运行时、存储、模型配置还是环境         | `$PI/docs/models-configuration.md:22`；`$PI/dist/core/provider-composer.js:216-223`                                     |
| `auth.json` 条目的 `type`                             | 在 `provider.auth.apiKey` 与 `provider.auth.oauth` 之间做**类型分派**                            | 不能按名字选择任意 handler；类型无匹配 handler 时失败 | `$AI/dist/auth/resolve.js:24-38`                                                                                        |
| 扩展 `registerProvider(name, config)`                 | 以代码把 legacy `apiKey`/`oauth` 配置及可选登录、刷新、令牌转换行为注册到 `name` 对应的 provider | 不是 `models.json` 的凭据条目引用                     | `$PI/dist/core/extensions/types.d.ts:1307-1359,1413-1465`；`$PI/dist/core/provider-composer.js:196-214,312-326`         |
| 扩展 `registerProvider(provider)`                     | 直接注册完整 provider 实现，其 `provider.auth.apiKey/oauth` 是**代码级 handler 注入**            | 不是 JSON 引用；存储凭据仍按 `provider.id` 关联       | `$PI/docs/custom-provider.md:19-30,126-139`；`$AI/dist/models.d.ts:61-84`                                               |
| 以内建 provider ID 写 `models.json` 覆盖              | 通过同 ID 组合并继承内建认证实现，同时覆盖模型/endpoint 等字段                                   | 不是另写 `authProvider` 指针                          | `$PI/docs/models.md:67-77`；`$PI/dist/core/model-runtime.js:156-166`                                                    |

所以，“显式绑定”的记忆在三种意义上都可能成立：**同 ID 关联凭据、`oauth: "radius"` 选择命名流程、扩展代码注入 handler**。它们都不等于 `models.json` 支持通用的 `authRef`/`credentialRef`。

### 9.4 真正存在的显式 `auth.provider`：只在 MCP 配置域

**[源码结论]** 当前版本确实有一个显式间接认证引用，但它在 HTTP MCP server 配置，不在 `models.json`：

```json
{
  "mcpServers": {
    "example": {
      "url": "https://service.example.com/mcp",
      "auth": { "provider": "example-provider" }
    }
  }
}
```

`McpHttpServerConfig.auth.provider` 的含义是发送某个 Pi provider（`/login <provider>`）的 token，而不是使用 MCP server 自己的 OAuth；项目级 `mcp.json` 禁止使用它，以免仓库决定凭据发送目的地，并要求 HTTPS 或 loopback。证据：`$PI/dist/core/mcp-servers.d.ts:93-106`、`$PI/dist/extensions/mcp/config.js:24-26,95-97`。

运行时每次请求通过 `providerToken(provider)` 调用 `modelRegistry.getApiKeyForProvider(provider)`，取得该 provider 当前认证解析结果，MCP 不另存一份 token。证据：`$PI/dist/extensions/mcp/index.js:455-466`、`$PI/dist/extensions/mcp/runtime.js:120-134`。因此它绑定的是**provider 的认证解析结果**，可间接复用 `/login` 写入的 `auth.json`，但仍不是独立的 credential entry ID 或模型认证 handler 引用。`authProvider` 变量名也出现在这条 MCP 传输链中，不能当作 `models.json` 字段证据。

另有一种不同层次的显式配置：SDK `ModelRuntime.create({ authPath, modelsPath, credentials })` 可选择认证文件路径或整个存储后端，证据：`$PI/dist/core/model-runtime.d.ts:4-9`、`$PI/examples/sdk/09-api-keys-and-oauth.ts:17-20`。它选择文件/后端，仍不提供条目级 `credentialRef`。

### 9.5 对 `docs/spec/live-auth-config.md` 的影响

**核心理解无需修订。** 该 spec 已明确“两文件通过区分大小写的精确 provider ID 关联”，并规定 `type: api_key`、缺失才回退及 OAuth 由消费者插件提供处理器；这些与当前补充证据一致。此次新增的重要边界是：不要把 MCP 的 `auth.provider` 误认为 Pi `models.json` 的通用能力，也不要据此给 `.env.auth.yaml` 增加 `authRef`/`credentialRef`。本次未修改该 spec。
