# @x-agent-suite/criteria

确定性判据的兼容入口。实现只有一份，位于 `@x-agent-suite/assertions`。

## 用途

- 保留既有导入路径 `@x-agent-suite/criteria`，让已注册该路径的消费者与教程无需改代码。
- 逐符号重导出 `textContains`、`textNotContains`、`toolCall` 与 `ToolCallExpect`。

## 不负责什么

- 不保留第二份断言实现；本包没有任何判定逻辑。
- 不自动注册判据、不调度、不聚合、不写报告。
- 不提供检查层原语与 AI 断言——这些都在 `@x-agent-suite/assertions`。

## 公开入口

`src/index.ts` 只做一件事：从 `@x-agent-suite/assertions` 重导出下列符号。

| 导出              | 说明                                            |
| ----------------- | ----------------------------------------------- |
| `textContains`    | 文本包含（AND 语义），metric 名 `text-contains` |
| `textNotContains` | 红线排除，metric 名 `text-not-contains`         |
| `toolCall`        | 工具调用核对，metric 名 `tool-call`             |
| `ToolCallExpect`  | `toolCall` 的 expect 形状类型                   |

## 最小示例（零 token）

两个导入路径行为完全一致：

```ts
import { textContains } from "@x-agent-suite/criteria";
// 等价于
// import { textContains } from "@x-agent-suite/assertions";

textContains.evaluate(turn, { turnIndex: 0, session, expect: ["只读"] });
```

新代码请直接依赖 `@x-agent-suite/assertions`，可同时拿到检查原语与 AI 断言。

## 依赖与边界

- 唯一依赖：`@x-agent-suite/assertions`。
- 本包不执行调度；`assertions` 不反向依赖本包。

## 包形态与分发

| 场景       | 导入路径                            | 形态                                            |
| ---------- | ----------------------------------- | ----------------------------------------------- |
| 本仓内     | `@x-agent-suite/criteria`           | workspace 私有包（`private: true`），不单独发布 |
| 仓外消费者 | `@xnightsky/x-agent-suite/criteria` | 聚合分发包 `@xnightsky/x-agent-suite` 的子路径  |

## 命令（仓库根执行）

```bash
pnpm --filter @x-agent-suite/criteria typecheck
pnpm --filter @x-agent-suite/criteria test
```

## 正式文档

- [场景评估](../../docs/spec/scenario-evaluation.md)
- [能力演进](../../docs/spec/capability-system.md)：判据子包的定位
- [打包与分发](../../docs/spec/packaging.md)
