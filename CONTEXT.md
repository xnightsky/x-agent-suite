# x-agent-suite 领域语言

本文件是仓库统一的术语锚点，只定义项目特有的语言及其边界；详细契约、执行规则与验证要求以各术语链接的 spec 为准。出现一词多义时，先在此澄清 canonical 术语，不在不同文档中各自扩写定义。

## Language

### 边界与执行角色

**[Consumer（消费者）](docs/spec/boundary-discipline.md)**：使用框架并注册具体宿主适配、场景和判据的一方；框架不感知消费者的领域语义。

**[被测系统（SUT）](docs/spec/contracts.md)**：由消费者提供、由宿主加载或调用，并通过行为证据接受评估的系统；不与执行它的宿主默认视为同一对象。

**宿主（Host）**：被 Driver 启动或连接的 Agent CLI、TUI 或长驻运行时；它可以是合成测试宿主或真实宿主，两者属于不同验证层。

**[Driver](docs/spec/contracts.md#driver-契约)**：把不同执行宿主归一为统一观测契约的驱动接口；Driver 不是模型 provider，也不等于被测系统。

**[HarnessProfile](docs/spec/contracts.md#harnessprofile)**：消费者注册的宿主适配档案，描述宿主启动、配置与输出解析能力；不是 live target 选择配置。

**[LlmBackend](docs/spec/llm-fixture.md#llmbackend-抽象)**：框架调用模型端点的抽象，区分 fake 与 live 后端；它位于模型调用侧，不替代宿主 Driver。

### 评测契约

**[Scenario / ScenarioSpec](docs/spec/contracts.md#scenario-与-criterion)**：一个完整评测用例及其声明契约，描述输入与期望，并由 Driver 执行、Criterion 判定。

**[Observation](docs/spec/contracts.md#observation)**：Driver 对宿主输出与事件的结构化归一结果；不包含框架无法解释的专属外部状态语义。

**[ArtifactEvidence](docs/spec/scenario-evaluation.md#artifactevidence)**：消费者定义的外部状态证据，与 Observation 分开采集和评分；框架只透传，不解释其领域含义。

**[Criterion](docs/spec/contracts.md#scenario-与-criterion)**：对单轮或多轮观测作出判定的评分逻辑；具体领域判据由消费者注册，而非框架预置。

**[Registry](docs/spec/contracts.md#registry)**：消费者把 Driver、Profile、Criterion 和 Scenario 接入框架的注册边界，避免框架枚举具体领域实现。

**[Provision](docs/spec/contracts.md#provision-hook)**：由消费者物化领域 fixture 的场景准备接缝；框架调用并透传其声明，不内建具体安装或资源语义。

**[Scenario Runner](docs/spec/scenario-runner.md)**：执行 ScenarioSpec、调度 Driver 与 Criterion 并生成结果和报告的通用编排器。

**[Matrix](docs/spec/matrix.md)**：把同一场景按变体和 carrier 展开为对照结果的编排方式；不负责 live target 解析或领域判定。

**[Recall](docs/spec/recall.md)**：本仓原生声明式评测入口，把 Recall YAML 编译为 ScenarioSpec 并复用 Runner；不泛指记忆能力或其他工具中的同名概念。

**[Judge](docs/spec/judge.md)**：把批量 rubric 转换为具名 boolean verdict 的通用执行器；不产生分数、阈值或 overall pass。

### 目标与执行路径

**[Carrier](docs/spec/ephemeral-client.md)**：执行载体的逻辑标识，同时关联 Driver/Profile 与 target 目录；可表示 CLI 或临时 Client，不是套餐或 provider。

**[Provider](docs/spec/llm-fixture.md#live-多模型配置契约)**：carrier 下的套餐或连接渠道，包含端点、wire 与凭据来源。

**[Model](docs/spec/llm-fixture.md#live-多模型配置契约)**：live 配置中某个 provider 下允许选择的模型标识。

**[Canonical Model](docs/spec/target-tags.md#provider-默认值与-canonical-引用)**：TargetTags 中用于归因模型自身能力的稳定身份；provider 模型别名只有显式关联后才能继承其能力声明。

**[Target](docs/spec/llm-fixture.md#live-多模型配置契约)**：一次实际执行或验证的完整身份，即 `(carrier, provider, model)`；选择过程可以省略部分条件，解析结果不得省略。

**[Default Target](docs/spec/llm-fixture.md#live-多模型配置契约)**：显式选中某个 carrier 后可以展开的默认目标集合；不是无参数执行授权。

**[TargetTags](docs/spec/target-tags.md)**：描述 CLI、Provider、ProviderModel 与 Canonical Model 已声明能力及 live 策略的目录；不证明运行时健康、账号状态或调用必然成功。

**[Direct](docs/spec/target-tags.md#决策-api)**：调用方通过模型 Client/Backend 直接请求 provider 的执行路径；该模式名称本身不证明真实 provider 已被访问。

**[Borrowed](docs/spec/target-tags.md#决策-api)**：通过注册的宿主执行 Profile 间接完成模型调用的执行路径；它描述执行路径，不表示“借用凭据”，也不单独证明真实宿主已运行。

### Live 与执行风险

**[Live 配置](docs/spec/llm-fixture.md#live-多模型配置契约)**：用于发现、解析和选择 live target 及连接信息的配置输入；它可以是真实私密配置或测试用临时合成配置，存在或加载成功不等于发生真实 live 调用。

**[Fixture](docs/spec/llm-fixture.md#fakeproviderbackend)**：由 fake provider 提供确定性模型响应的零 token 执行方式；用于回归与降噪，不替代真实 live 验收。

**[Live](docs/spec/llm-fixture.md#livebackend)**：作为执行风险术语，指实际访问真实 provider 并产生 token、费用或数据出站风险的运行方式；仅选择 live 分支、加载 live 配置或通过 live 审批不构成一次真实 live 验证。

**Live 配置接线验证**：使用 live 配置解析与选择路径，但以 fake transport、MockDriver 或其他假实现替代真实 provider 的验证；它证明配置或编排接线，不提供真实 live 证据。

**[临时 Client 真实 Live 验证（ephemeral-client live）](docs/spec/testing.md#临时-client-真实-live-验证)**：在一次性、可清理的隔离环境中，使用显式 live 配置创建真实 SDK、CLI 或 Driver 实例，并经其正常路径向真实 provider 发起至少一次模型请求的验证。真实 target、真实 Client、真实 Provider 响应和成功/失败/skip 全路径清理必须同时成立；只解析配置、通过审批或使用 fake 实现均不满足定义。

**[Token 风险车道](docs/spec/testing.md)**：对访问真实 provider、具有 token/费用/账号风险的测试施加文件级排除与显式授权的执行车道；它是风险修饰，不是新的验证层级。
