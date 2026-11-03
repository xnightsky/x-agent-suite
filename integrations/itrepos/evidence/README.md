# 访问痕迹证据场景仓

这个场景仓维护 `assertions/evidence` 的真实 Recall 用法，不要求安装 Skill 或额外项目规则。基线与变量能力分开验证，新增变量形态不会替换原字面量回归。

## 基线场景：`.recall.yaml`

- `read-and-cite`：原样保留字面量检索、研究入口与附件实读、正文片段及最终引用。
- `no-target-access`：要求无关任务不读取目标资源，最终回答提及路径本身不会构成访问证据。

## 变量场景：`variables/.recall.yaml`

- `layered-contains`：分别证明文档未覆盖项保留、plan > document、case > plan 和整值字符串数组引用；低层错误哨兵不出现在目标正文中。
- `embedded-escaped-and-turn-index`：单轮覆盖多变量嵌入、有限数与布尔拼接、转义、其他反斜杠保留、变量值不递归、scenario/case/plan 逻辑身份及 turn.index=0；turn.index=1 与跨轮/repeat 隔离由零 token Runner 测试覆盖，不扩展真实 Driver 多轮协议。

资源只复制到每次隔离 cwd；判据根据当前轮 Observation 中的工具访问痕迹判定，不读取源文件补证据。

## 零 token 配置与 fake 验证

在仓库根目录运行：

```bash
pnpm exec tsx --test scripts/tests/itrepos-evidence-config.test.ts scripts/tests/itrepos-evidence-variables-config.test.ts
```

命令编译实际考卷，核对基线字面量、变量声明形态、资源与权限，并经真实消费者判据工厂和独立 fake 观察验证优先级、类型、逻辑身份及当前轮索引，不启动真实宿主或模型。

## 真实 token 验证

需要可用的 live 配置、Pi CLI 和显式授权。基线与变量入口分别执行：

```bash
pnpm ittest:token:evidence --carrier pi --provider co --model default/deepseek-v4-flash --approve-live
pnpm ittest:token:evidence-variables --carrier pi --provider co --model default/deepseek-v4-flash --approve-live
```

命令通过 `use:evidence-readonly` 开放 `read,grep,find,ls`，最多八步、每轮一百二十秒，不开放 shell 或写工具。真实调用会消耗 token，不进入 `pnpm test`、`pnpm ittest` 或 `pnpm check`。

CLI 的 PASS/FAIL 和 JSON 报告中的 `hardPass` 才是行为结果；行为断言失败仍可能返回退出码 0，基础设施错误与内容失败必须分开检查。真实 grep 在 `path: docs` 下返回 `research.md:1`，因此 search 的 `contains` 声明使用 `research.md`；实读和引用统一使用 workspace 逻辑路径。

真实 registry 通过判据工厂的 `context.variables` 注入解析器。baseline 证明字面量在注入模式下保持兼容；未配置解析器的旧行为由单元测试覆盖，不与 baseline 混同。

2026-11-02 使用 `pi/co/default/deepseek-v4-flash` 的实际 baseline live 运行中，两个 case 的 CLI 均为 PASS，`hardPass=true`、`dryPass=true`，隔离 workspace 均已清理。最终成功一轮的原生用量分别为：正向 7,701 tokens（输入 7,275、输出 426），反向 1,546 tokens（输入 1,523、输出 23）。

## 2026-11-03 baseline 与 variables 实测

使用 `pi/co/default/deepseek-v4-flash` 分别运行两个精确入口。baseline 两个 case 与 variables 两个单轮 case 均为 CLI PASS，JSON/Markdown 一致，`hardPass=true`、`dryPass=true`、`nativeCompleted=true`，所有 outcomes 均为 `pass/score=1`，隔离 workspace 均已清理。

| 场景                                      | 输入 tokens | 输出 tokens | 总 tokens |
| ----------------------------------------- | ----------: | ----------: | --------: |
| baseline/read-and-cite                    |       6,966 |         529 |     7,495 |
| baseline/no-target-access                 |       1,471 |          16 |     1,487 |
| variables/layered-contains                |       7,471 |         631 |     8,102 |
| variables/embedded-escaped-and-turn-index |       3,227 |         142 |     3,369 |

初次多轮 forms 曾被真实单轮 Driver 拒绝，未记为通过；改为单轮后已复验通过，未扩展多轮协议。`turn.index=1` 与跨轮/repeat 仍由正式零 token 测试覆盖。variables/layered 首个 grep 曾因路径越界被 guard 拒绝，随后使用正确路径完成并通过；不存在成功越界读取证据，也不将结果外推为严格工具顺序保证。报告未记录 `costUsd`，不能据此推定费用为零。
