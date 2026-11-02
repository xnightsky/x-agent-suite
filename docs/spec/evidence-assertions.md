# 访问痕迹证据断言

## 目标与边界

`@x-agent-suite/assertions/evidence` 提供普通 `TurnCriterion`：`evidence`。它只消费当前轮公开 `TurnObservation/ToolCall`，根据 Observation 中是否存在匹配的访问痕迹组合工具结果、workspace 资源、回答引用和布尔关系；不证明真实文件系统身份或引用内容权威。

- 不创建第二个 Runner，不调用 Judge，不读取文件系统补证据。
- 不认识具体宿主、工具协议、资源类型或消费者领域判据。
- 不要求通用 Driver 增加完成信号或 workspace 字段；轮次完成性由 Driver/消费者观察守卫负责。
- 不增加结构化子项结果。整体仍返回 `CriterionResult { pass, score, reason }`，组合诊断写入 `reason`。

## 公开入口

| 导出                                              | 用途                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `evidence`                                        | 无 workspace 依赖时可直接注册的 `TurnCriterion`，metric 名为 `evidence` |
| `createEvidenceCriterion(options)`                | 注入按 turn 动态求值的 workspace resolver                               |
| `extractToolOutputText(output)`                   | 提取标准 content-block 文本，不猜测其他 output 形状                     |
| `normalizeWorkspacePath(workspaceCwd, inputPath)` | 纯词法路径归一与边界判断                                                |
| `EvidenceExpect` 及相关类型                       | `toolResult/citation/not/allOf` 声明类型                                |

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

- 无 `path`：所有约束落在同一候选调用集合；声明 `contains` 时，要求同一次成功非空调用包含全部片段。
- 有 `path`：只保留归一后等于 `resource` 的调用；声明 `contains` 时，将该资源所有成功非空读取正文按观察顺序以 `\n` 拼接，再核对全部片段。
- 不同逻辑路径不混合，失败和空白读取不贡献聚合正文。
- 回答自称读过、只发生工具调用或只有失败输出均不能替代有效证据。

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
- `packages/observation/tests/observation-criteria-runner.test.ts`：复用现有调度和 outcome 投影。

## 场景仓示例

`integrations/itrepos/evidence/` 维护完整 Recall 示例：正向 case 组合检索、入口与附件实读、正文片段和最终引用，反向 case 验证无目标访问痕迹。`scripts/tests/itrepos-evidence-config.test.ts` 在默认单元回归中编译实际考卷；真实 provider 验证只能通过显式命令运行：

```bash
pnpm ittest:token:evidence --carrier pi --provider co --model default/deepseek-v4-flash --approve-live
```
