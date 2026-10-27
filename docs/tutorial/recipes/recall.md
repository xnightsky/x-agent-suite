# Recall：`.recall/` 声明式考卷

这一教程用临时目录、`MockDriver` 和文本判据跑通“自动发现 → 全量校验 → 多轮 ScenarioSpec → Markdown + JSON 报告”，零真实 token。

## 运行

```bash
pnpm tutorial:recall
```

源码：[`examples/tutorial/17-recall.test.ts`](../../../examples/tutorial/17-recall.test.ts)，运行配置：[`examples/tutorial/fixtures/tutorial-recall.config.ts`](../../../examples/tutorial/fixtures/tutorial-recall.config.ts)。示例中的临时 config 只是教程接线；消费者直接在已有 `.recall/x-agent-suite.config.ts` default 导出配置即可。

## 最小目录

```text
.recall/
├── x-agent-suite.config.ts
└── project-rules.yaml
```

运行：

```bash
x-agent-suite recall
x-agent-suite recall .recall/project-rules.yaml
x-agent-suite recall --config .recall/x-agent-suite.config.ts .recall/project-rules.yaml
x-agent-suite recall path/to/existing-directory
```

目录只读第一层 YAML，多份考卷按路径排序；缺配置或缺考卷会报错，不会显示“0 个 case 成功”。`files`、`rootDir`、报告标识和严格 Schema 的完整约定见[原生 Recall 规范](../../spec/recall.md)。

## 教程断言

`TUTORIAL_SUMMARY` 包含：

- `exitCode: 0` 与 `reports: 1`；
- `scenario: tutorial-recall/multi-turn`；
- `turns: 2`，两轮在同一个 case 会话内执行；
- `contextPath: CONTEXT.md`，源文件以只读 provision 数据交给消费者。

把教程的 `createDriver` 换成消费者工厂、`criteria` 换成注册判据即可。context 内容由消费者在 sandbox 物化；Recall 不选择模型、不读取凭证，也不直接写工作区。
