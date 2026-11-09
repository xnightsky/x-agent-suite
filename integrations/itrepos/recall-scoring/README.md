---
title: Recall 断言计分示例
type: guide
status: active
tags: [recall, scoring, examples, token]
---

# Recall 断言计分示例

这个独立、无业务文件的场景仓演示可选 `score`、机械/AI 混合计分和报告。两份考卷独立运行，不把完整机械配置矩阵塞进最小 token 验证；它们都不是 Judge 准确率基准。

| 考卷                                                 | 用途                                     | case 数 | repeat=1 成功路径调用预算 |
| ---------------------------------------------------- | ---------------------------------------- | ------- | ------------------------- |
| [mechanical/.recall.yaml](./mechanical/.recall.yaml) | 六种机械配置各自命中/未命中              | 12      | 12 次主执行，无 Judge     |
| [.recall.yaml](./.recall.yaml)                       | 机械/AI 混合、逐轮/最终归因、正分仍 FAIL | 2       | 2 次主执行 + 3 次 Judge   |

## 先读懂输入与分值

`answer-contract` 是本仓 [`pi.registry.ts`](../../pi.registry.ts) 注册的消费者 session 判据，真实检查最终文本是否以 `requiredPrefix` 开头，**不是框架内建判据**。它显式提供 `assertionScore`，因此支持可选的 `score`；其他插件只有同样 opt-in 后才可以配置自定义贡献，历史数组输入如 `text-contains: [TOKEN_SCORE_OK]` 不必改写。

| 字段                     | 含义与默认值                                                          |
| ------------------------ | --------------------------------------------------------------------- |
| `expect.answer-contract` | 在 case 根 `expect` 中声明最终回答检查，不是某一轮的 `turn.expect`    |
| `requiredPrefix`         | 必填的非空字符串；缺少前缀就是该机械断言 false                        |
| `score`                  | 可省略；省略或 `{}` 都使用 `{ hit: 1, miss: -1 }`                     |
| `score.hit`              | boolean 为 true 时的贡献；省略时独立默认 1                            |
| `score.miss`             | boolean 为 false 时的贡献；省略时独立默认 -1；显式 0 也不代表断言通过 |

`hit/miss` 是有限 number，可为正、负、零或小数；不允许字符串、NaN/Infinity 或额外计分字段。规则只有 `pass ? hit : miss`，不设置权重、阈值或按总分放行。完整输入与 resolver 错误边界见 [计分规格](../../../docs/spec/recall-scoring.md)。

下面是一条完整 case 的输入层级；复制进含 `version/id/cases` 的文件即可，完整文件见机械考卷。

```yaml
- id: both-hit
  timeoutMs: 60000
  turns:
    - send: 只输出 TOKEN_SCORE_OK，不要引号、解释或其他内容。
  expect:
    answer-contract:
      requiredPrefix: TOKEN_SCORE_OK
      score: { hit: 2, miss: 0 }
```

## 六种机械配置：命中与未命中

机械考卷每种配置各有 `*-hit` 和 `*-miss` 两个 case。主任务始终要求输出 `TOKEN_SCORE_OK`；命中 case 要求相同前缀，未命中 case 则要求不存在的 `TOKEN_SCORE_MISSING`。这是真实文本检查，不是把期望的 boolean 写进判据。

| case 前缀   | `score` 配置           | `*-hit` rawScore / hardPass | `*-miss` rawScore / hardPass |
| ----------- | ---------------------- | --------------------------- | ---------------------------- |
| `omitted`   | 不写                   | 1 / true                    | -1 / false                   |
| `empty`     | `{}`                   | 1 / true                    | -1 / false                   |
| `hit-only`  | `{ hit: 3 }`           | 3 / true                    | -1 / false                   |
| `miss-only` | `{ miss: 0 }`          | 1 / true                    | 0 / false                    |
| `both`      | `{ hit: 2, miss: 0 }`  | 2 / true                    | 0 / false                    |
| `penalty`   | `{ hit: 0, miss: -1 }` | 0 / true                    | -1 / false                   |

上表假定模型严格输出该标记；真实回答不同就按实际文本判定。尤其 `penalty-hit` 得 0 分仍 PASS，`miss-only-miss` 和 `both-miss` 得 0 分仍 FAIL；各 case 的分数不合并成一次总分，repeat 也分别记录。

先在仓库根目录做零 token 验证：

```sh
pnpm exec tsx --test scripts/tests/itrepos-scoring-config.test.ts scripts/tests/recall-scoring-token-config.test.ts
```

该回归读取并编译实际 YAML，复用 `pi.registry.ts` 的真实判据，经官方 CLI、合成渠道和 fake transport 产生 12 份报告，核对标准分、贡献、rawScore、hardPass 与无 Judge 请求，临时测试工作区在结束后删除；不启动真实 Pi 或调用 provider。它验证配置与计分，不能替代真实模型行为验证。

需要跑机械矩阵的真实模型时，须另行批准并显式运行下列精确入口；**这会额外产生约 12 次主执行调用**，不是下方已实测的两 case 考卷：

```sh
pnpm ittest:token:recall-scoring-mechanical \
  --registry integrations/pi.registry.ts \
  --carrier pi --provider <已批准-provider> --model <已批准-model> \
  --approve-live --repeat 1 --out-dir .tmp/recall-scoring-mechanical -vv
```

每条 case 超时 60 秒、无 Judge、无工具和 provision；宿主/provider 的内部重试与计费以实际证据为准。机械矩阵的单次真实验收结果单独记录如下，不与后面的混合考卷实测混同。

### 机械考卷实测：2026-11-09

本次经用户单次明确批准，使用 `pi / co / default/glm5-3-flash`，`repeat=1`。上述精确入口另加临时追踪注册表，复用真实 `createPiRecallDriver`，不替换 transport、模型输出或机械判定，并将 Driver 创建和 send 各限制为 12 次、禁止 Judge。

- 实际 12 次主调用、0 次 Judge，12 次原生完成信号均为 true，主输出均为 `TOKEN_SCORE_OK`，零工具调用。
- 12 份 JSON 报告逐项符合上表：6 个命中 case PASS、6 个未命中 case 预期 FAIL，执行错误 0，CLI=0；不是“全部 case 都 PASS”。
- `penalty-hit` 实得 0 分且 PASS；`miss-only-miss` 与 `both-miss` 实得 0 分且 FAIL。原始标准分仍为 1/0，贡献与 rawScore 按各配置核对，未修改考卷或预期来求绿。
- 原生 usage 汇总：prompt 5389、completion 280、total 5669 tokens；12 个独立 sandbox 在 close 后均确认已删除。

本次本地证据位于 `.tmp/recall-scoring-mechanical-token-run-1/`（逐 case Markdown/JSON）、`.tmp/recall-scoring-mechanical-live-trace.jsonl`（逐调用）和 `.tmp/recall-scoring-mechanical-token-receipt.json`（严格验收回执）；`.tmp/` 不入库。未取得实际账单金额，也未独立采集 provider 内部 HTTP 重试；本结果只证明此 target 的单次合成验收，不证明其他渠道或模型稳定性。

## 机械/AI 混合考卷：安全与运行

- 产生真实 token、费用及数据出站；只发送合成标记，不 provision 文件，不开放工具。
- 渠道来自现有 `.env.e2e.yaml` 发现链；凭据仅经既有 hooks 投影到隔离 sandbox，不写入考卷或注册表。
- 必须显式选择唯一 carrier/provider/model，并获得本次 live 批准；不要只选会展开多个 default 的 carrier。
- 混合考卷固定两个 case、repeat=1、三个 Judge 批次，`maxRetries=0`；成功路径共五次逻辑模型调用。主轮与每个 Judge 均有 60 秒超时，宿主/provider 内部重试和计费以实际证据为准。
- 缺少渠道、凭据、宿主或授权时拒绝运行，不得 fallback；不进 `pnpm test`、`pnpm ittest` 或 `pnpm check`。

```sh
pnpm ittest:token:recall-scoring \
  --registry integrations/pi.registry.ts \
  --carrier pi --provider <已批准-provider> --model <已批准-model> \
  --approve-live --repeat 1 --out-dir .tmp/recall-scoring-live -vv
```

仅 `--approve-live` 不构成对任意账号/渠道的许可；操作者须确认所选账号、费用与条款。没有单次调用批准时不要运行。

## 机械/AI 混合考卷：预期结果

完整 Judge 形态使用 `expect.judge.rubrics.<name>.rubric` 声明独立 boolean 条件，使用同层 `score` 配置该项贡献，默认值与机械断言一致；模型只返回 boolean/reason，不自由报分。同一评价点的 rubric 批量裁定，配置 `timeoutMs: 60000`、`maxRetries: 0`；`turns[].expect.judge` 检查当前轮，case 根 `expect.judge` 检查最终轮，两个评价点即使同名也分别计一次。

| case                  | 贡献                        | rawScore | hardPass |
| --------------------- | --------------------------- | -------- | -------- |
| `all-pass`            | 机械 2 + marker 3 + 默认 1  | 6        | true     |
| `positive-score-fail` | 逐轮 1 + 0，最终 2 + -1 + 3 | 5        | false    |

第二个 case **预期 FAIL**：逐轮与最终同名 `missing` 各自产出 false，分别贡献 0 和 -1；其余正分不能抵消失败。两份报告的 `outcomes[].score` 仍为 0/1，`assertions[].score` 才是贡献，逐轮 Judge 名为 `turn.0.judge.missing`。没有执行/评测错误时，官方 CLI 仍退出 0，不能把退出码当成 case 全通过。

验收时必须检查两份报告的全部细项、总分、hardPass、真实 usage、无工具调用和清理；若模型没有按合成指令输出或裁定与文本矛盾，应如实记录，不修改预期分数迁就结果。一次通过不证明模型稳定性、其他渠道或全部机械插件已经验证。

## 实测记录与限制

2026-11-09，使用真实 Pi borrowed 路径，显式选择 `co / default/glm5-3-flash`。验收另加临时追踪注册表，复用 `createPiRecallDriver`，关闭上下文/Skill/工具发现，不替换 transport、模型输出或裁定；逐调用核验原生 usage、完成信号与 sandbox 清理。

首轮使用问句式 rubric：5 次调用共 3093 个原生 totalTokens，全部完成、零工具调用且 5 个 sandbox 均已清理。`all-pass` 为 6 分；最终 Judge 对不存在的标记返回 true，但理由称标记不存在，导致负例为 7 分而非预期 5 分，**严格验收未通过**。该异常来自原始模型 JSON，不是框架改写裁定或计分错误。

随后只把负例 rubric 改为明确的“包含才通过、不包含必须 false”，保留判据名、预期 boolean 与分数，不修改通用 Judge 或计分实现。复验严格检查通过：`all-pass` 为 6 分且 PASS，`positive-score-fail` 为 5 分且 FAIL，原始标准分与逐项贡献完全匹配；5 次调用共 3146 个原生 totalTokens（prompt 2847、completion 299），零工具调用且 5 个 sandbox 全部清理。

两轮累计 10 次逻辑调用、6239 个原生 totalTokens；未取得供应商实际账单金额，不估算费用。CLI 两次均为 0，但首轮严格检查失败、复验通过，不能用退出码或后续一次通过抹去首轮错误。问句、命名与批量组合对裁定的具体影响尚未分别隔离，本记录不能证明模型稳定或将该现象归因于某个单一因素。
