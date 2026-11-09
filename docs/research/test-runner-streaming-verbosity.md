---
title: "测试运行器流式输出与详细级别调研"
type: research
status: active
tags: [research, recall, runner, streaming, verbosity]
---

# 测试运行器流式输出与详细级别调研

## 结论

pytest、Vitest 与 Jest 都没有把“流式”限定为逐 token 或逐字符输出；它们主要流式报告**测试生命周期事件**。详细程度与内容捕获是可组合但不同的轴。Recall 应采用统一事件流和分级渲染，而不是把 Driver 原始输出直接接到终端。

## 官方行为对照

| 工具   | 默认/进度输出                                        | 详细输出                                                                                      | 内容输出与诊断                                                             | 对 Recall 的启示                                             |
| ------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| pytest | 默认以 `.`、`F` 等字符表示已完成的测试，并显示总进度 | `-v` 显示每个测试名；`-vv` 展示更完整断言差异；更高级计数被接受，但 pytest 自身当前不额外使用 | 捕获控制、live logging、traceback 深度分别配置；`-vvv` 不等同于原始 stdout | 短标志可递增；级别既影响进度粒度，也影响诊断展开程度         |
| Vitest | default reporter 显示运行中文件/测试状态及最终汇总   | verbose reporter 在每个测试完成时立即打印，错误消息也立即显示，完整错误在末尾报告             | dot/json/tap 等由 reporter 选择；silent、console intercept 是独立选项      | 默认也应有进行中反馈和汇总；详细模式应逐用例、逐阶段即时输出 |
| Jest   | 默认以测试套件为主要结果单位                         | `--verbose` 按套件层次显示单个测试结果                                                        | `--silent` 控制测试 console；`-v` 是 `--version`，不是 verbose             | 短标志不是跨工具标准，必须在 Recall 子命令内明确契约         |

## 一手来源

1. pytest 官方输出文档明确给出默认字符进度、`-v` 单测试名、`-vv` 完整 diff，以及 `-vvv/-vvvv` 当前对 pytest 自身无额外效果；同时提供 `verbosity_assertions` 与 `verbosity_test_cases` 两个细粒度轴。
   - https://docs.pytest.org/en/stable/how-to/output.html
2. pytest 官方日志文档区分捕获日志与 `log_cli` 实时日志，说明“实时看到内容”不是简单提高测试名 verbosity。
   - https://docs.pytest.org/en/stable/how-to/logging.html
3. Vitest 官方 Reporter 文档说明 default reporter 的运行中摘要、verbose reporter 的逐测试完成输出和即时错误，以及 dot/json/tap 等不同输出面。
   - https://vitest.dev/guide/reporters
4. Vitest 官方 CLI 文档把 `--reporter`、`--silent`、`--disableConsoleIntercept`、`--printConsoleTrace` 分开定义。
   - https://vitest.dev/guide/cli
5. Jest 官方 CLI 文档定义 `--verbose` 为按测试套件层次显示单个测试结果，并定义 `-v` 为版本查询。
   - https://jestjs.io/docs/cli

## 对 Recall 的设计约束

1. **事件与渲染分离。** Runner 负责 repeat、turn、判据事件；Recall 负责 target、case、报告和汇总事件；CLI 只按 verbosity 渲染。
2. **所有级别都流式。** verbosity 只改变信息密度，不能改变执行顺序、报告、判据或退出码。
3. **级别单调包含。** 高级别包含低级别信息：0=case 结果与汇总，1=case/repeat 生命周期与报告路径，2=turn/判据，3=完整脱敏诊断。
4. **结构化诊断优先。** `-vvv` 输出 prompt、Observation、DriverEvent 和错误堆栈；Observation 在每轮返回后立即输出，不虚构通用逐 token 能力。
5. **脱敏是输出前置条件。** 与报告一致，Driver redactor 必须应用于所有详细事件和错误堆栈，判据仍消费原始 Observation。
6. **交互与管道分形。** TTY 可用图标、颜色和动态状态增强可读性；管道保持纯文本行式输出，不写光标控制。stdout/stderr 分开时，不声称跨文件描述符有统一全序。
