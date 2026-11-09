---
title: "访问痕迹证据断言"
type: spec
status: active
tags: [spec, evidence-assertions]
---

# 访问痕迹证据断言

## 目标与边界

`@x-agent-suite/assertions/evidence` 提供普通 `TurnCriterion`：`evidence`。它只消费当前轮公开 `TurnObservation/ToolCall`，根据 Observation 中是否存在匹配的访问痕迹组合工具结果、workspace 资源、回答引用和布尔关系；不证明真实文件系统身份或引用内容权威。

- 不创建第二个 Runner，不调用 Judge，不读取文件系统补证据。
- 不认识具体宿主、工具协议、资源类型或消费者领域判据。
- 不要求通用 Driver 增加完成信号或 workspace 字段；轮次完成性由 Driver/消费者观察守卫负责。
- 不增加结构化子项结果。整体仍返回 `CriterionResult { pass, score, reason }`，组合诊断写入 `reason`。

> 当前变量能力仅限显式注入后的 `toolResult.contains`，不包含进程节点或顺序节点。静态变量行为见 [Recall 变量机制](./recall-variables.md)，进程快照入口及覆盖完整性见 [脚本与 CLI 进程执行证据](./process-execution-evidence.md)；`sequence`、局部 `steps` 和严格 `seq` 已整体延后，独立保存在 [Evidence 有序调用与局部捕获](./future/evidence-sequence.md)。

## 公开入口

| 导出                                              | 用途                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `evidence`                                        | 无 workspace 依赖时可直接注册的 `TurnCriterion`，metric 名为 `evidence`          |
| `createEvidenceCriterion(options)`                | 注入按 turn 动态求值的 workspace resolver，或显式启用 `toolResult.contains` 变量 |
| `extractToolOutputText(output)`                   | 提取标准 content-block 文本，不猜测其他 output 形状                              |
| `normalizeWorkspacePath(workspaceCwd, inputPath)` | 纯词法路径归一与边界判断                                                         |
| `EvidenceExpect` 及相关类型                       | `toolResult/citation/not/allOf` 声明类型                                         |
| `EvidenceVariableResolver` 及相关类型             | 判据工厂显式接收的准备/求值接口；不反向依赖 Recall                               |

完整证据能力可从 `@x-agent-suite/assertions/evidence` 导入，根入口 `@x-agent-suite/assertions` 继续重导出相同符号。`@x-agent-suite/criteria` 重导出判据与声明类型；纯原语从 assertions 根入口或 evidence 子路径导入。

## 注册与 Recall 使用

无路径断言可直接注册 `evidence`。路径断言由消费者提供 resolver；标准层不读取任何约定的 metadata 键：

```ts
const evidenceWithWorkspace = createEvidenceCriterion({
  resolveWorkspaceCwd: (turn) =>
    typeof turn.metadata.workspaceCwd === "string"
      ? turn.metadata.workspaceCwd
      : undefined,
});
```

resolver 必须按当前 turn/case/repeat 动态求值，因为隔离 cwd 可以每次不同。缺少可信边界时路径断言抛观察错误；无路径断言不调用 resolver。

Recall 变量同样由消费者工厂显式注入，不做全局注册或全 YAML 替换：

```ts
const criterion = createEvidenceCriterion({ variables: context.variables });
```

该选项只作用于 `toolResult.contains`。未注入时，其他声明保持原义，但该字段出现 `{{` 会按配置错误显式拒绝，而不是把模板当普通正文。

注册后，声明放在目标轮的 `expect.evidence`；引用中的“最终回答”就是该轮 `turn.text`：

```yaml
turns:
  - send: 检索并阅读研究流程，然后给出引用
    expect:
      evidence:
        allOf:
          - name: search
            toolResult:
              tool: grep
              args: { query: 研究流程 }
              contains: [docs/research.md]
          - name: read
            toolResult:
              tool: read
              path: { arg: path, resource: docs/research.md }
              contains: [提取关键词, 完成标准]
          - name: cite
            citation:
              tool: read
              pathArg: path
              path: docs/research.md
```

`allOf` 不引入时间顺序，只判断同一 turn 的证据集合。跨次正文聚合仅保持工具观察顺序，不断言检索必须先于读取。

## 节点语义

### `toolResult`

```yaml
toolResult:
  tool: read
  action: optional-action
  args: { optional: subset }
  path: { arg: path, resource: docs/a.md } # 可选
  contains: [片段一, 片段二] # 可选
```

工具名、action、args 匹配与 `tool-call` 一致，args 是递归子集约束。有效证据必须来自 `status: "completed"` 且文本正文 `trim()` 非空的调用；`failed`、缺 output、无可识别文本块、空或纯空白正文均不算有效证据。

`tool`、`action` 和 `args` 走严格 JSON-safe 形状校验：tool/action 必须是非空字符串，args 必须是普通对象；对象只读取 own enumerable data property，对象比较忽略键序，数组比较保留顺序，且 object/array/null 等类型不得互等。args 只接受 null、boolean、finite number、string、dense array 与普通对象；`NaN`、`Infinity`、`undefined`、函数、symbol、BigInt、Date/Map/Set、accessor、非 enumerable 字段、稀疏数组和循环引用均属定义错误。该 JSON 比较语义同时用于 `tool-call` 与检查层 `hardChecks`，不再使用 `JSON.stringify` 字符串相等。

- 无 `path`：所有约束落在同一候选调用集合；声明 `contains` 时，要求同一次成功非空调用包含全部片段。
- 有 `path`：只保留归一后等于 `resource` 的调用；声明 `contains` 时，将该资源所有成功非空读取正文按观察顺序以 `\n` 拼接，再核对全部片段。
- 不同逻辑路径不混合，失败和空白读取不贡献聚合正文。
- 回答自称读过、只发生工具调用或只有失败输出均不能替代有效证据。
- 显式注入 `variables` 后，`contains` 可整值引用字符串数组，也可在数组字符串中嵌入引用；完整声明树先准备、后求值，结果重新满足非空字符串数组校验。其他字段及 `citation.contains` 不插值。
- 变量模式下，缺失片段诊断只报告数量与脱敏标记，不回显解析后的物理路径或变量值；显式 `contains` 求值为 `undefined` 会抛定义错误，不按未声明处理。

### `citation`

```yaml
citation:
  tool: read
  pathArg: path
  path: docs/a.md
  contains: [可选片段]
```

通过需要同时满足：

1. 当前轮 `turn.text.includes(path)`；
2. 同一路径存在成功非空读取；
3. 声明 `contains` 时，同路径聚合正文包含全部片段。

只引用、只读取、失败读取或空白读取均不通过。v1 的路径出现检查刻意只是普通字面子串匹配，不解析 Markdown 或自然语言引用语法；因此 `docs/a.md.bak`、`notdocs/a.md` 也会命中 `docs/a.md`。真实误判若要求边界识别，应另行收紧契约。

### `not`

对单个证据节点取反。正向与反向共享完全相同的状态、正文、路径和聚合语义；失败或空白读取不会在 `not(toolResult)` 中变成“成功加载”。

`not` 只翻转内容布尔结果，不翻转或吞掉定义错误、观察错误。禁止“任何调用尝试”不是本节点的语义，需要未来独立的显式谓词。

### `allOf`

所有子项通过才通过。直接子项必须声明非空且同级唯一的 `name`，整体 `reason` 按 `pass/fail <name>：<原因>` 保留逐项诊断。

声明树在任何内容求值前完整解析，未知节点、未知字段、空清单、重复名称及非法子声明均显式拒绝，不会因短路或未被求值而隐藏。内容子项逐项求值；定义/观察异常立即向上传播。

## 输出文本契约

`extractToolOutputText` 只识别：

```ts
{
  content: [
    { type: "text", text: "第一段" },
    { type: "text", text: "第二段" },
  ],
}
```

合法文本块按顺序以 `\n` 拼接，非文本块及 `text` 非字符串的块不贡献文本。缺 output、`content` 不是数组、没有合法文本块或其他包装形状返回 `undefined`；空文本与纯空白保留原值，由证据谓词判为无效正文。标准层不读取原始 JSONL，也不猜测普通字符串或其他 result 包装。

## workspace 路径契约

`normalizeWorkspacePath` 以显式绝对 `workspaceCwd` 为唯一边界：

- 相对、`./`、workspace 内等价绝对路径可归一到同一逻辑路径。
- 输出为 workspace 相对 POSIX 路径，workspace 根为 `.`。
- 外部路径和解析后的 `..` 逃逸返回 `undefined`；伪造前缀保留不同逻辑身份，后续精确相等不会命中目标资源。
- 资源声明只接受严格相对 POSIX 路径，拒绝绝对路径、盘符、反斜杠、空段、`.`、`..` 段。
- 工具输入才兼容反斜杠与 Windows 路径；Windows workspace 使用盘符或 UNC 词法规则，不同盘符属于边界外。
- 缺边界、相对 workspace、空路径输入或无法可信归一均显式报错，不猜进程 cwd。

这是纯词法资源身份，不是 realpath、inode、符号链接、文件存在或实际读取审计。报告理由使用逻辑资源路径，不需要暴露宿主机绝对 workspace。

## 错误与结果分类

| 类别              | 例子                                                             | 表现                                                                       |
| ----------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 定义错误          | 未知字段、缺 tool/pathArg、非法资源声明、空 allOf                | 在 `evaluate` 校验声明时抛 `TypeError`；不承诺模型执行前预检或装载期退出码 |
| 观察/基础设施错误 | 缺失或非法 ToolCall.status、路径断言缺 workspace、路径输入不可信 | 抛 `Error`，不转成内容 false，不被 not/allOf 吞掉                          |
| 内容未通过        | 未调用、已知 failed、空正文、路径不匹配、缺引用或片段            | 返回 `pass=false, score=0, reason=...`                                     |
| 内容通过          | 声明证据全部满足                                                 | 返回 `pass=true, score=1`                                                  |

## 验证

- `packages/assertions/tests/tool-output.test.ts`：输出文本形状与空白语义。
- `packages/assertions/tests/workspace-path.test.ts`：相对/绝对/Windows 路径、边界与逃逸。
- `packages/assertions/tests/evidence.test.ts`：读取、否定、组合、声明和观察错误。
- `packages/assertions/tests/evidence-citation.test.ts`：引用、跨次分段阅读及完整检索—实读—引用组合。
- `packages/assertions/tests/evidence-variables.test.ts`：字段级 opt-in、完整准备顺序、求值后类型校验和未注入配置错误。
- `packages/recall/tests/recall-var.test.ts`、`packages/recall/tests/recall-variables.test.ts`：静态语法、三层 vars、内建命名空间及 Recall 闭环。
- `packages/observation/tests/observation-criteria-runner.test.ts`：复用现有调度和 outcome 投影。

## 场景仓示例

`integrations/itrepos/evidence/.recall.yaml` 原样保留字面量基线；`integrations/itrepos/evidence/variables/.recall.yaml` 以两个单轮 case 独立覆盖三层 `vars`、整值数组、多变量嵌入、转义、单次展开、逻辑身份和 `turn.index=0`；`turn.index=1` 与跨轮隔离由零 token Runner repeat 覆盖。两个配置测试在默认单元回归中核对声明形态，并经真实消费者工厂与独立 fake 观察验证；真实 provider 验证使用两个精确入口：

```bash
pnpm ittest:token:evidence --carrier <carrier> --provider <provider> --model <model> --approve-live
pnpm ittest:token:evidence-variables --carrier <carrier> --provider <provider> --model <model> --approve-live
```

## 有序择档断言实施补充

`turn.expect.firstOf` 与 `case.expect.firstOf` 的本次实施契约见 [有序择档断言](./recall-first-of.md)。普通兄弟断言仍全部执行且必过；每个组合档内 AND、档间按数组顺序只在合法内容失败时 fallback，首个通过后跳过本组后档。组合只提交一个顶层结果和一份 hit/共同 miss 贡献，内部原始失败保留为诊断而不独立计分；执行/缺裁定/清理错误不触发降级。evidence 节点、平铺 rubric 和主执行线性顺序保持原义。

本扩展开发与验收中，不能据此视为已获真实 token 验证。实现收口须同时通过默认零 token 回归与另行授权的真实 token 验收；报告、进度、repeat 和错误诊断同属交付范围。
