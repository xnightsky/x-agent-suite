---
title: "Recall 变量机制"
type: spec
status: active
tags: [spec, recall-variables]
---

# Recall 变量机制

> 日期：2026-11-02；阶段 1 完成：2026-11-03。状态：静态基础已实现，动态 Provider 仍待实施。
> 范围：当前已落地 Recall 内部 `recall-var` 静态基础、三层 `vars`、`turn.index` 和 `evidence.toolResult.contains` 的显式 opt-in；`run/resources` 动态 Provider 继续留待阶段 2。`sequence`、局部 `steps` 和严格 `seq` 整体延后，不新增 npm 包或顶层判据模块。

## 结论

变量属于 **Recall 的编译与执行上下文**，不属于某个判据。采用 `recall-var` 作为 Recall 内部子系统，统一提供：

- `{{...}}` 引用语法、转义和类型保持；
- 文档、plan、case 的 `vars` 继承；
- `scenario/case/plan/turn` 内建变量；
- `run/resources` 动态 Provider；
- 定义错误、动态缺席、Observation 损坏和脱敏语义。

`assertions/evidence` 不拥有 Recall 变量机制，也不反向依赖 Recall。有序断言与局部捕获独立维护在 [Evidence 有序调用与局部捕获](../future/evidence-sequence.md)，本文不定义其接口或验收。

## 当前阶段裁决

只读盘点表明，既有消费者迁移首先需要非空读取、正确资源身份、禁止误触发和答案判定；旧场景没有真实进程结果、局部返回值引用、可执行顺序断言或变量引用。该结论只用于确定通用能力边界，不记录消费者名称、内部队列、业务规则或 case 分布，也不建立运行时依赖。

因此迁移优先解决上述通用行为；变量只在字段确实需要动态期望时启用，不能把顺序基础设施设为迁移前置条件。`sequence/steps/seq` 不列入本期验收、不开实现占位。重新启用的条件见 [有序断言的阶段裁决](../future/evidence-sequence.md#重新启用条件)。

## 所有权与依赖方向

```text
Recall YAML
  │
  ▼
recall-var（Recall 内部）
  ├─ 静态作用域：vars / scenario / case / plan
  ├─ 观测作用域：turn
  ├─ 动态 Provider：run / resources
  ├─ 语法、类型、错误与脱敏
  └─ prepareValue(value) → prepared.resolve()
  │
  ▼
Criterion 评估上下文
  ├─ 显式支持变量的判据
  └─ 不支持变量的判据继续读取原始 expect
```

依赖保持为：

- Recall 实现变量解析器，先经显式判据工厂/选项注入；通用上下文接缝只是候选接口，新增 contracts 字段前必须证明第二个独立消费者也需要，不能仅为 Recall 扩大核心契约；
- Assertions 只消费通用解析接口，不 import Recall；
- 非 Recall Runner 可以不注入解析器，现有判据行为不变；
- `recall-var` 先作为 Recall 内部实现，出现第二个非 Recall 消费者后再决定是否下沉独立包。

## 判据接缝：按需解析，不做全局预替换

解析接口采用“先准备、后求值”；以下是行为示意，不代表本期新增公开导出或通用上下文字段：

```ts
type VariableResolution =
  | { status: "resolved"; value: unknown }
  | { status: "absent"; reference: string };

interface PreparedVariableValue {
  resolve(): VariableResolution;
}

interface CriterionVariableResolver {
  prepareValue(value: unknown): PreparedVariableValue;
}
```

规则：

- 判据只对显式支持的 expect 字段调用 `prepareValue`，完整准备声明树后才做内容匹配；这就是 criterion/字段双层 opt-in。
- 不调用解析器的判据仍收到原始 expect，完全兼容。
- 解析器递归处理数组和对象的**值**，不处理 YAML 键名。
- `prepareValue` 不读取运行值；校验文法、静态引用、动态名称目录和作用域。静态值可提前验证，动态值在 `resolve` 后做目标字段校验。
- 本期不接受局部引用，也不预留局部解析参数；后续扩展在独立设计中重新审查。
- 解析是同步纯计算；Driver/Adapter 必须提前把动态证据收进 Observation，解析器不执行 I/O。
- 含变量语法但没有配置解析器时显式报配置错误，不将模板字面量当作普通期望值。

这个接缝避免 Recall 预先理解每个 criterion 的 expect 形状，也避免 Assertions 依赖 Recall。

目标作用域固定为：turn 判据可使用静态命名空间及当前 turn 的 `turn/run/resources`；session 判据只允许 `vars/scenario/case/plan`。阶段 1 仅通过 turn 判据工厂注入静态命名空间与 `turn.index`，`run/resources/steps` 均在准备阶段拒绝；session 判据尚未接入变量解析，不隐式选择最后一轮。动态能力与 session 接入仍须按阶段 2 重新审查。

## 方案选择

| 方案               | 裁决     | 原因                                                      |
| ------------------ | -------- | --------------------------------------------------------- |
| `{{...}}`          | **采用** | YAML 中直观，与 shell 展开冲突小，支持嵌入路径片段        |
| 美元花括号引用     | 否决     | 与 shell 环境变量展开同形，命令断言中容易误读             |
| `@entry`           | 否决     | 与 CLI 的 `@file`、scope 名等合法参数冲突，且缺少命名空间 |
| 美元双花括号引用   | 否决     | 嵌套括号增加转义和阅读成本                                |
| `{ var: run.cwd }` | 暂不采用 | 类型明确但无法简洁嵌入路径；可作内部 AST，不作作者接口    |

## 非目标与安全边界

变量只能由判据在显式支持的 expect 字段中解析。以下位置**禁止插值**：

- `turns[].send`、case id 和其他执行输入；
- `resources[].source/destination` 与其他 provision 字段；
- `effects`、`commands.allow/deny`、工具权限和超时；
- target、provider、model、凭据、`executionParams`；
- YAML 键名。

因此变量不能改变考卷、执行目标、安装位置或权限，只能改变“怎样核对结果”。

明确不提供：

- `env.*`、凭据或 secret 读取；
- JavaScript、算术、正则求值、函数调用和过滤器；
- 变量值的二次/递归展开；
- 变量引擎读取文件、realpath 或推断进程 cwd；
- 步骤捕获和跨判据局部变量引用。

未来若要开放 provision 静态变量，必须作为独立契约阶段审查，不因 `recall-var` 存在而自动获得能力。

## 引用语法

### 基本文法

```text
reference = "{{" optional-space name optional-space "}}"
name      = segment ("." segment)+
segment   = ASCII 小写字母开头，后续为 ASCII 字母或数字
```

示例：

```yaml
resource: "{{ resources.entry.file }}"
cwd: "{{run.workspaceDir}}"
exitCode: "{{ vars.expectedExit }}"
argv:
  - "{{ resources.entry.dir }}/scripts/prepare.mjs"
  - --input
  - "{{ run.workspaceDir }}/{{ vars.inputFile }}"
```

变量名区分大小写，统一使用 lowerCamelCase。`vars` 自定义变量、资源 alias 和可引用步骤名也遵守 `segment` 文法。

### 整值引用与嵌入引用

- scalar 只含一个引用时为**整值引用**，保留变量原始类型。
- 引用前后还有其他字符时为**嵌入引用**；只允许 string、finite number、boolean，按字符串拼接。
- array、object、null 只能用于整值引用，不能嵌入字符串。
- 求值后的值必须再次满足目标字段原有类型。例如 `exitCode` 必须是整数，`argv` 必须是字符串数组。

```yaml
# 整值引用：结果仍是 number
exitCode: "{{ vars.expectedExit }}"

# 整值引用：结果仍是 array
argv: "{{ vars.expectedArgv }}"

# 嵌入引用：结果是字符串
resource: "{{ resources.entry.dir }}/SKILL.md"
```

### 转义与单次展开

- 在允许变量的字段中，`\{{` 表示字面量 `{{`；其余反斜杠不变。
- YAML 自身的引号与反斜杠规则仍生效；字面量模板符推荐使用单引号。
- 变量求值结果中的 `{{...}}` 不再解析，防止递归、循环和值注入。
- `vars` 的值不再包含变量引用；组合发生在实际使用字段中。
- `vars` 只按变量名寻址，不支持 `vars.foo.bar` 或数组下标；对象/数组只能经 `{{ vars.foo }}` 整值引用。

## 变量命名空间

### 总表

| 命名空间      | 所有者                     | 求值阶段           | 示例                        |
| ------------- | -------------------------- | ------------------ | --------------------------- |
| `vars.*`      | Recall 文档/选中 plan/case | 静态               | `{{ vars.inputFile }}`      |
| `scenario.*`  | Recall compiler            | 静态               | `{{ scenario.dir }}`        |
| `case.*`      | Recall compiler            | case 展开时        | `{{ case.id }}`             |
| `plan.*`      | Recall compiler            | 选择文件内 plan 后 | `{{ plan.name }}`           |
| `turn.*`      | Runner                     | 当前轮观测后       | `{{ turn.index }}`          |
| `run.*`       | 消费者变量 Provider        | 当前轮观测后       | `{{ run.workspaceDir }}`    |
| `resources.*` | 消费者变量 Provider        | 当前轮观测后       | `{{ resources.entry.dir }}` |

保留命名空间不能被 `vars` 覆盖；自定义值只能经 `vars.<name>` 访问。

### 静态声明 `vars`

允许在文档顶层、选中文件内 plan、case 三层声明：

```yaml
vars:
  inputFile: fixtures/changes.json
  expectedExit: 23

plans:
  variant:
    vars:
      expectedExit: 24
    resources: []

cases:
  - id: example
    vars:
      inputFile: fixtures/other.json
```

合并优先级：

```text
case > 当前选中的 plan > 文档顶层
```

按变量名浅合并，未覆盖项保留；无资源 plan 或使用 `none` 时该层为空。`vars` 值必须是 JSON 数据，禁止函数、undefined 和非有限数字。该设计不改变现有 `context` 整块覆盖语义。

### `scenario.*`、`case.*`、`plan.*`、`turn.*`

| 变量               | 类型   | 含义                                                 |
| ------------------ | ------ | ---------------------------------------------------- |
| `scenario.id`      | string | 当前 Recall 文档 id                                  |
| `scenario.file`    | path   | 当前 `.recall.yaml` 的绝对文件路径                   |
| `scenario.dir`     | path   | `scenario.file` 所在目录                             |
| `scenario.rootDir` | path   | 本次编译实际采用的有效 `--root-dir`                  |
| `case.id`          | string | 当前 case id                                         |
| `plan.name`        | string | 当前文件内 plan 名；无资源 plan 时为 `none`          |
| `turn.index`       | number | 当前轮索引，与 `TurnObservation.index` 一样从 0 开始 |

`scenario.dir` 与 `scenario.rootDir` 不互换：前者是考卷文件位置，后者是资源解析基准。

### `run.*`：当前运行路径

| 变量               | 类型 | 含义                                                           |
| ------------------ | ---- | -------------------------------------------------------------- |
| `run.workspaceDir` | path | 当前 case/repeat 的隔离 workspace 根                           |
| `run.homeDir`      | path | 当前 case/repeat 的隔离 HOME                                   |
| `run.cwd`          | path | 当前 turn 的主执行 cwd；无法可信提供时缺席，不猜测为 workspace |

`run.workspaceDir` 与 `run.cwd` 通常相同但语义不同；具体进程 cwd 来自该进程的独立观测，不能用主执行 cwd 代替。

### `resources.*`：动态观察到的资源位置

资源 alias 由消费者 Adapter/变量 Provider 注册，通用层不枚举 alias，也不解释领域类型。

| 变量                     | 类型 | 含义                                              |
| ------------------------ | ---- | ------------------------------------------------- |
| `resources.<alias>.file` | path | 实际观察到的资源入口文件；目录资源可缺席          |
| `resources.<alias>.dir`  | path | 文件资源的 `dirname(file)`，或目录资源本身        |
| `resources.<alias>.root` | path | Provider 明确提供的资源根；无法确定时缺席，不猜测 |

以任意位置的能力包为例，Adapter 可将实际读取到的入口登记为 `entry`：

```text
{{ resources.entry.file }} → <实际位置>/SKILL.md
{{ resources.entry.dir }}  → <实际位置>
```

同一断言因此可复用于源码、项目安装、全局安装和重定位布局。行为断言验证“脚本属于本次实际加载的资源根”；项目/全局发现优先级另由专门 case 验证。

## 动态 Provider

Recall registry 可注册一个同步变量 Provider，为 `run/resources` 提供值。注册时必须显式声明支持的完整引用名及值类型，资源 alias 由消费者声明；未知名称在准备阶段报定义错误，不能以 `absent` 掩盖拼写错误。Provider 的求值输入是当前变量名和当前 `TurnObservation`，输出统一为：

```ts
type VariableResolution =
  | { status: "resolved"; value: unknown }
  | { status: "absent"; reference: string };
```

约束：

- Provider 只读取已采集 Observation/metadata，不访问真实 HOME、源仓或文件系统补证据。
- 未配置 Provider 却引用 `run/resources`，属于配置/观察错误。
- 已配置 Provider 对已声明名称返回 `absent`，表示该动态来源本轮合法地没有出现；采集不完整或映射失败必须抛观察错误，不能返回 `absent`。
- Provider 返回错误类型或矛盾路径，必须抛观察错误，不能伪装成 `absent`。
- 通用框架不读取约定的 metadata 键；键与资源 alias 都由消费者显式映射。

## 路径值与路径匹配

路径变量使用**规范化绝对路径**，不保存用户目录字面量，也不要求作者知道实际值：

- POSIX 使用 `/...`；Windows 使用带盘符或 UNC 的绝对路径，比较前统一分隔符。
- `scenario.*` 描述源考卷位置，`run.*` 描述隔离执行位置，`resources.*` 描述实际观察位置。
- 变量引擎不访问文件系统，不证明 realpath、inode、符号链接或文件存在。
- 现有 `toolResult.path.resource` 仍是 workspace 相对逻辑路径；变量求值为绝对路径后仍按原契约拒绝。本期不因变量存在而开放绝对动态资源断言。

默认诊断使用变量引用、逻辑路径或脱敏计数，不回显变量值、临时 HOME、workspace 或源仓绝对路径；需要保留物理路径时由报告脱敏器处理。

## 解析阶段与缺失语义

### 阶段

1. **声明准备**：判据遍历完整声明树，对 opt-in 字段执行 `prepareValue`；校验文法、静态引用、Provider 名称目录和 scope，不依赖本轮证据是否命中。
2. **静态求值**：准备结果保存 `vars/scenario/case/plan` 的值，不做全 YAML 文本替换。
3. **观测求值**：当前 turn 完成后，通过准备结果的 `resolve` 按需读取 `turn/run/resources`；动态缺席不跳过其他字段的定义检查。
4. **目标字段校验**：声明阶段识别字面值或引用表达式，不能提前用 number/array 等运行值 schema 拒绝模板；求值后的值重新满足原字段类型与路径约束。

### 错误分类

| 情况                                                         | 分类与结果                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| 文法错误、未知静态/动态名称、保留命名空间拼错或 scope 不支持 | 定义错误；即使位于 `not` 或未命中分支也拒绝                   |
| 整值/嵌入引用类型不符合目标字段                              | 定义错误                                                      |
| 已知动态来源本轮没有出现，例如未观察到 `resources.entry`     | 返回 `absent`；当前模式不可匹配，内容 false，不替换为空字符串 |
| 应提供的运行上下文或 Provider 缺失                           | 配置/观察错误，不转为内容 false，不被 `not` 吞掉              |
| Provider 返回错误类型或矛盾路径                              | 观察错误                                                      |
| 动态值存在但与实际结果不匹配                                 | 内容 false                                                    |

“动态来源缺席”与“观察损坏”必须区分：前者是合法无证据，后者显式抛错。这样 `not` 可以否定真正未出现的模式，却不能把损坏 Observation 变成通过。

## 阶段 1 已启用字段

当前只有 `evidence.toolResult.contains` 可以通过工厂选项接收 Recall 变量解析器；其他判据与字段，包括 `citation.contains`，仍读取原始声明。Recall 判据工厂可显式装配：

```ts
const criterion = createEvidenceCriterion({ variables: context.variables });
```

对应考卷写法：

```yaml
vars:
  requiredMarker: REPORT_OK

cases:
  - id: example
    turns:
      - send: 读取报告并核对结果
        expect:
          evidence:
            toolResult:
              tool: read
              contains:
                - "{{ vars.requiredMarker }}"
                - "turn-{{ turn.index }}"
                - '\{{ 仅字面量 }}'
```

`contains` 也可整值引用一个字符串数组。完整 `evidence` 声明树先准备全部 `contains`，再统一求值并重新执行原字段类型校验；未命中 `not/allOf` 分支中的非法引用同样失败。

## 兼容性与文档关系

- 不含 `{{` 的现有声明保持原义。
- 不调用变量解析接口的判据完全不变。
- `toolResult/citation/not/allOf` 的现有语义不变。
- [Scenario DSL](../scenario-dsl.md) 的执行前参数化决策不变；本文只增加结果评估期的变量解析。
- [Evidence assertions](../evaluation/evidence-assertions.md) 是当前行为契约；阶段 1 可用语法仅限上述显式字段，教程不得将其扩展为全局插值。
- [脚本与 CLI 进程执行证据](../evaluation/process-execution-evidence.md) 定义独立证据基座；[Evidence 有序调用与局部捕获](../future/evidence-sequence.md) 保存延后的顺序设计，不属于本文实施范围。
- 不新增公开 package、子路径导出或顶层 criterion 名。

## 本期验收用例

1. 整值 number/boolean/null/array/object 保持类型，嵌入引用拒绝非标量。
2. 多个变量可嵌入同一字符串；转义和变量值不递归展开。
3. 文档/plan/case 的 `vars` 覆盖顺序正确，保留命名空间不可覆盖。
4. 完整声明准备先于内容求值；未命中分支中的未知变量仍失败，已声明动态名称缺席不能掩盖其他定义错误。
5. Provider 缺失、未知动态名称和损坏观察不被 `not` 吞掉；只有合法动态缺席形成内容 false。
6. 至少两种物理布局验证同一 opt-in 字段的动态期望；不扩大现有 workspace 路径契约。
7. 报告脱敏覆盖变量值、Observation/metadata、错误和 JSON 明细，不只处理 reason；未配置解析器的旧 Runner 行为不变。
8. session 动态引用和本期 `steps` 引用在准备阶段拒绝；现有队列迁移不依赖顺序能力。

## 分阶段落地顺序

### 阶段 1：`recall-var` 静态基础（已完成）

- 已实现声明准备、转义、整值类型保持、嵌入引用、三层 `vars` 浅合并、保留命名空间约束、静态命名空间和 turn 判据的 `turn.index`。
- 已通过 `RecallCriterionFactoryContext.variables` 与 `createEvidenceCriterion({ variables })` 显式注入，仅为 `evidence.toolResult.contains` 建立闭环；未新增通用 contracts 字段。
- 未引入 sequence、局部 steps、seq collector 或动态 Provider，未改变 `send`、provision 等执行输入。
- 验证入口：`packages/recall/tests/recall-var.test.ts`、`packages/recall/tests/recall-variables.test.ts`、`packages/assertions/tests/evidence-variables.test.ts`，覆盖工厂装配、完整准备、plan 选择和 2 case × 2 turn × repeat=2 隔离。
- 原 `integrations/itrepos/evidence/.recall.yaml` 保持字面量基线；独立 `variables/.recall.yaml` 以 2 个单轮 case 覆盖三层优先级、整值数组、嵌入、转义、单次展开、标量、逻辑身份及 turn.index=0。turn.index=1 与跨轮隔离由零 token repeat 覆盖。live 分别经 `pnpm ittest:token:evidence` 与 `pnpm ittest:token:evidence-variables` 运行。

### 阶段 2：动态 Provider 与路径

- 增加动态名称/类型声明及 `run/resources` Provider，区分未知名称、合法 absent 与观察错误。
- 用至少两种不同物理布局验证同一 opt-in expect 原样通过；保留现有路径字段边界。
- 验证 Provider 缺失、完整声明检查、session 限制与全报告脱敏。

每阶段独立收口单元测试、类型检查、边界守卫和文档，不合成一次大改。
