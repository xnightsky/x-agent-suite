# @x-agent-suite/observation

Observation 层：把 driver 产出的事件归一、评分并写成报告。

## 模块

- `checks.ts` — 枚举/硬判据执行。
- `report.ts` — `writeScenarioReports(rows, options)`：一次运行同时产出 `.md` 结论表与 `.json` 明细。

## 设计纪律

- 评分只看结构化 `Observation.toolCalls[].status`，不看退出码与末条文本。
- 报告默认输出到仓库根 `.tmp/reports/`。
- `scenarioId` 经 URI 编码后作为单个文件名段，报告内容保留原始值。
- 报告中的私密信息应由调用方在传入 `ScenarioReportRow` 前完成脱敏。
