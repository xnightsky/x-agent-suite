# 模块与工具手册

本页按“做什么、何时用、与谁组合”解释七个包。[`catalog.json`](./catalog.json) 记录组合并指向公开工具真相源 [`tools.json`](./tools.json)；新增或删除导出时，教程测试会要求同步分类。

分类含义：

- **主路径**：消费者通常直接使用。
- **底层原语**：实现自定义 driver/profile 时使用。
- **高级**：需要理解 wire、PTY 或资源生命周期。
- **live**：可能产生真实网络、费用或凭据风险。
- **债务**：迁移遗留，仅为兼容现状，不作为通用设计推荐。

## 1. contracts：先约定接缝

`@x-agent-suite/contracts` 只有类型，没有运行时导出。

| 类型组                                 | 用法                                                       |
| -------------------------------------- | ---------------------------------------------------------- |
| `AgentDriver` / `LongLivedAgentDriver` | 把一次性或长驻宿主归一为固定生命周期                       |
| `HarnessProfile`                       | 由消费者声明 CLI 参数、配置写入、JSONL parser 和工具名映射 |
| `Observation` / `ScenarioResult`       | 分离宿主观测、外部 artifact 和评分结果                     |
| `ScenarioSpec` / `Scenario`            | 声明多轮脚本或封装自定义运行函数                           |
| `Criterion`                            | 注册领域自己的 turn/session 判据                           |
| `Registry`                             | 当前只定义注册函数形状，不提供存储或查找实现               |

选择原则：跨消费者都需要的稳定接缝才进入 contracts；领域字段使用 `metadata`、`provision`、`driverOptions` 或 artifact 自由区。

## 2. driver：把输入送进去

| 工具                     | 分类     | 什么时候用                            | 常见组合                     |
| ------------------------ | -------- | ------------------------------------- | ---------------------------- |
| `MockDriver`             | 主路径   | 验证消费侧编排、评分、报告            | observation、matrix          |
| `JsonlProcess`           | 底层原语 | 自己实现 headless JSONL driver        | sandbox、LfFramer            |
| `JsonRpcPeer`            | 底层原语 | 自己实现 JSON-RPC over stdio 协议适配 | JsonlProcess                 |
| `LongLivedJsonRpcDriver` | 主路径   | JSON-RPC 长驻会话，只注入协议 adapter | JsonRpcPeer、contracts       |
| `PtyProcess`             | 高级     | 必须操作真实终端界面                  | createPtyScreen、PTY watcher |
| `createPtyScreen`        | 底层原语 | 从 PTY 输出维护屏幕快照               | PtyProcess                   |
| `LfFramer`               | 底层原语 | 自定义严格 LF 协议                    | JsonlProcess                 |
| `AsyncQueue`             | 底层原语 | 把进程事件暴露为 AsyncIterable        | 自定义 Driver                |

优先顺序：结构化协议 Driver → headless JSONL → 长驻协议 → PTY。不要因为宿主有 TUI 就默认使用 PTY。

## 3. sandbox：把副作用圈起来

| 工具             | 分类   | 什么时候用                                               |
| ---------------- | ------ | -------------------------------------------------------- |
| `createSandbox`  | 主路径 | 在临时 HOME/cwd 中运行 CLI，并剥离代理和声明的环境变量   |
| `cleanupSandbox` | 主路径 | 在 `finally` 中清理目录；`E2E_KEEP_SANDBOX=1` 时保留排查 |

Harness Driver 已经组合 sandbox；只有直接使用 `JsonlProcess`/`PtyProcess` 时才需要消费者手工管理。

## 4. llm-fixture：控制模型轮次

### fixture 主路径

| 工具                  | 分类   | 什么时候用                                |
| --------------------- | ------ | ----------------------------------------- |
| `FakeProviderBackend` | 主路径 | 用本地端点确定性下发 tool call 和收尾文本 |
| `createLlmBackend`    | 主路径 | 由运行模式选择 fixture 或 live backend    |

### live 与 wire 工具

| 工具                                          | 分类 | 用途                               |
| --------------------------------------------- | ---- | ---------------------------------- |
| `LiveBackend`                                 | live | 调用显式配置的真实 provider        |
| `LiveNotConfiguredError`                      | live | 让未配置 carrier 显式降级          |
| `sniffLiveChannel`                            | live | 正式运行前验证连通、鉴权和工具调用 |
| `loadLiveConfig`                              | live | 加载 YAML/env 配置                 |
| `resolveLiveChannel`                          | live | 解析 carrier 渠道                  |
| `resolveLiveApiKey` / `resolveLiveCredential` | live | 解析凭据，调用方不得写入日志       |
| `redactLiveSecrets`                           | live | 脱敏诊断文本                       |
| `createSecretRedactor`                        | 高级 | 用已解析秘密创建通用文本脱敏器     |
| `redactLiveError` / `redactValue`             | 高级 | 递归脱敏异常图与结构化值           |
| `LIVE_CONFIG_PATH_ENV` / `LIVE_CONFIG_FILE`   | live | 配置入口常量                       |
| `estimateCostUsd`                             | live | 按 usage 估算成本                  |
| `buildLiveRequest` / `parseLiveResponse`      | 高级 | 自定义 wire transport              |
| `createFetchTransport`                        | live | 创建真实 HTTP transport            |
| `LiveHttpError`                               | live | 保留 HTTP 失败上下文               |

默认用 fixture。`createFetchTransport`、`LiveBackend` 和 sniff 都可能发起真实请求，不进入离线教程命令。

## 5. harness：把 profile、backend 和 sandbox 组合起来

### 主路径与原语

| 工具                           | 分类     | 什么时候用                               |
| ------------------------------ | -------- | ---------------------------------------- |
| `createHarnessDriver`          | 主路径   | 用消费者 profile 驱动一次性 headless CLI |
| `resolveHarnessCommand`        | 主路径   | 解析 CLI shim 或平台入口                 |
| `HarnessUnavailableError`      | 主路径   | 把 CLI 缺失变成可诊断 skip               |
| `createPtyAgentDriver`         | 高级     | 覆盖 TUI 独占交互和长驻输入              |
| `createPtyScreenWatcher`       | 底层原语 | 自定义屏幕/I/O/FS idle 条件              |
| `cleanupPtyDriverResources`    | 底层原语 | 聚合清理 PTY、backend、sandbox           |
| `buildMcpServerSpec`           | 底层原语 | 构造交给 profile 的 server 描述          |
| `writeJsonFile` / `tomlString` | 底层原语 | 实现 profile.writeConfig                 |

### 已登记迁移债务

| 工具                           | 状态 | 教程策略                                   |
| ------------------------------ | ---- | ------------------------------------------ |
| `resolveHarnessChannel`        | 债务 | 不作为新 profile 的通用渠道接口            |
| `resolveHarnessCredential`     | 债务 | 不作为默认凭据入口；尤其不能默认借用登录态 |
| `createHarnessLiveConfigHooks` | 债务 | 仅兼容现有借用路径                         |
| `installKimiPlugins`           | 债务 | 宿主专用安装语义，不进入领域中立主链       |

## 6. observation：相信结构化证据

| 工具                   | 分类     | 检查内容                                         |
| ---------------------- | -------- | ------------------------------------------------ |
| `dryChecks`            | 主路径   | events、toolCalls 和计数是否形成可信 Observation |
| `hardChecks`           | 主路径   | 工具是否 completed、action/args 是否匹配         |
| `fuzzyChecks`          | 主路径   | 最后手段的字符串或正则文本检查                   |
| `checkListResult`      | 主路径   | 列举结果的幻觉与遗漏                             |
| `toolNameMatches`      | 底层原语 | 兼容宿主工具命名空间末段                         |
| `toolActionMatches`    | 底层原语 | 检查结构化 `input.action`                        |
| `writeScenarioReports` | 主路径   | 同时生成 Markdown 与 JSON 报告                   |

这些 checks 是通用检查函数，不是内建领域 Criterion。消费者仍负责把领域 `expect` 值交给自己注册的 Criterion。

## 7. matrix：排列有意义的组合

| 工具                   | 分类   | 用法                                       |
| ---------------------- | ------ | ------------------------------------------ |
| `runMatrix`            | 主路径 | 变体间串行，同一变体内 carrier 并行        |
| `createMatrixRunner`   | 主路径 | 绑定固定 driver factory 和 scenario runner |
| `toScenarioReportRows` | 主路径 | 把 ok/skip 统一成报告行                    |
| `writeScenarioReports` | 主路径 | 转导出 observation 报告工具                |

Matrix 不加载 scenario、不创建 profile、不解释 criterion。它只编排消费者传入的四个函数：carrier 列表、variant discovery、driver factory、scenario runner。
