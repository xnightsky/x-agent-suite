# x-agent-suite 演进路线

> 本路线图维护框架从当前能力到可独立扩展的演进路径。

## 当前状态

- 已实现通用能力：contracts、driver、sandbox、llm-fixture、observation、harness、matrix。
- 当前使用入口是消费者手工组合库 API；可执行教程覆盖 Mock、JSONL、fixture 与 matrix 离线链路。
- 领域专属能力由消费者维护，不进入本库。
- 7 个包的源码与测试已全绿，`pnpm check` 通过。

## 阶段路线图

| 阶段  | 主题                | 关键交付                                                                    | 优先级 |
| ----- | ------------------- | --------------------------------------------------------------------------- | ------ |
| **0** | 现状稳定            | 7 个包能力拷贝完成，边界守卫通过，可执行教程与文档补齐                      | P0     |
| **1** | Registry 与插件注册 | 把 driver / profile / criterion / scenario 接入注册表，让 consumer 能自注册 | P0     |
| **2** | CLI 入口            | 提供 `x-agent-suite` CLI：运行 scenario、matrix、查看报告                   | P1     |
| **3** | 更多 wire 支持      | 按需扩展 fake provider 的 wire 形态（如 OpenAI chat function 变体）         | P1     |
| **4** | Criterion 市场      | 沉淀通用判据模板（如 tool-calling、file-match、cost-budget）作为可选插件    | P2     |
| **5** | Reporter 扩展       | 支持更多输出格式（JUnit、HTML、自定义模板）                                 | P2     |
| **6** | 架构拆分评估        | 判断是否值得把某几个包拆成独立 repo；明确本框架与 consumer 的边界           | P3     |
| **7** | live 评估转正       | 把 live 模式从可选能力完善为可 nightly 运行的评估流水线                     | P3     |
| **8** | PTY 审批专项        | 在真实 TUI 门槛场景激活 PTY 层                                              | P3     |

## 关键决策

### 通用化优先，不预设业务语义

- **否决**：在框架内内置任何具体 Agent / CLI / 被测系统的判据或 scenario。
- **理由**：框架的价值建立在领域中立上。第二个消费者会证伪错误抽象。
- **代价**：consumer 需要多写一点注册代码；换来的是框架不随某个宿主漂移。

### 自研 fake provider，不引入外部 mock 库

- **否决**：`@copilotkit/aimock`、`mockttp`；进程内拦截方案结构性排除。
- **理由**：期望响应形态由我们规定，本身就是断言；自研端点可 dump 请求体，可诊断性更高。
- **反转条件**：live 评估转正、prompt 变体组合爆炸、需要真实响应基线时，再引入专业 mock 库。

### 宿主驱动：headless JSONL 为主，PTY 为辅

- **否决**：用 PTY 驱动所有 TUI。
- **理由**：headless 结构化输出有契约，PTY 屏幕断言随界面改版即碎。
- **PTY 唯一不可替代处**：验证交互式审批流本身。

### 入站验证：长驻协议优先于一次性 headless

- **否决**：只用一次性 headless 覆盖全部语义。
- **理由**：入站事件、多轮往返、presence 要求会话存活。
- **代价**：只覆盖协议路径，不覆盖 TUI 路径；需要时用 PTY 补。

## 未决事项

- Registry 的 API 形态（同步 / 异步、文件扫描 / 显式 import）待第一个 consumer 验证。
- CLI 是否需要内置配置文件（如 `x-agent-suite.config.ts`）还是完全通过代码注册。
- 报告输出格式优先级。

## 验收标准

- 阶段 0：`pnpm check` 通过，文档与代码同步。
- 阶段 1：consumer 可通过注册表接入自定义 driver / profile / criterion / scenario。
- 阶段 2：CLI 能运行 `x-agent-suite run <scenario>` 和 `x-agent-suite matrix <scenario>`。
- 阶段 7：live 模式能输出含 cost 的 `ScenarioResult`。
- 阶段 8：至少一条 TUI 门槛场景通过，代码中不出现对屏幕文本的断言。
