# 原生 Recall 声明式评测

## 目的与边界

`@x-agent-suite/recall` 把 `.recall/` 中的代码运行配置和 YAML 考卷编译为现有 `ScenarioSpec[]`，再复用 Runner 的 repeat、判据调度和报告。它是一套 x-agent-suite 原生格式：不兼容、不转换、不依赖外部 recall 实现，也不引入第二套执行抽象。

Recall 不认识模型目录、PTY profile、真实渠道或凭证；这些由消费者的 driver/backend 工厂负责。包内不预置 metric，不直接写被测工作区，也不会自动创建 `.recall/`。

## 命令与发现

```bash
x-agent-suite recall
x-agent-suite recall .recall/project-rules.yaml
x-agent-suite recall --config .recall/x-agent-suite.config.ts .recall/project-rules.yaml
x-agent-suite recall path/to/existing-directory
```

发现顺序固定如下：

1. `--config` 指定运行配置；否则读取调用 cwd 下 `.recall/x-agent-suite.config.ts`。
2. 显式考卷目标优先：单个 `.yaml/.yml` 文件，或已有目录的第一层 YAML；目录不递归。
3. 未给目标时，config 的可选 `files` 覆盖默认发现；其中相对路径按 config 所在目录解析。
4. 两者都未给时，读取调用 cwd 下 `.recall/*.{yaml,yml}` 第一层。
5. 所有考卷按解析后的绝对路径排序。缺配置、缺考卷、目标不存在和配置导入失败都在执行前报错。

`eval <config>`、`run <config>` 和 `diff` 仍走原 Runner 路径，语义不变。

## 运行配置

```ts
import type { RecallConfig } from "x-agent-suite/recall";

const config: RecallConfig = {
  createDriver: (spec) => createConsumerDriver(spec),
  criteria: consumerCriteria,
  repeat: 1,
  outDir: ".tmp/x-agent-suite",
  rootDir: "..",
  files: ["project-rules.yaml"],
  carrier: "consumer-carrier",
};
export default config;
```

- `createDriver` 与 `criteria` 必填，类型复用 `RunScenarioSpecDeps`。
- `repeat` 缺省 1，必须是正整数。
- `outDir` 缺省 `.tmp/x-agent-suite`；相对路径按调用 cwd 解析。
- `rootDir` 缺省调用 cwd；显式相对路径按 config 所在目录解析。
- `files` 可选，只接受非空路径字符串数组。
- `carrier` 可选，用于显式覆盖报告行；未配置时优先采用 driver 的 `Observation.carrier`，最后缺省 `default`。provider/model 等目标信息由消费者写入 `Observation.metadata`，报告原样保留。Recall 不解析多目标配置，也不调用 live 目标选择器。
- 配置只接受上述字段；未知字段、非法 repeat、重复 scope/name 判据和导入错误属于定义错误，均在创建 driver 前拒绝。

## YAML v1

```yaml
version: 1
id: project-rules
context:
  files:
    - AGENTS.md
    - AGENTS.ai.md
cases:
  - id: local-address
    turns:
      - send: 本项目访问本地服务应该使用什么地址？
        expect:
          text-contains: [127.0.0.1]
    metadata:
      source: AGENTS.md#local-rules
  - id: multi-turn-example
    timeoutMs: 120000
    turns:
      - send: 第一轮输入
        expect:
          text-contains: [first]
      - send: 第二轮输入
        timeoutMs: 30000
        expect:
          text-contains: [second]
```

只允许以下形状：

| 层级 | 字段                                             |
| ---- | ------------------------------------------------ |
| 顶层 | `version`、`id`、可选 `context.files`、`cases`   |
| case | `id`、`turns`、可选 `timeoutMs`、可选 `metadata` |
| turn | `send`、可选 `expect`、可选 `timeoutMs`          |

`version` 必须为 1；ID 非空；`cases/turns` 非空；`send` 不得为空字符串；timeout 必须是正整数。`expect` 的键必须匹配运行配置中的 turn-scope Criterion 名，值原样透传给判据。未知字段、YAML 解析错误和未注册 metric 都在创建 driver 前失败。

v1 不支持 judge、decision、variants、自然语言 score_rule、case 依赖、共享 setup、条件分支或跨 case 输入/输出引用。

## 编译与 context

每个 case 编译为一个独立 `ScenarioSpec`：

- ID 为 `<recall-file-id>/<case-id>`，同一运行内不得重复。
- turns 与 case/turn timeout 映射到同名字段。
- case metadata 原样保留，并写入保留键 `metadata.recall = { file, fileId, caseId }`；来源路径也合入报告 Observation metadata。
- context 编译为 `provision.context.files = [{ path, content }]`。每个 case 得到独立 provision 对象，消费者 driver/provision 负责把内容物化到 sandbox。

context 只接受 rootDir 内的相对路径。Recall 同时检查词法路径与 realpath，拒绝绝对路径、`..` 逃逸、符号链接逃逸、缺失文件和非普通文件。源文件只读；Recall 不写被测工作区。

## 执行、退出码与扩展

全部 config、所有考卷、metric、context 和跨文件 ID 校验通过后，才开始创建 driver。执行逐 case、逐 repeat 顺序调用 `runScenarioRepeat`：每次执行重新调用工厂并由 Runner 关闭 driver；同一 case 内多轮共享该次会话，不同 case 不共享执行状态。

- 用法、配置、YAML、引用和发现错误：退出码 2。
- driver、超时、报告写入等基础设施错误：退出码 1。
- 行为判据不通过：报告中 `hardPass=false`，退出码仍为 0。
- 每个 case 写出现有 Markdown + JSON 报告；repeat>1 时带稳定率统计。

扩展通过显式版本演进、`metadata`、`provision` 和消费者 Criterion 注册完成。新增 YAML 能力必须先定义通用价值、严格 Schema 与编译语义；v1 不放置无行为的“保留字段”。
