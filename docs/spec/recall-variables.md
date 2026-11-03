# Recall 变量机制与 Evidence 局部捕获（待审设计）

> 日期：2026-11-02。状态：待审设计，未实现。
> 范围：在 Recall 内实现统一 `recall-var` 子系统；Evidence 只增加 `sequence` 和局部 `steps` 捕获。不新增 npm 包或顶层判据模块。

## 结论

变量属于 **Recall 的编译与执行上下文**，不属于某个判据。采用 `recall-var` 作为 Recall 内部子系统，统一提供：

- `{{...}}` 引用语法、转义和类型保持；
- 文档、plan、case 的 `vars` 继承；
- `scenario/case/plan/turn` 内建变量；
- `run/resources` 动态 Provider；
- 定义错误、动态缺席、Observation 损坏和脱敏语义；
- 判据局部作用域解析。

`assertions/evidence` 不拥有 Recall 变量机制，也不反向依赖 Recall。它只在评估 `sequence` 时，把已匹配步骤作为局部 `steps` 作用域交给同一个解析器。

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
  └─ resolveValue(value, { local })
  │
  ▼
Criterion 评估上下文
  ├─ Evidence sequence
  │    └─ local.steps = 已匹配的前序步骤
  ├─ 其他显式支持变量的判据
  └─ 不支持变量的判据继续读取原始 expect
```

依赖保持为：

- Recall 可以实现变量解析器并通过通用判据上下文注入；
- Assertions 只消费通用解析接口，不 import Recall；
- 非 Recall Runner 可以不注入解析器，现有判据行为不变；
- `recall-var` 先作为 Recall 内部实现，出现第二个非 Recall 消费者后再决定是否下沉独立包。

## 判据接缝：按需解析，不做全局预替换

在通用 turn/session 判据上下文中增加可选解析器：

```ts
type VariableResolution =
  | { status: "resolved"; value: unknown }
  | { status: "absent"; reference: string };

interface CriterionVariableResolver {
  resolveValue(
    value: unknown,
    options?: {
      local?: Readonly<Record<string, unknown>>;
    },
  ): VariableResolution;
}
```

规则：

- 判据只在显式支持的 expect 字段调用 `resolveValue`；这就是 criterion/字段双层 opt-in。
- 不调用解析器的判据仍收到原始 expect，完全兼容。
- 解析器递归处理数组和对象的**值**，不处理 YAML 键名。
- `local` 只保存当前判据提供的局部作用域，例如 Evidence 的已绑定 `steps`。
- 解析是同步纯计算；Driver/Adapter 必须提前把动态证据收进 Observation，解析器不执行 I/O。
- 含变量语法但没有配置解析器时显式报配置错误，不将模板字面量当作普通期望值。

这个接缝避免 Recall 预先理解每个 criterion 的 expect 形状，也避免 Assertions 依赖 Recall。

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
- 跨 case、跨 turn、跨 sequence 的步骤引用。

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

| 命名空间      | 所有者                     | 求值阶段           | 示例                             |
| ------------- | -------------------------- | ------------------ | -------------------------------- |
| `vars.*`      | Recall 文档/选中 plan/case | 静态               | `{{ vars.inputFile }}`           |
| `scenario.*`  | Recall compiler            | 静态               | `{{ scenario.dir }}`             |
| `case.*`      | Recall compiler            | case 展开时        | `{{ case.id }}`                  |
| `plan.*`      | Recall compiler            | 选择文件内 plan 后 | `{{ plan.name }}`                |
| `turn.*`      | Runner                     | 当前轮观测后       | `{{ turn.index }}`               |
| `run.*`       | 消费者变量 Provider        | 当前轮观测后       | `{{ run.workspaceDir }}`         |
| `resources.*` | 消费者变量 Provider        | 当前轮观测后       | `{{ resources.entry.dir }}`      |
| `steps.*`     | 判据局部作用域             | 前序步骤匹配后     | `{{ steps.prepare.stdoutTrim }}` |

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

`run.workspaceDir` 与 `run.cwd` 通常相同但语义不同；具体进程 cwd 应引用 `steps.<name>.cwd`。

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

### `steps.*`：判据局部捕获

`steps` 只在支持局部步骤的判据中可用。Evidence sequence 每匹配一步，就将该步加入后续解析的 `local.steps`：

| 变量                       | 类型        | 含义                          |
| -------------------------- | ----------- | ----------------------------- |
| `steps.<name>.status`      | string      | 宿主工具状态 completed/failed |
| `steps.<name>.input`       | JSON        | 原始工具输入，仅适合整值引用  |
| `steps.<name>.output`      | JSON        | 原始工具输出，仅适合整值引用  |
| `steps.<name>.resource`    | path        | 该步实际资源路径              |
| `steps.<name>.resourceDir` | path        | 该步资源所在目录              |
| `steps.<name>.command`     | string      | 进程启动命令的归一名称        |
| `steps.<name>.argv`        | string[]    | 该步参数数组                  |
| `steps.<name>.cwd`         | path        | 该步实际进程 cwd              |
| `steps.<name>.exitCode`    | number/null | 进程退出码；信号终止可为 null |
| `steps.<name>.launch`      | string      | 进程启动状态 spawned/failed   |
| `steps.<name>.signal`      | string/null | 终止信号；正常退出为 null     |
| `steps.<name>.stdout`      | string      | 原始 stdout                   |
| `steps.<name>.stderr`      | string      | 原始 stderr                   |
| `steps.<name>.stdoutTrim`  | string      | stdout 的显式 trim 派生值     |
| `steps.<name>.stderrTrim`  | string      | stderr 的显式 trim 派生值     |
| `steps.<name>.callId`      | string      | 原生调用关联 id               |
| `steps.<name>.startSeq`    | number      | 统一采集器分配的开始序号      |
| `steps.<name>.endSeq`      | number      | 统一采集器分配的结束序号      |

禁止自引用、向前引用、跨 sequence、跨 turn 和跨判据引用。预期失败的步骤只要匹配成功，其结果仍可被后续步骤引用。

## 动态 Provider

Recall registry 可注册一个同步变量 Provider，为 `run/resources` 提供值。Provider 的输入是当前变量名和 Observation，输出统一为：

```ts
type VariableResolution =
  | { status: "resolved"; value: unknown }
  | { status: "absent"; reference: string };
```

约束：

- Provider 只读取已采集 Observation/metadata，不访问真实 HOME、源仓或文件系统补证据。
- 未配置 Provider 却引用 `run/resources`，属于配置/观察错误。
- 已配置 Provider 返回 `absent`，表示该动态来源本轮合法地没有出现。
- Provider 返回错误类型、矛盾路径或非法序号，必须抛观察错误，不能伪装成 `absent`。
- 通用框架不读取约定的 metadata 键；键与资源 alias 都由消费者显式映射。

## 路径值与路径匹配

路径变量使用**规范化绝对路径**，不保存用户目录字面量，也不要求作者知道实际值：

- POSIX 使用 `/...`；Windows 使用带盘符或 UNC 的绝对路径，比较前统一分隔符。
- `scenario.*` 描述源考卷位置，`run.*` 描述隔离执行位置，`resources.*` 描述实际观察位置。
- 变量引擎不访问文件系统，不证明 realpath、inode、符号链接或文件存在。
- `sequence.resource` 与 `process.cwd` 按规范化路径比较。
- `process.argv` 按数组精确比较；Adapter 按命令参数语义归一其中的路径参数，非路径参数不得改写。
- 现有 `toolResult.path.resource` 仍是 workspace 相对逻辑路径；变量求值为绝对路径后仍按原契约拒绝。绝对动态路径只用于新的 `sequence.resource/process`。

默认诊断使用变量引用和逻辑路径，不回显临时 HOME、workspace 或源仓绝对路径；需要保留物理路径时由报告脱敏器处理。

## 解析阶段与缺失语义

### 阶段

1. **声明解析**：检查文法、保留命名空间、静态变量形状和判据局部引用规则。
2. **静态求值**：按需解析 `vars/scenario/case/plan`，不做全 YAML 文本替换。
3. **观测求值**：当前 turn 完成后，按需提供 `turn/run/resources`。
4. **局部求值**：判据提供 `local` 后解析对应变量；Evidence 只放入已匹配的前序 `steps`。
5. **目标字段校验**：求值后的值重新满足原字段类型与路径约束。

### 错误分类

| 情况                                                     | 分类与结果                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| 文法错误、未知静态变量、保留命名空间拼错、向前/自引用    | 定义错误；即使位于 `not` 或未命中分支也拒绝                   |
| 整值/嵌入引用类型不符合目标字段                          | 定义错误                                                      |
| 已知动态来源本轮没有出现，例如未观察到 `resources.entry` | 返回 `absent`；当前模式不可匹配，内容 false，不替换为空字符串 |
| 应提供的运行上下文或 Provider 缺失                       | 配置/观察错误，不转为内容 false，不被 `not` 吞掉              |
| Provider 返回错误类型、非法序号或矛盾 start/end          | 观察错误                                                      |
| 动态值存在但与实际结果不匹配                             | 内容 false                                                    |

“动态来源缺席”与“观察损坏”必须区分：前者是合法无证据，后者显式抛错。这样 `not` 可以否定真正未出现的模式，却不能把损坏 Observation 变成通过。

## 有序执行断言的归属

本文只定义变量如何进入 `sequence` 以及前序步骤如何形成局部作用域。真实进程记录、wrapper/fake CLI、安装矩阵、严格时序、进程结果和测试分层见 [脚本与 CLI 进程执行证据](./process-execution-evidence.md)。

## 示例

### 变量可被不同判据复用

以下是判据显式支持变量后的目标写法，不代表现有判据已经支持：

```yaml
vars:
  requiredMarker: REPORT_OK
  expectedReport: { total: 3, added: 2, fixed: 1 }

expect:
  text-contains:
    - "{{ vars.requiredMarker }}"
  artifact-json:
    path: "{{ run.workspaceDir }}/out/report.json"
    value: "{{ vars.expectedReport }}"
```

### 动态安装位置与有序调用

完整 Recall YAML、真实脚本 wrapper、PATH fake CLI、产物证据和行为 case 矩阵统一维护在 [脚本与 CLI 进程执行证据](./process-execution-evidence.md)；本文不再复制执行细节。

## 兼容性与文档关系

- 不含 `{{` 的现有声明保持原义。
- 不调用 `resolveValue` 的判据完全不变。
- `toolResult/citation/not/allOf` 的现有语义不变。
- [Scenario DSL](./scenario-dsl.md) 的执行前参数化决策不变；本文只增加结果评估期的变量解析。
- [Evidence assertions](./evidence-assertions.md) 是当前行为契约；本文未实现前不得在教程中当作可用语法。
- [脚本与 CLI 进程执行证据](./process-execution-evidence.md) 定义 `sequence` 和进程证据；本文定义它使用的变量与局部捕获。
- 不新增公开 package、子路径导出或顶层 criterion 名。

## 验收用例

1. 整值 number/boolean/null/array/object 保持类型，嵌入引用拒绝非标量。
2. 多个变量可嵌入同一字符串；转义和变量值不递归展开。
3. 文档/plan/case 的 `vars` 覆盖顺序正确，保留命名空间不可覆盖。
4. 未知静态变量、非法步骤名、向前/自引用在内容求值前失败。
5. 动态 `absent` 形成内容 false；Provider 缺失和损坏观察不被 `not` 吞掉。
6. 两种以上物理安装布局使用同一 expect 原样通过。
7. Windows/POSIX 路径按约定归一，非路径 argv 不被改写。
8. sequence 正序通过、乱序失败，exact/subsequence 和最早绑定行为确定。
9. argv、stdout/stderr、exitCode、status 分别独立判定。
10. 并发完成顺序符合但不满足 `end-before-start` 时失败。
11. `steps` 只能引用已绑定前序步骤，不能跨 turn/判据使用。
12. 报告不泄漏临时绝对路径；未配置变量解析器的旧 Runner 结果不变。

## 分阶段落地顺序

### 阶段 1：`recall-var` 静态基础

- 实现引用扫描、转义、整值类型保持、嵌入引用和 `vars/scenario/case/plan/turn`。
- 通过通用判据上下文注入 `resolveValue`，选择一个简单判据验证 opt-in。
- 不引入 sequence，不改变执行输入。

### 阶段 2：动态 Provider 与路径

- 增加 `run.*`、`resources.*` Provider、`absent` 和路径规范化。
- 用至少两种不同物理布局验证同一 expect 原样通过。
- 验证 Provider 缺失、观察错误与报告脱敏。

### 阶段 3：Evidence 有序调用与局部捕获

- 增加 `sequence`、进程结果、完成顺序和 `local.steps`。
- 覆盖 argv、stdout/stderr、exitCode、status、最早绑定和负例。

### 阶段 4：严格时序与真实宿主

- 保留原生 start/end 和 callId，完成 `end-before-start`。
- 真实宿主 + fake provider 验证 Adapter；真实模型只进入显式 token 风险车道验证自然触发。

每阶段独立收口单元测试、类型检查、边界守卫和文档，不合成一次大改。
