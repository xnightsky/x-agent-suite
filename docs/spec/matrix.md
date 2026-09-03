# Matrix：同 Scenario 多宿主对照

> 借鉴评测实践的矩阵脚本：把一个场景的全部宿主变体跑成一张对照表。

## 目标

一条命令把同一个 scenario 在多个 carrier 上跑完，输出一张可横向对比的表。用于：

- 验证不同 Agent CLI 都能正确加载被测系统；
- 对比 tool call 质量、latency、cost；
- 回归测试时快速发现哪个 carrier 行为漂移。

## 用法

```bash
# 默认跑全部已注册 carrier（fixture 模式，零 token）
./node_modules/.bin/tsx scripts/matrix.ts --scenario send-greeting

# 只跑指定 carrier
./node_modules/.bin/tsx scripts/matrix.ts --scenario send-greeting --only mock,headless-a

# 只跑具备长驻通道的 carrier（入站语义场景必须用这组）
./node_modules/.bin/tsx scripts/matrix.ts --scenario inbound-event --only mock,long-lived-a

# 指定 prompts 变体（从 fixtures/prompts/<scenario>/*.md 自动发现）
./node_modules/.bin/tsx scripts/matrix.ts --scenario send-greeting --prompt concise,detailed

# live 模式（消耗真实 token）：逐 carrier 嗅探门禁，未过的标 skip
E2E_LLM_MODE=live ./node_modules/.bin/tsx scripts/matrix.ts --scenario send-greeting --only headless-a
```

## Scenario 变体发现

每个 scenario 的 prompts 放在：

```text
fixtures/prompts/<scenario-id>/
├── concise.md
├── detailed.md
└── with-context.md
```

Matrix 脚本自动读取 `.md` 文件，文件名即变体名。不加 `--prompt` 时跑全部变体。

## 输出格式

### 终端表

```text
变体          carrier        正确  调用工具  入站  exhausted  calls  耗时(s)  cost($)  备注
concise       mock           ✓     ✓         ✓     —          2      0.1     —        —
concise       headless-a     ✓     ✓         n/a   —          3      1.2     —        —
concise       long-lived-a   ✓     ✓         ✓     —          2      0.9     —        —
```

carrier 不可用、运行失败或 `driver.close()` 失败的行在对照表中标记 `skip` 并在「备注」列给出原因，进程仍 exit 0；关闭失败不得保留为成功行。

### 报告文件

`.tmp/xas-reports/<stamp>-<scenario>-report.md`：给人看的结论表。  
`.tmp/xas-reports/<stamp>-<scenario>-report.json`：每行完整 Observation、证据、stdout/stderr tail。

报告复用 `observation/report.ts` 的 `writeScenarioReports`。

## 实现要点

```ts
const scenario = loadScenario(SCENARIO_ID);
const variants = discoverPromptVariants(SCENARIO_ID);
const carriers = discoverCarriers(ONLY);

const rows = [];
for (const variant of variants) {
  for (const carrier of carriers) {
    const driver = createDriver(carrier);
    const result = await runScenario({ scenario, variant, driver });
    rows.push({ variant, carrier, ...result });
  }
}

printTable(rows);
writeReports(rows);
```

- 变体间串行（避免多个真实 CLI 抢资源）；
- 同一变体的不同 carrier 可并行（除了共享外部 state 的 live 模式）；
- fixture 模式默认并行，live 模式串行。

## runMatrix 抽象

`@x-agent-suite/matrix` 只提供通用运行器，不认识具体 scenario 或 carrier：

```ts
export interface MatrixOptions {
  variants: readonly string[];
  carriers: readonly string[];
  createDriver(carrier: string): Promise<AgentDriver>;
  runScenario(ctx: {
    variant: string;
    carrier: string;
    driver: AgentDriver;
  }): Promise<ScenarioResult>;
}

export async function runMatrix(
  options: MatrixOptions,
): Promise<ScenarioReportRow[]>;
```

## 与现有测试的关系

- `pnpm test`：默认跑内存/进程内 driver 与单个 harness preflight，CI 快速回归。
- `scripts/matrix.ts`：人工或 nightly 用，横向对比多个 carrier。

## 验收标准

- `./node_modules/.bin/tsx scripts/matrix.ts --scenario <id>` 能跑完已注册 carrier（不可用的降级 skip）。
- 入站语义场景在具备长驻通道的 carrier 上通过；不具备的标记 `n/a` 而非判红。
- 单个 carrier 的 preflight 失败降级为 skip 并记录原因，不影响其余 carrier。
- `driver.close()` 失败显式降级为 skip，场景与关闭同时失败时聚合两者原因。
- 终端输出清晰的对照表。
- 生成 `.md` + `.json` 报告到 `.tmp/xas-reports/`。
