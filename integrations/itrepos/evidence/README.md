# 访问痕迹证据场景仓

这个最小场景仓维护 `assertions/evidence` 的真实 Recall 用法，不要求安装 Skill 或额外项目规则。

- `read-and-cite`：要求检索、研究入口与附件的成功非空实读、指定正文片段及最终引用同时成立。
- `no-target-access`：要求无关任务不读取目标资源，最终回答提及路径本身不会构成访问证据。

资源只复制到每次隔离 cwd；判据根据当前轮 Observation 中的工具访问痕迹判定，不读取源文件补证据。

## 零 token 配置验证

在仓库根目录运行：

```bash
pnpm exec tsx --test scripts/tests/itrepos-evidence-config.test.ts
```

该命令只编译实际考卷并核对资源、判据与权限声明，不启动宿主或模型。

## 真实 token 验证

需要可用的 live 配置、Pi CLI 和显式授权。在仓库根目录运行：

```bash
pnpm ittest:token:evidence --carrier pi --provider co --model default/deepseek-v4-flash --approve-live
```

命令通过 `use:evidence-readonly` 开放 `read,grep,find,ls`，最多八步、每轮一百二十秒，不开放 shell 或写工具。真实调用会消耗 token，不进入 `pnpm test`、`pnpm ittest` 或 `pnpm check`。

CLI 的 PASS/FAIL 和 JSON 报告中的 `hardPass` 才是行为结果；行为断言失败仍可能返回退出码 0，基础设施错误与内容失败必须分开检查。

真实 grep 在 `path: docs` 下返回 `research.md:1`，因此 search 的 `contains` 声明使用 `research.md`；实读和引用仍统一使用 workspace 逻辑路径 `docs/research.md`。

2026-11-02 使用 `pi/co/default/deepseek-v4-flash` 的实际 live 运行中，两个 case 的 CLI 均为 PASS，`hardPass=true`、`dryPass=true`，隔离 workspace 均已清理。最终成功一轮的原生用量分别为：正向 7,701 tokens（输入 7,275、输出 426），反向 1,546 tokens（输入 1,523、输出 23）。
