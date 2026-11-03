# 脚本与 CLI 进程执行证据（待审设计）

> 日期：2026-11-02。状态：待审设计，未实现。
> 范围：脚本/CLI 的真实进程证据入口、覆盖完整性、wrapper/fake CLI、动态安装位置、返回值与测试分层；仍是待审设计，不代表这些能力已实现。`sequence`、局部 `steps`、严格 `seq` 已拆至 [Evidence 有序调用与局部捕获](./future/evidence-sequence.md)，整体延后。

## 结论

需要验证真实执行的 case 使用以下证据链；只验证入口/附件读取的 case 不要求进程基座：

```text
自然任务
  → 实际入口读取
  → 宿主工具调用与真实进程显式关联
  → 精确 argv/cwd/stdout/stderr/exitCode/signal
  → 清理前产物快照
```

只凭模型回答、宿主工具名或命令字符串，不能证明脚本/CLI 真实执行。本设计使用三类独立证据：

1. **宿主工具证据**：证明入口读取和工具调用轨迹。
2. **进程证据**：证明实际启动、参数、工作目录、输出和退出结果。
3. **产物证据**：证明副作用，而不是模型声称成功。

现有消费者队列的需求盘点见 [Recall 变量机制的阶段裁决](./recall-variables.md#当前阶段裁决)。66 个 case 目前均验证路由、读取和答案，没有真实进程结果断言。本期优先迁移读取证据；本设计仅为确有脚本/CLI 执行需求的后续 case 定义接入前提，不为现有队列强加 wrapper、collector 或顺序能力。

## 需求覆盖

| 需求                             | 设计出口                                         |
| -------------------------------- | ------------------------------------------------ |
| Skill/能力入口实际触发           | 原生入口读取事件 + 动态资源 Provider             |
| 项目、全局、源码和安装后位置不同 | `resources.<alias>.*`，同一 expect 跨布局复用    |
| 真实脚本执行                     | launcher wrapper + 真实脚本子进程                |
| 真实 CLI 执行                    | sandbox PATH shim/wrapper + 进程记录             |
| 精确 CLI 参数                    | 实际 spawn argv 数组，不解析 shell 文本猜测      |
| stdout/stderr/退出码             | wrapper 等待真实 close 并记录 code/signal/output |
| 最终文件效果                     | 清理前文件快照，独立判据                         |
| 自然触发与适配逻辑分开           | unit / ittest / token ittest 三层                |

## 术语与不可混淆的结果

- **工具调用**：宿主报告的 read/bash 等调用，可能有 status 和 output。
- **进程调用**：操作系统实际 spawn 的 executable + argv + cwd。
- **脚本调用**：node/python 等 launcher 加上脚本路径；脚本路径是 argv 的一部分。
- **CLI 调用**：可执行文件加上参数；测试替身通过 sandbox PATH 截获。
- **产物**：进程结束后独立采集的文件或外部 fake 状态。

以下结果分别判定，不互相推导：

| 结果                | 含义                                             |
| ------------------- | ------------------------------------------------ |
| 宿主 `status`       | 工具调用 completed/failed                        |
| 进程 `launch`       | spawned/failed，区分启动失败与启动后非零退出     |
| `exitCode`          | 正常退出的数值；信号终止或启动失败时为 null      |
| `signal`            | 终止信号；正常退出时为 null                      |
| `stdout/stderr`     | 进程原始文本输出                                 |
| 工具 `output`       | 宿主包装后的工具结果，不等同于原始 stdout        |
| Recall 退出码       | 配置/基础设施执行结果，不是被测脚本退出码        |
| `hardPass`/判据结果 | 行为是否通过；Recall 行为失败时 CLI 仍可能退出 0 |

## 归一化观测契约

当前公共 `ToolCall` 没有进程字段，不能假设 Evidence 自动取得进程证据。候选入口是在现有 `EvidenceCriterionOptions` 中增加显式 `resolveEvidence` 回调，返回当前 turn 的只读快照；不新增通用 Observation 字段，也不读取固定 metadata 键：

```ts
interface EvidenceCall {
  callId?: string; // 宿主工具调用 id
  tool: string;
  action?: string;
  input?: unknown;
  output?: unknown;
  status?: "completed" | "failed";
  resource?: string; // 归一化实际资源路径

  process?: {
    invocationId: string;
    launch: "spawned" | "failed";
    launchError?: string;

    command: string; // 稳定的 launcher/CLI 逻辑名
    executable?: string; // 实际路径，仅诊断，不用于可移植期望
    argv: string[]; // 不含 executable，保留实际顺序
    cwd: string;

    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
  };
}

interface EvidenceSnapshot {
  readonly calls: readonly EvidenceCall[];
  readonly processCoverage: {
    readonly status: "complete" | "incomplete";
    readonly reason?: string;
  };
}

// 现有工厂选项的候选扩展；其他选项保持不变。
interface EvidenceCriterionOptions {
  readonly resolveEvidence?: (turn: TurnObservation) => EvidenceSnapshot;
}
```

约束：

- 消费者 Adapter 在采集阶段写入自行定义的 Observation/metadata，再由 `resolveEvidence(turn)` 显式映射。回调同步、无 I/O，不读取 HOME 或消费者文件系统补证据。
- `callId` 与 `process.invocationId` 是不同身份；后者在当前 turn 内唯一。Adapter 必须显式关联，不得按命令文本或相近时间猜测。
- 一个宿主调用可以对应多个进程：每个进程输出一条记录，共享 callId/input/output/status，不再额外输出同一宿主调用的无进程副本；没有目标进程的宿主调用只输出一条无进程记录。宿主 status 不按单个进程退出码改写。
- 快照中的数组顺序仅为稳定枚举顺序，不证明执行或完成顺序；本期不含 startSeq/endSeq/timingSource。顺序扩展见独立后续设计。
- 不配置回调时现有 `toolResult/citation/not/allOf` 保持原行为；声明依赖进程证据的消费者判据必须先要求可信快照，缺回调、非法快照和关联丢失均抛观察错误。
- 本文不新增进程匹配 DSL 或顶层判据名。消费者先通过注册判据消费该证据；仅有回调不代表现有 Evidence 节点已经支持 process 字段。
- `command` 是可移植逻辑名，例如 node 或 fixture-cli；实际绝对 `executable` 只用于诊断。
- `argv` 是实际子进程参数，不包含宿主 shell 的 quoting，也不把整条 command 字符串当 argv。
- stdout/stderr 本设计限定为 UTF-8 文本；二进制协议输出不在第一阶段范围内。
- 所有证据必须在 sandbox 清理前采集完毕。

## 进程 wrapper 与 fake CLI

### wrapper 协议

wrapper 是被测宿主实际调用的启动入口，负责：

1. 读取 Adapter/守卫注入的宿主调用关联信息，为每次子进程启动分配唯一 `invocationId`；不能把同一 shell 内多个进程复用为同一身份。
2. 记录启动尝试的 `invocationId/command/argv/cwd`，用参数数组 spawn 真实脚本或 CLI，不重新拼接 shell 命令；尝试记录不等于 `launch: spawned`。
3. 子进程触发 spawn 后才能记录 `launch: spawned`；启动失败记录 `launch: failed + launchError`，不伪造 exitCode。
4. 捕获 stdout/stderr，同时保序、增量转发给宿主，处理背压；等待 close 后记录真实 `exitCode/signal`，不得结束后才一次性输出。
5. 明确 stdin 策略：继承宿主输入，或增量转发并正确传播 EOF/关闭；不能仅转发输出。第一阶段仅支持非交互 UTF-8 文本进程，TTY/交互程序显式拒绝。
6. 转发宿主取消/终止信号并回收受管子进程及其后代；正常退出保留退出码，信号终止不得伪装成普通非零退出。平台无法兑现时显式报不支持。
7. 每次尝试都生成终态或显式采集错误；采集失败、超时、取消、输出截断和孤儿进程不得伪装为正常完整输出。

测试真实脚本行为时，wrapper 的子进程必须仍是**真实脚本**；不能用 fake 替换脚本后再声称验证了脚本逻辑。外部 CLI 可用 fake，保证参数和返回值确定。

### fake CLI

- 将 fixture 可执行目录只 prepend 到当前 sandbox 的 PATH，不修改真实全局 PATH。
- 记录实际 `process.argv.slice(2)`、cwd、输出和终态，按 invocationId 纳入当前 turn 快照；本期不要求统一 seq collector。
- 按测试配置返回固定 stdout/stderr/exitCode/signal。
- 返回唯一标记（例如 TOKEN_42）便于后续结果核对；跨调用捕获不属于本期接口。
- fake 只降低外部依赖不确定性；是否存在、参数和返回值仍由独立 Observation 判据决定，不能由 fake 自己宣布测试通过。

### 采集覆盖完整性

Profile/Adapter 必须经 `resolveEvidence` 返回 `processCoverage`，不能仅以空数组表达所有情况：

- `complete` 表示本断言目标的全部启动路径均被覆盖、关联和终态校验已完成；仅 prepend PATH shim 而仍能绕过执行，不足以声明 complete。覆盖范围由消费者保证，不声称监控了系统全部进程。
- `complete + calls 中无目标进程` 才能构成“未调用”的内容证据；没有启动尝试不等于 `launch: failed`。
- `incomplete` 必须有非空且可脱敏的 reason；关联丢失、采集失败、wrapper 未回报或未闭合尝试使快照不完整。
- 依赖进程证据的判据先校验覆盖完整性，再做任何正反向内容匹配；不完整快照抛观察错误，不允许 `not` 将其转成通过。
- 未配置 resolver、返回非法 status、重复 invocationId 或矛盾终态同样是观察错误；不得将其默认补成空且完整的快照。
- 快照在 sandbox 清理前冻结；判分和报告使用同一份已采集证据，不在判分时重新采集。

## 动态路径与安装布局

### 路径规则

- 入口文件和目录由实际 Observation 映射为 `resources.<alias>.file/dir/root`。
- 脚本期望写成 `{{ resources.entry.dir }}/scripts/name.mjs`，不写安装根。
- `argv` 做精确数组比较；Adapter 只规范化已确认是路径的参数，非路径参数原样比较。
- `executable` 的真实绝对路径不进入跨布局 expect；稳定身份使用 `command` 和脚本相对路径。
- 安装后发现优先级是独立测试目标，不与可复用行为断言混为一项。

### 安装矩阵

| 场景           | 来源与运行位置                        | 预期                                   |
| -------------- | ------------------------------------- | -------------------------------------- |
| 源码显式加载   | 源码资源根；宿主显式加载路径          | 按显式配置触发，脚本相对入口解析       |
| 项目安装布局 A | 安装快照位于项目发现位置 A            | 同一行为 expect 通过                   |
| 项目安装布局 B | 安装快照位于项目发现位置 B            | 同一行为 expect 原样通过               |
| 用户/全局布局  | 安装快照位于重定向后的用户/agent 目录 | 不写真实 HOME，同一 expect 通过        |
| 重定位布局     | 安装后再次移动资源根                  | 不引用旧源码路径，同一 expect 通过     |
| 未安装         | 不提供任何可发现入口                  | 无入口读取、无目标进程、无产物         |
| 同名冲突       | 两个位置放不同标记版本                | 专门 case 核对实际选中的入口与行为标记 |

“源码存在”不等于宿主自动发现；未显式加载时必须按未安装/未发现处理。Recall provision 不等同于原生安装器，若安装器本身是被测对象，应另建安装行为 case。

全局位置只能铺设到 sandbox 重定向后的 HOME/agent 目录。当前 Recall 资源目标若只覆盖隔离 cwd，全局布局由消费者 `sandboxSetup`/Profile 兑现，不向真实用户目录写入。

## 行为 case 矩阵

| case         | 必须证明                                                          |
| ------------ | ----------------------------------------------------------------- |
| 自然匹配任务 | 入口、目标进程、精确参数和独立产物真实发生；不在本期断言顺序      |
| 无关任务     | 无目标入口、无目标进程、无产物                                    |
| 只解释不执行 | 可读取入口，但无目标进程和产物                                    |
| 未安装       | 无入口、无目标进程和产物                                          |
| 非法输入     | 进程真实启动，预期非零退出和错误输出，无产物                      |
| 参数错误     | 命令名正确也不能弥补 argv 不匹配，case 失败                       |
| 返回错误     | 调用存在但 stdout/stderr/exitCode/signal 不符，case 失败          |
| 启动失败     | `launch: failed` 与启动后非零退出明确区分                         |
| 采集缺失     | resolver 缺失、incomplete 或关联/终态损坏报观察错误；not 不得通过 |
| 同名冲突     | 实际入口和专属行为标记符合发现优先级                              |
| 重定位       | 不同物理根使用同一 expect，旧源码路径未泄漏                       |

## 测试分层

遵循 [测试分层规范](./testing.md)：

| 层级                | 验证内容                                                                                              | 不能证明                         |
| ------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------- |
| `*.test.ts`         | wrapper、fake CLI、真实脚本直接 execFile、快照入口与完整性、路径矩阵、退出码/signal、stdin/取消和负例 | 真实宿主发现与自然模型触发       |
| `*.ittest.ts`       | 真实宿主 + fake provider + sandbox wrapper/fake CLI，验证真实宿主工具路径和采集关联                   | 真实模型是否自然选择 Skill/脚本  |
| `*.token.ittest.ts` | 真实宿主 + live provider，验证自然任务触发与完整链                                                    | 不进入默认回归，需显式授权和预算 |

通用 Node 脚本/测试子进程仍属于单元测试，不因 spawn 自动升级为 ittest。只有拉起真实宿主 CLI 才进入 ittest；真实 provider 产生 token 才进入 token 风险车道。

最终验收同时检查 case PASS/FAIL 和报告 `hardPass`，不能只检查 Recall CLI 退出码。

## 安全、清理与诊断

- wrapper、fake CLI、PATH 修改、全局安装模拟和 collector 全部限定在一次性 sandbox。
- loopback collector 不暴露外部网络；live token case 仍需独立审批。
- close/finally 先停止宿主和剩余子进程，再采集最后证据，最后清理 collector、sandbox HOME/cwd。
- 未闭合启动尝试、孤儿进程和清理失败都显式报告；最终快照标记不完整，不将退出清理当成正常执行完成。
- 诊断默认使用变量引用、逻辑 command 和资源相对路径；绝对 executable、临时 HOME、环境变量和 secret 必须脱敏。
- 不把“模型内部因果”作为声明目标；本设计证明的是可观测触发链和行为对照。

## 本设计验收清单

1. resolver 显式映射当前 turn 快照，旧 Evidence 节点不配置回调仍保持原行为。
2. 一宿主多进程保留不同 invocationId，宿主状态不按子进程退出码重写；数组顺序不用于时序断言。
3. wrapper 记录真实 argv/cwd；spawn 失败、exit 0、非零 exit、signal 四种结果可区分。
4. stdout/stderr 增量返回，stdin/EOF 正确转发；管道输入、背压、超时取消、信号与子进程回收有测试。
5. 未配置、incomplete、重复身份、未闭合或关联丢失显式报观察错误，not 不得误绿。
6. 完整覆盖且无目标进程才证明未调用；PATH 绕过和宿主失败导致证据缺失均有负例。
7. 两种以上项目布局、用户布局、源码布局和重定位布局复用同一行为期望。
8. 未安装、无关任务、只解释不执行、非法输入和同名冲突均有独立 case。
9. 文件证据在清理前采集；报告和判分使用同一快照，不以模型自述替代产物。
10. 单元、真实宿主 fake、真实 live 三层结论不越界；全报告脱敏覆盖原始快照、metadata、错误与输出。

## 分阶段实施

1. **当前迁移优先级**：沿用现有读取/引用/组合证据，补齐消费者映射与内容判定，不增加顺序 API。
2. **有真实执行需求后**：接入 `resolveEvidence`、覆盖完整性、wrapper/fake CLI 和真实脚本直接测试；先由消费者注册判据验证，不新增进程 DSL。
3. **真实宿主适配**：显式调用关联、完整覆盖、安装矩阵和 fake provider ittest；自然触发只走显式批准的 token case。

顺序能力的重新启用条件、seq 信任边界、局部捕获与验收已移至 [Evidence 有序调用与局部捕获](./future/evidence-sequence.md)，不作为上述阶段的交付前置。每阶段独立收口测试和文档，不用 fake provider 的成功替代真实自然触发证据。
