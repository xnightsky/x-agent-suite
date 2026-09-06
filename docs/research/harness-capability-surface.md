# Agent 测试框架能力面调研：收编三件之后，我们迁了「点」还是齐了「面」

> 日期：2026-09-07。触发：从 pi-bus / pi-intercom 收编 win32 命令解析兜底、JSON 播种、
> 屏幕镜像三件通用件后，评估框架能力面的完整度。

## 结论

收编的三件是**三个「点」**（命令解析、配置播种、诊断镜像），各自填平了消费者重复造轮子的坑；
但对照业界同类框架的能力面，本框架在**诊断工件持久化**与**流量确定性**两个面上仍有结构性缺口。
建议按「消费者证据优先」排序推进，其余面明确缓做或不做（见末尾决策表）。

## 业界能力面盘点

按子领域归纳，每条标注代表实现。

### 1. TUI/终端测试

- **屏幕 golden 快照断言**：teatest（charmbracelet/x）`RequireEqualOutput` 对比 golden 文件，
  `-update` 刷新；vttest 用真实 PTY + 虚拟终端捕获含颜色/光标的完整屏幕状态做快照。
  microsoft/tui-test 同样以终端快照匹配为核心断言手段。
- **录制（record）**：tui-test 把「control, record, test」并列为一等能力；
  asciinema 式会话录像是终端工具链的通用诊断格式。
- **确定性分层**：模型级（teatest，无真实终端，微秒级）与 PTY 级（vttest / tmux 系）分开；
  tmux 系把 tmux 当「带 CLI 控制面的 PTY broker」，API 收敛为发键/抓帧/断言/等待四操作。

### 2. 网络/流量确定性

- **record-replay**：VCR / Polly.js / Nock 统一模式——真实交互录制为 cassette，
  后续回放实现快速、确定、离线；polly 提供 record / replay / passthrough 三模式。
  核心收益：手写 fixture 与真实 API 漂移的问题由「录真实响应」根治。

### 3. 通用 E2E 诊断

- **失败工件持久化**：Playwright trace / video / screenshot-on-failure；
  Cypress video。共性是「默认留证据、失败必有现场」，而非仅 live 观察。

### 4. 测试运行器治理

- **flake 治理**：retry（vitest/jest/playwright）、quarantine 隔离清单。
- **规模治理**：sharding / 并发调度；fake timers（仅对可控时钟的被测系统有效）。

### 5. Agent 评测框架

- **Harbor / Terminal-Bench**：容器（Docker）隔离、任务 = 环境 + 指令 + 验证三段式、
  云并行、hub 共享任务集。
- **Inspect AI**：solver（执行）/ scorer（判分）/ transcript（全程留痕）分层。

## 本仓现有面 vs 缺口

| 能力面 | 业界代表 | 本仓现状 | 判定 |
| --- | --- | --- | --- |
| 进程/PTY 驱动 | node-pty、tmux broker | driver + harness/pty-* | 已有 |
| 命令解析（含 win32） | cross-spawn 等 | resolveHarnessCommand + resolveLocalBinCommand（本次收编） | 已有（刚补齐） |
| 配置/状态播种 | testcontainers init、fixture factory | ensureJsonEntry（本次收编） | 已有（刚补齐） |
| live 诊断观察 | tui-test control、tmux capture | attachScreenMirror（本次收编） | 已有（刚补齐） |
| **诊断工件持久化** | Playwright trace/video、asciinema | 只有 live 流与 screenTail 尾部快照，无时间线工件 | **缺面** |
| **屏幕快照断言** | teatest golden、vttest 快照 | 无（只有正则 waitForScreen） | **缺面** |
| **流量 record/replay** | VCR / Polly | llm-fixture 为手写脚本 fake，不能从 live 录制 | **缺面** |
| flake 治理 | retry / quarantine | 无 | 缺面（优先级低） |
| 容器级隔离 | Harbor Docker | sandbox 包（临时 HOME/cwd/env） | 已有（够用，见决策） |
| 编排与报告 | matrix、Inspect scorer | matrix + observation | 已有 |

## 决策建议（按消费者证据排序）

1. **屏幕录制工件（建议近期做）**：mirror 已证明两个消费者都有「看清 TUI 在干什么」的需求；
   把 attachScreenMirror 的帧流追加落盘（asciinema cast 或纯文本时间线），失败时自动附进报告。
   成本低于收益，且不引入新契约。
2. **LLM 流量 record/replay（建议立项调研）**：token 车道用例录制为 cassette、离线回放成 fixture，
   能同时治「手写 fixture 漂移」与「live 用例不可回归」两个痛。工程量大，先做 spike。
3. **屏幕 golden 快照（缓做）**：真实宿主 TUI 屏幕非确定性高（ spinner、宽度自适应），
   业界 golden 模式在组件级（teatest）成熟、在跨宿主 PTY 级证据不足；等消费者提出再动。
4. **flake retry/quarantine（缓做）**：当前测试量未暴露系统性 flake，属 YAGNI。
5. **容器隔离 / 云并行（不做）**：sandbox 包已覆盖隔离诉求；Harbor 模式面向基准生产场景，
   与本框架「消费者本地零 token 回归」定位不符。

## 纪律约束

- 上述任何一项落地前仍需过「第二个消费者是否需要」的边界审查；无证据的一律留在消费者侧。
- 快照/录制类工件默认进 gitignore 目录，不进版本库（golden 文件除外）。
