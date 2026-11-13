---
title: Recall 组合断言与计分示例
type: guide
status: active
tags: [recall, composition, scoring, examples, token]
---

# Recall 组合断言与计分示例

本目录是两个独立合成 case 的可运行考卷，从实际 [.recall.yaml](./.recall.yaml) 经 Recall 公开装载、Runner、Judge、组合计分与报告。它覆盖 allOf 求和、anyOf 通过项取最高/共同 miss、firstOf 首个正贡献、hit=0 继续、内部叶子计分、并列普通断言与 repeat/suite 汇总，不是 Judge 语义准确率基准。

## 默认零 token 回归

从仓库根执行：

```sh
pnpm exec tsx --test scripts/tests/recall-composition-config.test.ts
```

该测试读取真实 YAML，使用本目录 [fake.registry.ts](./fake.registry.ts)，经官方 CLI 以 `repeat=2` 运行两个 case。主输出和 Judge JSON 为确定性夹具；装载、装配、判据调度、组合求值、报告和 sandbox 生命周期均为真实接线。测试逐项核对 accepted、原始 false、唯一贡献、rawScore、hardPass、调用次数、汇总和 36 个 sandbox 的清理，不启动真实宿主或 provider，也不访问网络。

## 预期报告

两个 case 共用同一组 turn 断言：普通 `text-contains`、allOf.required、anyOf.acceptable、firstOf.zero 与 firstOf.leaves。每个组合只发布一个顶层有效贡献，内部原始结果保留在 `artifact.compositions`；`artifact.assertions` 共五项，`artifact.outcomes[].score` 仍是 0..1 标准分。

| case          | 普通 |                           allOf |               anyOf | firstOf.zero | firstOf.leaves | rawScore | hardPass |
| ------------- | ---: | ------------------------------: | ------------------: | -----------: | -------------: | -------: | -------- |
| combined-pass |   +1 |                              +5 |         detailed +3 | downgrade +1 |   downgrade +2 |       12 | true     |
| expected-fail |   +1 | +2（第二项 raw false / miss=0） | null / 共同 miss -2 | downgrade +1 |   downgrade +2 |        4 | false    |

`combined-pass` 的 zero 标准档 raw pass=true、hit=0，因此继续降级；leaves 标准档包含一个 true/+1 与一个 false/-1，实际贡献为 0，同样继续。`expected-fail` 是预期内容 FAIL，不是执行 ERROR，CLI 内容失败语义仍为退出 0，不能只看退出码。

每个 case 的 `scoreSummary` 均为 planned=2、valid=2、invalid=0、skipped=0、coverage=1、invalidRate=0；passRate 分别为 1/0，rawScore mean/min/max 分别为 12/12/12 与 4/4/4，passAtK 分别为 true/false，passAllK 分别为 true/false。

suite 以 target×case 宏平均：planned=2、valid=2、invalid=0、skipped=0、coverage=1、invalidRate=0、passRate=0.5、rawScore=8、pass@k=0.5、pass^k=0.5。ERROR 时不得为错误 repeat 发布正常 hardPass/rawScore；错误与跳过统计由零 token 包级回归另行覆盖。

## 真实 token：未获授权，待验收

精确入口不内置渠道、registry、live 批准或输出目录，不进入 `pnpm test`、`pnpm ittest` 或 `pnpm check`：

```sh
pnpm ittest:token:recall-composition-scoring \
  --registry integrations/pi.registry.ts \
  --carrier <已批准-carrier> --provider <已批准-provider> --model <已批准-model> \
  --approve-live --repeat 2 --out-dir .tmp/recall-composition-live -vv
```

- 执行前必须另行取得唯一 target、合成文本数据出站范围、36 次逻辑调用上限与费用授权。repeat=2 的预期路径为 4 次主 send + 32 次 Judge；所有 Judge `maxRetries=0`、超时 60 秒，不自动追加复跑或切换模型。
- 无工具、provision 或真实业务文件；宿主/provider 内部 HTTP 请求、重试、usage 与账单须按现场证据另行核验，不把逻辑 Driver attempt 等同于计费请求。
- 必须逐项核对真实主输出、Judge 原始裁定、分支调用、accepted、唯一贡献、上述报告预期、原生 usage 和清理。模型回答或裁定偏离时应记录未通过原因，不改考卷或期望求绿。
- **当前未执行真实 token，状态为“实现完成，真实验收待完成”。** fake 与配置回归不能替代该证据；一次未来验收也不证明其他 target、Judge 普遍准确性或模型稳定性。
