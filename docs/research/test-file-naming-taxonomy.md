# 测试文件命名是否需要继续细化

> 调研日期：2026-08-28
>
> 范围：`*.test.ts`、`*.ittest.ts`、`*.token.ittest.ts` 是否还应扩展 PTY、headless、live、smoke、contract 等终止后缀。
>
> 证据约束：只采用 runner 官方文档/源码、仓库自身配置与本地一手代码。

## 结论

**当前不应继续增加测试终止后缀。** 建议把现有命名准确描述为“两个验证层级 + 一个执行风险修饰符”：

| 维度     | 语法                | 语义                                                                    | 默认入口                 |
| -------- | ------------------- | ----------------------------------------------------------------------- | ------------------------ |
| 验证层级 | `*.test.ts`         | 不拉起真实宿主 CLI，纯 fake/loopback/通用测试进程，零 token             | `pnpm test`              |
| 验证层级 | `*.ittest.ts`       | 拉起真实宿主 CLI，以 fake endpoint 验证真实宿主路径，零 token           | `pnpm itest`             |
| 风险修饰 | `*.token.ittest.ts` | 集成测试的子集；访问真实 provider，存在 token、费用、凭据和数据出站风险 | 仅精确的 `itest:token:*` |

PTY、headless、sandbox 是运行机制；smoke 是抽样范围；contract 是验证目的；live 是环境/风险描述。它们能彼此组合，也都不能单独决定一个测试该进入 `pnpm test`、`pnpm itest` 还是显式 token 入口，因此不应成为新的保留终止后缀。

推荐语法为：

```text
<描述性用例名>.test.ts
<描述性用例名>.ittest.ts
<描述性用例名>.token.ittest.ts
```

能力词仍可出现在“描述性用例名”中，例如：

```text
pty-screen.test.ts
pi-pty-smoke.ittest.ts
provider-contract.token.ittest.ts
```

这里的 `pty`、`smoke`、`contract` 只是便于人和搜索工具理解的 stem，不改变终止后缀的执行语义。

## 判断原则

文件终止后缀只承担两个职责：

1. **在导入测试模块之前选择执行车道。** 这是防止凭据读取、真实网络、费用和账号副作用的必要条件。
2. **回答默认命令是否应收录该文件。** 后缀必须能被 runner 以一个稳定、完整、顺序唯一的谓词判断。

下列信息不应由终止后缀承担：

- 测试使用 PTY、headless、JSONL、HTTP 或 sandbox；
- 测试属于 smoke、contract、regression 或 conformance；
- 测试慢、只适用某个操作系统、某个 provider 或某项可选能力；
- 测试是否起子进程。通用合成进程与真实宿主 CLI 的风险和验证对象不同。

这些是横切标签。它们适合放在 stem、测试标题、教程 catalog、支持矩阵、显式脚本或成熟的 runner tag/project 中。

## 一手证据

### Node.js Test Runner

本仓 [`package.json`](../../package.json) 声明 Node `>=24.0.0`，调研环境实测为 `v24.14.0`。

- Node v24.14 默认发现 `**/*.test.ts`、`**/*-test.ts`、`**/test/**/*.ts` 等固定模式，也允许命令末尾传入显式 glob。也就是说，文件发现本来就是一条可独立配置的执行边界，而不是一套通用的 unit/integration/PTY 分类学。[Node v24.14：Running tests from the command line](https://nodejs.org/download/release/v24.14.0/docs/api/test.html#running-tests-from-the-command-line)
- `--test-name-pattern` / `--test-skip-pattern` 只能过滤测试名称；官方明确说明它们**不会改变 runner 执行的文件集合**。因此名称、标题或用例级标签不能承担 token 文件的第一道防误跑边界。[Node v24.14：Filtering tests by name](https://nodejs.org/download/release/v24.14.0/docs/api/test.html#filtering-tests-by-name)
- Node v26.2 才引入原生 test tags，且稳定性仍是 Early development。官方直接将 tags 定义为“把 metadata 编进测试名”的替代方案，适合 subsystem、speed、flakiness、environment 等横切轴。[Node v26.2：Test tags](https://nodejs.org/download/release/v26.2.0/docs/api/test.html#test-tags)

本仓基线允许 Node 24.0–24.18，当前环境 24.14 也没有 tag CLI，因此现在不能把原生 tags 当作仓库规范依赖。即使未来提高最低版本，tags 也只适合能力筛选；token 风险仍应在文件导入前由发现器排除。

### Vitest

- Vitest 默认 `include` 是 `**/*.{test,spec}.?(c|m)[jt]s?(x)`；官方的 unit/e2e 示例通过不同 project 的 `include` 分组，但两组仍使用同一个 `.test.js` 终止后缀。[Vitest：include](https://vitest.dev/config/include)
- Projects 用于同一进程中的不同配置、环境和 browser，可用 `--project` 选择；这些运行维度不要求继续堆叠文件后缀。[Vitest：Test Projects](https://vitest.dev/guide/projects)
- Vitest 支持给测试增加 tags 并以 `--tags-filter` 选择。官方同时提醒：`-t`、tag filter、`.only`、`.skip` 仍需加载测试文件来发现用例，若要降低加载范围应同时传文件路径。[Vitest：Test Filtering](https://vitest.dev/guide/filtering)、[Vitest：Test Tags](https://vitest.dev/guide/test-tags)

这再次区分了两种职责：project/path/include 负责文件级选择，tag/name 负责文件加载后的横切筛选。

### Jest

- Jest 默认通过 `__tests__` 目录和 `.test` / `.spec` 文件名发现测试；`testMatch` 可覆盖发现集合。[Jest：testMatch](https://jestjs.io/docs/configuration#testmatch-arraystring)
- Jest 的 `projects` 可在一个 invocation 中运行多套配置或 runner；`--selectProjects`、`--testPathPatterns`、`--testNamePattern` 分别提供 project、文件路径、测试标题层的选择。[Jest：projects](https://jestjs.io/docs/configuration#projects-arraystring--projectconfig)、[Jest CLI](https://jestjs.io/docs/cli)

Jest 没有要求用文件终止后缀编码每一种环境或能力；发现、配置分组和用例筛选是分开的机制。

### Playwright

- Playwright 默认发现 `.test` / `.spec` 文件，并通过 `testMatch`、`testIgnore` 改写集合。[Playwright：Filtering Tests](https://playwright.dev/docs/test-configuration#filtering-tests)
- Projects 是同一组测试在不同浏览器、设备、登录态、环境、timeout 或 retry 下运行的逻辑配置组，可用 `--project` 精确选择。[Playwright：Projects](https://playwright.dev/docs/test-projects)
- Playwright 将 fast/slow 等分类写成 test tag，并通过 `--grep` / `--grep-invert` 选择。[Playwright：Tag tests](https://playwright.dev/docs/test-annotations#tag-tests)
- Playwright 官方也展示了 `smoke.spec.ts` 配合 project `testMatch` 的做法。这是描述性 stem + project 选择，不是要求所有能力形成新的终止后缀。[Playwright：Splitting tests into projects](https://playwright.dev/docs/test-projects#splitting-tests-into-projects)

### 本仓与公开样本证据

- 本仓默认测试脚本以精确 glob 收录 `*.test.ts`，集成入口由独立发现器执行，见 [`package.json`](../../package.json) 与 [`scripts/run-itests.ts`](../../scripts/run-itests.ts)。
- `discoverItestFiles()` 以 `endsWith(".ittest.ts")` 收录普通集成测试，再以完整 `endsWith(".token.ittest.ts")` 排除 token 文件；位置不承担安全语义。对应契约测试见 [`scripts/tests/run-itests.test.ts`](../../scripts/tests/run-itests.test.ts)。
- 当前规范已把合成 PTY/headless 归入 `.test.ts`，把真实宿主 + fake 归入 `.ittest.ts`；因此 PTY/headless 本身不构成层级。见 [`docs/spec/testing.md`](../spec/testing.md)。
- 早期来源实现的普通 `*.ittest.ts` glob 会吞掉同目录下的 `*.token.ittest.ts`，因此只能用 `tests/token/` 物理隔离。x-agent-suite 使用完整后缀负过滤后，可以平铺观察而不继承这一目录限制。
- Kimi Code 的真实 LLM 冒烟文件名为 [`real-llm-smoke.e2e.test.ts`](https://github.com/MoonshotAI/kimi-code/blob/0999454bdcb5ddd98f39bffee434dcf0a810f394/apps/kimi-code/test/e2e/real-llm-smoke.e2e.test.ts)，通过 [`apps/kimi-code/package.json`](https://github.com/MoonshotAI/kimi-code/blob/0999454bdcb5ddd98f39bffee434dcf0a810f394/apps/kimi-code/package.json) 中精确的 `e2e:real` 脚本和 env gate 运行。它说明 `smoke/e2e` 可以作为描述性 stem，真正的防误跑仍由精确入口和闸门负责。
- 2026-08-28 对一组公开仓库样本的只读扫描得到约 1630 个 `.test`、11 个非 token `.ittest`、8 个 `.token.ittest` 文件。这个数字只是一手样本，不代表生态统计；它说明继续增加终止后缀也缺乏既有规模依据。

## 各候选标签是否应进入终止后缀

| 候选             | 实际维度              | 是否决定默认执行车道                                       | 建议                                                      |
| ---------------- | --------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| `pty`            | 交互/传输机制         | 否；合成 PTY 是 unit，真实宿主 PTY 是 itest                | 只放 stem、标题、catalog                                  |
| `headless`       | 宿主运行形态          | 否；fake profile 与真实宿主分属不同层                      | 只放 stem、标题、catalog                                  |
| `sandbox`        | 隔离机制              | 否；unit 与 itest 都可使用                                 | 只放 stem、标题                                           |
| `smoke`          | 用例集合大小/抽样策略 | 否；三条车道都可能有 smoke                                 | 只放 stem、标题或显式脚本                                 |
| `contract`       | 验证目的              | 否；纯 schema contract 与真实 provider contract 风险不同   | 只放 stem、标题                                           |
| `live`           | 环境描述，语义易歧义  | 否；live guard 可以零网络，真实 live provider 则属于 token | 禁止作为安全后缀；真实 provider 一律用 `.token.ittest.ts` |
| `e2e`            | 路径覆盖范围          | 否；fake 全链路和真实宿主全链路代价不同                    | 只放 stem/目录/文档                                       |
| `slow` / `flaky` | 速度与稳定性          | 否                                                         | 未来用 tag；当前用标题、skip 条件或精确脚本               |
| OS/provider      | 适用条件              | 否                                                         | profile、条件 skip、matrix/catalog                        |

## 为什么继续细化会变差

### 1. 组合爆炸

PTY、headless、smoke、contract、live 五个二值标签已经有最多 32 种组合；再叠加 layer、provider、OS、serial/parallel，文件名无法维持一个人人都能记住的正交语法。

例如：

```text
send.pty.smoke.contract.token.ittest.ts
send.contract.pty.token.smoke.ittest.ts
```

两者语义看似相同，但第二个已经破坏当前 `endsWith(".token.ittest.ts")` 的安全判断。若强制全局排序，又会把每次增加标签变成 runner、lint、文档和全部文件名的联合迁移。

### 2. 默认发现容易误跑

`*.ittest.ts` 会匹配 `*.token.ittest.ts`。早期来源实现曾因此需要目录隔离。x-agent-suite 当前的完整后缀负过滤能解决问题，但前提是 `.token.ittest.ts` 始终作为不可拆开的规范结尾；在它中间继续插入 `smoke`、`live`、provider 等词会削弱这个机械边界。

### 3. 打平观察反而更难

三种固定结尾可直接用 `rg --files`、排序和 `endsWith()` 打平审计。能力词放在 stem 仍然可见、可搜索；把每个能力升级为保留后缀只会让同一风险车道产生许多外观不同的“亚种”，增加漏搜和误判。

### 4. 标签不是安全边界

Node 的 name pattern 不改变文件集合，Vitest 也明确说明 tag/name filter 仍需加载文件。会读凭据或发真实请求的模块不能依赖加载后的 skip/tag 才阻止执行；`*.token.ittest.ts` + 文件级排除 + 测试内授权闸门是分层防御，三者职责不同。

## 推荐落地规则

1. 保持三个现有结尾，不做批量改名。
2. 将文档里的“三层测试”校准为“两个默认层级 + token 风险车道”；行为不变。
3. runner 永远先按文件路径形成集合，再导入模块；默认集合必须完整排除 `*.token.ittest.ts`。
4. token 入口继续精确指向单文件或明确 allowlist，不提供会无意扩大范围的宽泛 glob。
5. PTY/headless/smoke/contract 等写进 stem 时使用普通描述词，不赋予新的全仓执行语义。
6. 教程 catalog/支持矩阵承担能力组合查询；文件名只回答“这是什么用例”和“走哪条执行车道”。
7. 在最低 Node 提高到原生 tags 可用版本且该能力脱离 Early development 后，可评估用 tag 做横切筛选；不因此取消 token 文件级隔离。

只有同时满足以下条件，才应讨论第四种保留后缀：

- 出现与现有三条车道不同的真实副作用或授权模型；
- 必须在模块导入前隔离；
- 需要独立默认/显式命令和 CI 权限；
- 无法由现有 `.token.ittest.ts`、精确 allowlist、sandbox 或条件 skip 清晰表达；
- runner、规范、契约测试能在同一次变更中机械强制。

PTY、headless、smoke、contract、live 均不满足这些条件。

## 迁移影响

### 采纳本建议

- 文件改名：0。
- runner 行为：0。
- 默认命令：0。
- 推荐后续文档调整：把“三层”改为“两层 + 风险修饰”，并补充“能力词只属于 stem/catalog”的说明。
- 可选守卫：静态检查只接受三个规范结尾，并验证 token 完整后缀始终被默认 runner 排除。

### 若继续新增后缀

至少需要同步修改：默认 glob、负过滤、显式脚本、类型检查 include、教程 catalog、支持矩阵、AGENTS 规则、测试分层规范和所有命名契约测试。旧文件还会面临批量改名与历史链接失效；每增加一个正交标签，组合和漏收风险继续上升。

因此，除非出现新的“模块导入前必须隔离”的执行风险，否则新增终止后缀的迁移成本大于收益。
