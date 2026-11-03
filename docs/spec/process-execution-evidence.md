# 脚本与 CLI 进程执行证据（待审设计）

> 日期：2026-11-02。状态：待审设计，未实现。
> 范围：脚本/CLI 的真实进程证据、严格顺序、动态安装位置、返回值和测试分层。变量语法见 [Recall 变量机制](./recall-variables.md)，断言归属仍是现有 `assertions/evidence`。

## 结论

完整验证链必须是：

```text
自然任务
  → 实际入口读取
  → 宿主工具 start/end
  → 真实进程 start/end
  → 精确 argv/cwd/stdout/stderr/exitCode/signal
  → 后续调用消费前序结果
  → 清理前产物快照
```

只凭模型回答、宿主工具名或命令字符串，不能证明脚本/CLI 真实执行。本设计使用三类独立证据：

1. **宿主工具证据**：证明入口读取和工具调用轨迹。
2. **进程证据**：证明实际启动、参数、工作目录、输出和退出结果。
3. **产物证据**：证明副作用，而不是模型声称成功。

## 需求覆盖

| 需求                             | 设计出口                                         |
| -------------------------------- | ------------------------------------------------ |
| Skill/能力入口实际触发           | 原生入口读取事件 + 动态资源 Provider             |
| 项目、全局、源码和安装后位置不同 | `resources.<alias>.*`，同一 expect 跨布局复用    |
| 真实脚本执行                     | launcher wrapper + 真实脚本子进程                |
| 真实 CLI 执行                    | sandbox PATH shim/wrapper + 进程记录             |
| 精确 CLI 参数                    | 实际 spawn argv 数组，不解析 shell 文本猜测      |
| stdout/stderr/退出码             | wrapper 等待真实 close 并记录 code/signal/output |
| 先/后/再调用                     | 统一单调 `seq` + `sequence`                      |
| 前一步返回传给下一步             | `steps.*` 局部捕获                               |
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

消费者 Adapter 向 Evidence 提供 `EvidenceCall[]`：

```ts
interface EvidenceCall {
  callId?: string; // 宿主工具调用 id
  invocationId?: string; // 进程调用 id
  tool: string;
  action?: string;
  input?: unknown;
  output?: unknown;
  status?: "completed" | "failed";
  resource?: string; // 归一化实际资源路径

  startSeq?: number;
  endSeq?: number;
  timingSource?: "host" | "process";

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

    startSeq: number;
    endSeq: number;
  };
}
```

约束：

- read 等无进程调用使用宿主 start/end；进程调用优先使用真实进程 start/end，并用 `timingSource` 留痕。
- 顶层 `EvidenceCall.startSeq/endSeq` 必须与 `timingSource` 对应的宿主或进程区间一致，不能混拼两个来源。
- `callId` 与 `invocationId` 是不同身份；Adapter 必须显式关联，不得按命令文本或相近时间猜测。
- `command` 是可移植逻辑名，例如 node 或 fixture-cli；实际绝对 `executable` 只用于诊断。
- `argv` 是实际子进程参数，不包含宿主 shell 的 quoting，也不把整条 command 字符串当 argv。
- stdout/stderr 本设计限定为 UTF-8 文本；二进制协议输出不在第一阶段范围内。
- 所有证据必须在 sandbox 清理前采集完毕。

## 统一顺序采集器

宿主事件和 wrapper 进程事件必须进入**同一个 trace collector**，由采集器分配严格递增 `seq`：

```text
seq=1  host tool start       callId=entry
seq=2  host tool end         callId=entry
seq=3  process start         invocationId=prepare
seq=4  process end           invocationId=prepare exitCode=0
seq=5  process start         invocationId=consume
seq=6  process end           invocationId=consume exitCode=23
```

规则：

- 不用毫秒时间戳代替顺序；同一毫秒和时钟回拨都不能改变 `seq`。
- 串行测试可使用追加式 JSONL；需要覆盖并发时使用由单个 loopback/进程内 collector 统一编号的记录方式。
- 多进程直接并发写同一 JSONL 文件时，不得未经证明就假设写入原子性。
- 每个 start 必须有对应 end；session 结束仍有未闭合记录属于观察错误。
- `end-before-start` 跨宿主和进程步骤都使用同一 `seq`，不拼接两个独立日志的局部序号。

## 进程 wrapper 与 fake CLI

### wrapper 协议

wrapper 是被测宿主实际调用的启动入口，负责：

1. 读取 Adapter/守卫注入的 `invocationId`。
2. 发送 process start：`invocationId/command/argv/cwd`。
3. 用参数数组 spawn 真实脚本或 CLI，不重新拼接 shell 命令。
4. 捕获子进程 stdout/stderr。
5. 等待 close，发送 process end：真实 `exitCode/signal`。
6. spawn 失败时记录 `launch: failed + launchError`，不得伪造 exitCode。
7. 捕获的同时将子进程 stdout/stderr 增量转发给宿主，并原样交还退出结果；不得等进程结束后一次性输出而改变宿主行为。

测试真实脚本行为时，wrapper 的子进程必须仍是**真实脚本**；不能用 fake 替换脚本后再声称验证了脚本逻辑。外部 CLI 可用 fake，保证参数和返回值确定。

### fake CLI

- 将 fixture 可执行目录只 prepend 到当前 sandbox 的 PATH，不修改真实全局 PATH。
- 记录实际 `process.argv.slice(2)` 和 cwd，并交给统一 collector。
- 按测试配置返回固定 stdout/stderr/exitCode/signal。
- 用唯一标记（例如 TOKEN_42）验证后续调用确实消费前序结果。
- fake 只降低外部依赖不确定性；是否存在、参数和返回值仍由独立 Observation 判据决定，不能由 fake 自己宣布测试通过。

### 采集覆盖完整性

Profile 必须声明当前 turn 的进程采集覆盖是否完整：

- 覆盖完整时，没有目标进程记录可以构成“未调用”的内容证据。
- 覆盖不完整、关联丢失或 wrapper 未回报时，严格进程断言属于观察错误，不能判成“未调用”。
- 宿主工具失败且没有进程记录时，只有具备完整采集覆盖才能区分“未启动”和“证据丢失”。

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

## `sequence` 断言契约

公开声明仍归入现有 `EvidenceExpect`：

```ts
{
  sequence: {
    mode?: "subsequence" | "exact";
    timing?: "completion" | "end-before-start";
    steps: Array<{
      name: string;
      tool: string;
      action?: string;
      args?: Record<string, unknown>;
      resource?: string;
      status?: "completed" | "failed";
      process?: {
        command?: string;
        argv?: string[];
        cwd?: string;
        launch?: "spawned" | "failed";
        exitCode?: number | null;
        signal?: string | null;
        stdout?: string;
        stderr?: string;
      };
    }>;
  };
}
```

语义：

- `steps` 非空，步骤名符合变量 segment 文法且同级唯一。
- `mode: subsequence` 为默认，允许中间夹其他调用；`exact` 要求完整一一对应。
- 匹配采用**最左、最早、不回溯**：每步绑定前一个绑定之后最早满足自身模式的调用。后续 `steps` 固定引用该绑定。
- `timing: completion` 为默认，按匹配调用的 `endSeq` 判断完成顺序。
- `timing: end-before-start` 要求前一步 `endSeq < 后一步 startSeq`；并发重叠不算严格先后。
- 声明严格时序但缺 start/end、序号矛盾或证据未闭合，属于观察错误。
- `process.argv` 精确数组相等；`status/launch/exitCode/signal` 分别独立判断。
- 声明 process 字段时默认要求 `launch: spawned`；只有显式声明 `launch: failed` 才匹配启动失败。
- sequence 不复用 `toolResult` 的 completed/非空正文门槛；失败、空输出和非零退出均可作为合法预期。

## 完整 Recall 示例

以下 expect 不含任何安装根路径。`prepare` 的真实脚本由 wrapper 启动，`fixture-cli` 是 PATH 中的受控 fake：

```yaml
vars:
  inputFile: fixtures/changes.json
  expectedExit: 23

cases:
  - id: relocated-ordered-chain
    turns:
      - send: 请根据项目的改动清单生成统计报告。
        expect:
          evidence:
            sequence:
              mode: subsequence
              timing: end-before-start
              steps:
                - name: entry
                  tool: read
                  resource: "{{ resources.entry.file }}"
                  status: completed

                - name: prepare
                  tool: bash
                  status: completed
                  process:
                    command: node
                    argv:
                      - "{{ resources.entry.dir }}/scripts/prepare.mjs"
                      - --input
                      - "{{ run.workspaceDir }}/{{ vars.inputFile }}"
                    cwd: "{{ run.workspaceDir }}"
                    launch: spawned
                    exitCode: 0
                    signal: null
                    stdout: "TOKEN_42\n"

                - name: consume
                  tool: bash
                  status: failed
                  process:
                    command: fixture-cli
                    argv:
                      - consume
                      - --token
                      - "{{ steps.prepare.stdoutTrim }}"
                    cwd: "{{ run.cwd }}"
                    launch: spawned
                    exitCode: "{{ vars.expectedExit }}"
                    signal: null
                    stderr: "EXPECTED_FAILURE\n"
```

该例同时验证：实际入口、真实脚本、动态路径、精确 argv/cwd、严格顺序、前序 stdout 传递、下一步真实退出码和 stderr。产物是否存在及内容另用文件证据判据，不塞进 process.stdout 猜测。

## 行为 case 矩阵

| case         | 必须证明                                                       |
| ------------ | -------------------------------------------------------------- |
| 自然匹配任务 | 入口和预期 A→B→C 链真实发生，产物正确                          |
| 无关任务     | 无目标入口、无目标进程、无产物                                 |
| 只解释不执行 | 可读取入口，但无目标进程和产物                                 |
| 未安装       | 无入口、无目标进程和产物                                       |
| 非法输入     | 进程真实启动，预期非零退出和错误输出，无产物                   |
| 参数错误     | 命令名正确也不能弥补 argv 不匹配，case 失败                    |
| 顺序错误     | A/B/C 都出现但顺序错误，case 失败                              |
| 并发重叠     | 完成顺序符合但 `end-before-start` 不满足，case 失败            |
| 返回错误     | 调用与顺序正确但 stdout/stderr/exitCode/signal 不符，case 失败 |
| 启动失败     | `launch: failed` 与启动后非零退出明确区分                      |
| 额外调用     | exact 拒绝；subsequence 忽略中间调用，但关键步骤仍须按序匹配   |
| 同名冲突     | 实际入口和专属行为标记符合发现优先级                           |
| 重定位       | 不同物理根使用同一 expect，旧源码路径未泄漏                    |

## 测试分层

遵循 [测试分层规范](./testing.md)：

| 层级                | 验证内容                                                                                    | 不能证明                         |
| ------------------- | ------------------------------------------------------------------------------------------- | -------------------------------- |
| `*.test.ts`         | wrapper、fake CLI、真实脚本直接 execFile、进程记录、sequence、路径矩阵、退出码/signal、负例 | 真实宿主发现与自然模型触发       |
| `*.ittest.ts`       | 真实宿主 + fake provider + sandbox wrapper/fake CLI，验证真实宿主工具路径和采集关联         | 真实模型是否自然选择 Skill/脚本  |
| `*.token.ittest.ts` | 真实宿主 + live provider，验证自然任务触发与完整链                                          | 不进入默认回归，需显式授权和预算 |

通用 Node 脚本/测试子进程仍属于单元测试，不因 spawn 自动升级为 ittest。只有拉起真实宿主 CLI 才进入 ittest；真实 provider 产生 token 才进入 token 风险车道。

最终验收同时检查 case PASS/FAIL 和报告 `hardPass`，不能只检查 Recall CLI 退出码。

## 安全、清理与诊断

- wrapper、fake CLI、PATH 修改、全局安装模拟和 collector 全部限定在一次性 sandbox。
- loopback collector 不暴露外部网络；live token case 仍需独立审批。
- close/finally 先停止宿主和剩余子进程，再采集最后证据，最后清理 collector、sandbox HOME/cwd。
- 未闭合 process/host 事件、孤儿进程和清理失败都显式报告。
- 诊断默认使用变量引用、逻辑 command 和资源相对路径；绝对 executable、临时 HOME、环境变量和 secret 必须脱敏。
- 不把“模型内部因果”作为声明目标；本设计证明的是可观测触发链和行为对照。

## 验收清单

1. wrapper 记录真实 argv/cwd，shell quoting 不改变参数身份。
2. spawn 失败、exit 0、非零 exit、signal 四种结果可区分。
3. stdout/stderr 原样返回宿主，wrapper 不改变被测行为。
4. 宿主与进程事件使用统一 seq，严格先后和并发重叠判定正确。
5. callId/invocationId 关联错误和未闭合记录显式报观察错误。
6. 采集覆盖不完整时不得证明“未调用”。
7. 两种以上项目布局、用户布局、源码布局和重定位布局复用同一 expect。
8. 未安装、无关任务、只解释不执行、非法输入和同名冲突均有独立 case。
9. steps 数据引用来自最早绑定步骤，后续 argv 能验证前序返回传递。
10. 文件证据在清理前采集，模型自述不能替代产物。
11. 单元、真实宿主 fake、真实 live 三层各自结论不越界。
12. 报告不泄漏绝对路径、环境变量或 secret。

## 分阶段实施

1. **进程证据基座**：collector、wrapper、fake CLI、真实脚本直接测试和覆盖完整性。
2. **顺序判据**：EvidenceCall、sequence、精确 argv/结果、局部 steps 与变量接线。
3. **真实宿主适配**：原生 callId/start/end、wrapper 关联、安装矩阵和 fake provider ittest。
4. **自然触发验收**：显式 token case、报告 hardPass、负例、清理与脱敏。

每阶段独立收口测试和文档，不用 fake provider 的成功替代真实自然触发证据。
