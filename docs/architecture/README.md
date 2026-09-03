# 架构总览

x-agent-suite 处于「被测 Agent 宿主」与「被测系统」之间：它不认识任何具体被测系统，只提供观测、驱动、评分、报告四类基础设施。

## 语义分层

```mermaid
flowchart TB
    subgraph L1["L1 · Agent 宿主层（仓库外）"]
        H["CLI / TUI / 长驻协议 / Mock"]
    end

    subgraph L2["L2 · x-agent-suite 验证层"]
        DRIVER["driver\nJsonlProcess / PtyProcess"]
        HARNESS["harness\nHarnessProfile / Driver"]
        LLM["llm-fixture\nFakeProviderBackend / LiveBackend"]
        SANDBOX["sandbox\n临时 HOME / cwd"]
        OBS["observation\nObservation / checks / report"]
        MATRIX["matrix\nrunMatrix / 报告"]
        CONTRACTS["contracts\n通用类型与注册表"]
    end

    subgraph L3["L3 · 被测系统（消费者提供）"]
        SUT["MCP server / API / 业务系统"]
    end

    H -->|"spawn / inject / 事件"| DRIVER
    HARNESS -->|"配置 base URL"| LLM
    HARNESS -->|"隔离"| SANDBOX
    DRIVER -->|"结构化事件"| OBS
    MATRIX -->|"编排"| HARNESS
    MATRIX -->|"汇总"| OBS
    CONTRACTS -.->|"契约"| DRIVER
    CONTRACTS -.->|"契约"| HARNESS
    CONTRACTS -.->|"契约"| OBS
    HARNESS -->|"调用工具"| SUT
```

## 消息流示例

### 一次性 headless 宿主：出站

```mermaid
sequenceDiagram
    autonumber
    participant D as Driver
    participant H as Agent CLI（headless）
    participant FP as FakeProviderBackend
    participant SUT as 被测系统

    D->>H: spawn 并注入 prompt
    H->>FP: 首轮 LLM 请求（含 tools 声明）
    FP-->>H: tool_call(someTool, args)
    H->>SUT: 真实调用工具
    SUT-->>H: 工具返回
    H->>FP: 次轮请求（含 tool result）
    FP-->>H: 收尾文本
    H-->>D: Observation（含 ToolCall.status）
```

### 长驻宿主：多轮注入与入站事件

```mermaid
sequenceDiagram
    autonumber
    participant D as LongLivedAgentDriver
    participant H as Agent CLI（长驻协议）
    participant SUT as 被测系统

    D->>H: 建立长驻会话
    Note over D,H: 会话保持存活
    SUT->>H: 外部事件 / 通知
    H-->>D: InboundEvent
    D->>H: inject(prompt)
    H->>SUT: 调用工具
    SUT-->>H: 返回
    H-->>D: Observation
```

## 核心纪律

- **套件不认识任何被测系统**：具体工具名、协议、环境变量由消费者注册。
- **断言不刮 stdout**：统一消费 `Observation`，屏幕文本仅用于 PTY 同步。
- **状态证据独立**：`ArtifactEvidence`（或消费者自定义证据）与宿主输出分开评分。
