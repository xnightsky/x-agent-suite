# 从评测实践借鉴的模式

> 本页记录两套内部 evals 实践中摸出的、可直接用于 x-agent-suite 的设计模式与教训。
> 来源以角色代称，避免暴露非公开仓库信息：
>
> - **内部评测实践 A**：面向知识检索类 agent 的评测框架。贡献 carrier 适配层、Observation 归一、ArtifactEvidence、分层评分。
> - **内部评测实践 B**：面向命令行工具类 agent 的评测框架。贡献 enumerate 核对、工作拷贝隔离、崩溃隔离、双格式报告、变体矩阵。

## 1. Observation 模式：别让测试去刮 stdout

内部评测实践 A 把所有 carrier 的输出统一成 `Observation`：命令、文本、工具调用、步骤、是否耗尽、carrier 标识。评分逻辑**不直接读宿主 stdout**。

内部评测实践 B 也吃过这个亏：早期从 stdout/stderr 正则刮工具序列，结果把「工具调用数」当成「模型轮数」，两者实测差 5 倍。后来改走 `--trace` 结构化事件。

### 对我们的映射

- `Observation` 必须包含：
  - `toolCalls: { name, input, output?, status }[]`
  - `steps?: number`（模型轮数）
  - `toolCallsCount: number`
  - `exhausted?: boolean`
  - `usage?: { promptTokens, completionTokens, totalTokens }`
  - `latencyMs: number`
  - `carrier: string`
- Harness driver 负责把宿主输出解析成 `Observation`。
- Scenario 断言只消费 `Observation`，不读原始 stdout。

## 2. ArtifactEvidence：状态与 transcript 分开评分

内部评测实践 A 把外部状态作为独立的 `ArtifactEvidence`：通用层扫描隔离 workspace，业务层再解释它是否满足场景语义。

### 对我们的映射

- 跑完 scenario 后，除了看 harness 输出，还要直接查被测系统状态。
- 把「状态断言」写成独立的证据检查，不和 stdout 正则混在一起。
- 框架通过 `metadata` / `evidence` 自由区透传，不解释语义。

## 3. 评分层：Dry → Hard → Fuzzy → LLM Judge

内部评测实践 A 明确分层：

| 层           | 例子                                                         | 我们的映射                                                   |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Dry contract | topology 有效、schema 正确                                   | 工具 schema 校验、fixture 脚本结构合法、fake provider 能启动 |
| Hard         | first command、must consume、forbid commands、artifact match | 期望工具被调用、参数正确、外部证据匹配                       |
| Fuzzy        | 审计行格式、等价文本表达                                     | 返回文本包含 `done=true`                                     |
| LLM judge    | 文档是否真正清晰                                             | 可选：评估模型回复自然度                                     |

默认先写 Dry + Hard，Fuzzy 兜底，LLM judge 最后才加。

## 4. 列举类核对（enumerate）：正则查不出的假

内部评测实践 B 的真实案例：模型列出 72 条路径，尾部 17 条是凭空捏造的，但正则只查「末条在不在」差点放过。解决办法是把列出的**每一条**拿去和真实状态核对，报「捏造 / 漏列」。

### 对我们的映射

- 列表类场景不能只看输出里有几个名字，要把列出来的每个 id 拿去和真实状态核对。
- 在 scenario 断言里增加 `enumerate` 类检查：
  - `extract`: 从文本抽 id 的正则；
  - `requireComplete`: 是否要求没有漏列；
  - 结果报 `hallucinated: string[]` 和 `missing: string[]`。

## 5. 工作拷贝隔离 + 环境剥离

内部评测实践 B 每次把场景根拷贝到临时目录，并显式剥离该工具自己的配置目录环境变量；还会把选中的 prompt 变体复制为 `AGENTS.md` 后删除 prompts 目录，防止 agent 读到其它变体。

### 对我们的映射

- `sandbox.md` 已经做了临时 `HOME`/`cwd`；再补 `stripEnv: string[]`：每个 `HarnessProfile` 声明要从子进程环境剥离的变量。
- 工作拷贝在测试结束后删除，除非 `E2E_KEEP_SANDBOX=1`。

## 6. 崩溃不掀桌

内部评测实践 B 之前一个场景崩了整个 runner 跟着崩；已改成单场景降级为「该场景判红 + 留栈」，其余场景照跑。

### 对我们的映射

- `node:test` 的 `test()` 天然隔离单个用例；
- harness preflight 的循环或 matrix 脚本要自己 catch：
  - 单个 harness 启动失败 → 记为 failed，继续下一个；
  - 单个 scenario 超时/崩溃 → 记为 failed，输出 stderr tail，继续下一个。

## 7. 报告：`.md` 给人看 + `.json` 给排查

内部评测实践 B 每次跑同时出 `.md` 结论和 `.json` 明细（含完整 argv / tool 入参）。

### 对我们的映射

- 每次跑同时出：
  - `.tmp/xas-reports/<ts>-<scenario>-report.md`：给人看的结论表；
  - `.tmp/xas-reports/<ts>-<scenario>-report.json`：完整 Observation、证据、tool 入参、stdout/stderr tail；
- `.tmp/` 不入库。

## 8. Matrix / 对照表脚本

内部评测实践 B 的矩阵脚本把一个场景的全部提示词变体跑成一张对照表，变体从目录自动发现。

### 对我们的映射

- `scripts/matrix.ts`：同一个 scenario 用多个 carrier 各跑一遍，输出对照表；
- 变体从 `fixtures/prompts/<scenario>/*.md` 自动发现。

## 9. 埋点 wrapper：我们不需 wrapper，因为我们有被测系统

内部评测实践 B 的外部 agent 场景用 PATH wrapper 冒充被测 CLI，客观记录 argv。

我们不需要 wrapper：被测系统通常是自己实现的，可以直接从其暴露的接口捕获调用事件，比 wrapper 更可靠。但 wrapper 思路提醒我们：**不要依赖宿主自报，要从外部客观观测**。

这条在长驻通道与 PTY 路径下同样成立：

- 宿主的结构化事件可用于**时序**观测，但「工具是否真的执行、返回了什么」应以被测系统侧记录为准；
- PTY 路径下屏幕文本**只能用于同步**，断言必须落在被测系统侧证据上。

## 10. 应用状态

| 模式                          | 落点                                                                               | 状态   |
| ----------------------------- | ---------------------------------------------------------------------------------- | ------ |
| Observation 归一              | [contracts.md](./contracts.md)、[scenario-evaluation.md](./scenario-evaluation.md) | 已应用 |
| ArtifactEvidence 分离         | [scenario-evaluation.md](./scenario-evaluation.md)                                 | 已应用 |
| 分层评分 Dry→Hard→Fuzzy→Judge | [scenario-evaluation.md](./scenario-evaluation.md)                                 | 已应用 |
| enumerate 核对                | [scenario-evaluation.md](./scenario-evaluation.md)                                 | 已应用 |
| 双格式报告                    | [scenario-evaluation.md](./scenario-evaluation.md)、[matrix.md](./matrix.md)       | 已应用 |
| `stripEnv` 与工作拷贝隔离     | [sandbox.md](./sandbox.md)                                                         | 已应用 |
| 崩溃隔离                      | [sandbox.md](./sandbox.md)、[matrix.md](./matrix.md)                               | 已应用 |
| 变体矩阵                      | [matrix.md](./matrix.md)                                                           | 已应用 |
| 外部客观观测                  | [pty-driver.md](./pty-driver.md)、[long-lived-driver.md](./long-lived-driver.md)   | 已应用 |
