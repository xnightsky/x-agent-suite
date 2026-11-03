---
title: Evidence 有序调用与局部捕获（延后设计）
type: pre-design
status: future
tags: [evidence, sequence]
---

# Evidence 有序调用与局部捕获（延后设计）

> 日期：2026-11-02。状态：整体延后，未实现，不列入本期交付或验收。
> 范围：`sequence`、局部 `steps`、可信 `seq` 与严格 `end-before-start`。本文保存候选约束，不批准占位 API、schema 分支或默认测试。

## 结论与归属

既有场景主要验证入口路由、附件/语言规则读取和答案，不需要有序调用基础设施。通用适用边界见 [Recall 变量机制](../recall-variables.md#当前阶段裁决)。题面中的“先读取”“主链步骤”、`must_run` 清单和 schema-first 答案要求，不能自动推导为真实进程严格时序需求。

因此 **sequence、局部 steps 和严格 seq 整体延后**，不先实现所谓“轻量完成顺序”作为占位，也不将其设为队列迁移前置条件。

文档职责分为三层：

- [Recall 变量机制](../recall-variables.md)：引用语法、静态变量、动态 Provider 与先准备后求值；不定义局部步骤参数。
- [脚本与 CLI 进程执行证据](../process-execution-evidence.md)：快照入口、调用关联、覆盖完整性、wrapper 和独立进程结果；不证明顺序。
- 本文：在前两者具备实际需求和可用证据之后，增加有序匹配与局部捕获。断言仍归现有 `assertions/evidence`，Assertions 不 import Recall。

## 重新启用条件

同时满足以下条件，才重新审查本设计并另列实施范围：

1. 有实际、可执行的消费者 case，明确需要区分 A→B 与 B→A，或验证后一次调用消费前一次返回值；读取集合与独立结果断言不能满足该目标。
2. `resolveEvidence` 已能提供当前 turn 的可信只读快照，覆盖完整性、宿主/进程关联和一宿主多进程展开规则已通过负例验证。
3. Profile 明确声明能提供哪种时序证据；若要求跨来源严格先后，必须兑现下节的执行边界同步，而不是只给日志排序。

重新启用时先以零 token 的最小正反例验证采集可信度，再定公开语法。真实宿主适配进入 `*.ittest.ts`；自然模型触发只进入显式批准的 `*.token.ittest.ts`。下文示例均非当前可用语法。

## 时序证据：序号不是实际时间

### 到达顺序的反例

把宿主与 wrapper 事件送入同一 collector，并分配严格递增 seq，**只能直接证明到达顺序**。跨来源的缓冲或传输延迟可能产生：

```text
实际发生：A.start → B.start → A.end → B.end  // A/B 重叠
采集到达：A.start → A.end → B.start → B.end  // 看起来严格串行
```

因此不能仅凭 collector 的 `A.endSeq < B.startSeq` 就声称实际严格先后；换成毫秒时间戳或合并两个日志，也不能弥补这一缺口。

### 可信边界协议

严格模式至少要求：

- 每个受测动作的开始边界，在执行动作前由统一 collector 编号并确认；动作不得先执行、之后补报 start。
- 结束边界在动作实际结束后上报；在结果向后续动作释放前获得 collector 确认。宿主工具与 wrapper 都必须满足，不能只同步 wrapper。
- 所有参与比较的边界属于同一个本轮采集域。编号是唯一、有限安全整数，start < end；不拼接不同采集器的局部序号。
- 采集区间保守包围实际执行区间。只有得到可信区间的 end-before-start 才能证明实际无重叠；采集延迟可以使结论更保守，不能反向制造通过。
- 宿主只提供缓冲后的回放事件、无法在实际执行边界确认时，Profile 必须声明不支持该严格能力。请求该能力时报观察/能力错误，不猜顺序、不降级成内容 false，也不能被 not 翻成通过。

这不是本期要实现的网络协议；启用时需明确宿主 hook、确认屏障、超时/失联和取消的实现与验证证据。仅有 loopback collector 或单进程编号器不等于已满足协议。

### 顺序记录与区间选择

未来在进程证据的 `EvidenceCall` 上增加 `startSeq/endSeq/timingSource`；当前快照不预留这些字段：

- 无进程调用采用可信宿主区间，`timingSource: host`；进程记录采用该进程可信区间，`timingSource: process`。不能将宿主 start 与进程 end 混拼。
- 原生宿主区间和子进程区间由消费者保留用于关联审计；顶层绑定区间必须对应 timingSource。
- 一宿主多进程按现有快照规则展开；每个进程独立编号，不能将一条 shell 调用的区间复制为多个实际进程区间。
- 启动失败记录采用启动尝试的边界，不把它称为已启动进程；`launch: failed` 与真实启动后退出保持区分。
- 每个尝试必须闭合；重复身份、非法编号、未闭合记录或覆盖不完整均报观察错误，匹配前完整校验。
- 追加式 JSONL 只是一种保存机制。并发写文件的原子性及事件完整性必须验证，不能以成功追加替代执行边界同步。

## `sequence` 候选声明

公开声明仍归现有 `EvidenceExpect`；下面仅表示匹配形状。启用变量后，声明解析接受字面值或引用表达式，运行值按字段原类型校验：

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

候选语义：

- `steps` 非空，步骤名符合 Recall 变量 segment 文法且同级唯一；每条展开后的 EvidenceCall 最多绑定一次。
- `subsequence` 为默认，允许夹其他记录；`exact` 要求与当前 turn 完整展开后的记录流一一对应，包括其他工具/进程，不先按步骤模式过滤。数组稳定枚举顺序不能直接用于时序匹配。
- `completion` 为默认，按可信 `endSeq` 排序并匹配，表示采集协议确认的完成边界顺序，不声称还原未经同步的物理完成时刻，也不保证无重叠。
- `end-before-start` 同样按上述候选流搜索，额外要求前一步 endSeq < 后一步 startSeq；并发重叠不算严格先后。
- 匹配采用**最左、最早、不回溯**：每步绑定前一个绑定之后最早满足自身模式的记录。严格区间检查属于自身匹配条件；后续步骤固定引用该绑定。
- 两种模式都要求所需的可信编号；缺区间、缺能力、编号矛盾、关联损坏或覆盖不完整，匹配前报观察错误。
- `args` 沿用递归子集语义；`resource/process.cwd` 按规范化绝对路径比较；`process.argv` 精确数组相等。Adapter 仅归一已确认是路径的参数，不改写普通字符串。
- 宿主 status、进程 launch/exitCode/signal 分别独立判断；声明 process 时默认要求 launch: spawned，只有显式声明 launch: failed 才匹配启动失败。
- 不复用 toolResult 的 completed/非空正文门槛；失败、空输出和非零退出可作为合法预期。入口轨迹不能单独证明非空读取，仍需独立读取证据。

## 局部 `steps` 与两阶段解析

`steps` 只属于同一个 turn 内当前 sequence 的已绑定前序步骤，不得污染其他判据或静态变量。预期失败的步骤只要模式匹配成功，其结果仍可供后续步骤引用。

未来扩展解析接口时必须遵循两阶段协议，不能在本期先加 local 占位参数：

1. 判据遍历完整 sequence，对每一步每个 opt-in 字段调用准备接口，并提供**该字段可见的完整引用名清单**，如 `steps.prepare.stdoutTrim`。该清单由步骤顺序和公开捕获字段生成，不依赖是否找到调用。
2. 解析器先校验完整引用文法、静态/动态名称及局部可见性；未知字段、自引用、向前引用和跨 sequence 引用一律报定义错误，即使位于 not 或未命中分支。
3. 所有步骤完成准备后才开始匹配；每次成功绑定形成只读 local.steps，再按需求值后续步骤并做目标字段校验。
4. 前序步骤没有绑定时，整条 sequence 是内容 false，不伪造局部值；但不能因此跳过后续步骤的定义检查。动态合法 absent 同样只影响匹配，不掩盖非法引用。

候选捕获字段如下；缺少的字段不补为空字符串，引用不适用于该记录的字段时按明确的局部缺席语义处理。该语义需在重新启用时定稿，不能把损坏记录当成合法缺席。

| 引用                        | 类型        | 来源                      |
| --------------------------- | ----------- | ------------------------- |
| `steps.<name>.status`       | string      | 宿主工具 completed/failed |
| `steps.<name>.input`        | JSON        | 原始工具输入，仅整值引用  |
| `steps.<name>.output`       | JSON        | 原始工具输出，仅整值引用  |
| `steps.<name>.resource`     | path        | 实际资源路径              |
| `steps.<name>.resourceDir`  | path        | 资源所在目录              |
| `steps.<name>.command`      | string      | 进程逻辑命令名            |
| `steps.<name>.argv`         | string[]    | 实际参数数组              |
| `steps.<name>.cwd`          | path        | 实际进程 cwd              |
| `steps.<name>.exitCode`     | number/null | 进程退出码                |
| `steps.<name>.launch`       | string      | spawned/failed            |
| `steps.<name>.signal`       | string/null | 终止信号                  |
| `steps.<name>.stdout`       | string      | 原始 stdout               |
| `steps.<name>.stderr`       | string      | 原始 stderr               |
| `steps.<name>.stdoutTrim`   | string      | stdout 的显式 trim 派生值 |
| `steps.<name>.stderrTrim`   | string      | stderr 的显式 trim 派生值 |
| `steps.<name>.callId`       | string      | 宿主调用关联 id           |
| `steps.<name>.invocationId` | string      | 独立进程调用 id           |
| `steps.<name>.startSeq`     | number      | 可信采集域的开始边界      |
| `steps.<name>.endSeq`       | number      | 同一采集域的结束边界      |

## 后续 Recall 示例

以下只示意未来 expect，不是当前可编译的完整考卷。真实脚本由 wrapper 启动，fixture-cli 是 sandbox PATH 中的受控 fake；资源变量来自实际观测，不含安装根字面量：

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

此例只验证入口调用轨迹、脚本进程、动态路径、参数/结果和可信严格顺序；不证明非空入口读取、模型内部因果或最终文件产物。读取正文与清理前产物另用独立证据。进程步骤刻意不约束宿主 status：宿主可能将多个进程批在同一工具调用中，不能从单个子进程退出码推导宿主状态。

## 后续验收与落地门槛

这些用例不进入当前阶段验收；重新启用后先补采集负例，再实现语法：

1. 实际顺序正确通过，乱序失败；exact/subsequence、同一宿主多进程展开和最早不回溯绑定确定。
2. 完成边界按序但实际并发重叠时，end-before-start 失败；completion 不被误称为无重叠证明。
3. 跨来源延迟/重排的反例不能假绿；没有执行边界确认的 Profile 明确拒绝严格请求。
4. 缺编号、非法区间、不同采集域、关联丢失和 incomplete 快照报观察错误，not 不得吞掉。
5. 未命中第一步时，后续拼错变量、非法字段、自引用和向前引用仍在内容匹配前报定义错误。
6. 正确返回值进入后续 argv 才通过；错误 token、stdout/stderr、exitCode、signal 分别有负例。
7. 预期失败步骤可绑定，但跨 turn、跨 sequence、跨判据的局部引用不可用。
8. 两种以上物理布局复用同一 expect；非路径 argv 不被归一或改写；诊断及 JSON 明细不泄漏物理路径或 secret。

实施顺序必须是：可信快照及关联 → 执行边界同步的最小证明 → sequence 与局部两阶段解析 → 真实宿主 fake ittest → 显式批准的自然触发 token case。没有实际需求或可信时序能力时，停留在本文，不创建运行时代码占位。
