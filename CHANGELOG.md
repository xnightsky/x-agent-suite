# 变更记录

本文件记录影响消费者接口、行为、安装、配置、协议或报告格式的变化。版本遵循 [Semantic Versioning 2.0.0](https://semver.org/)；源码 workspace 的 `0.0.0` 是不可发布占位值，制品版本由 Git history 与稳定 tag 管理。历史章节与本仓稳定 tag 一一对应，不记录未发布的版本号。

## Unreleased

### Added

- live 私密配置区新增 home 级发现位 `~/.env.e2e.yaml`：位于 repo 级与历史路径 `~/.config/x-agent-suite/` 之间，跨仓库共享；`LiveConfigSource` 新增 `"home-dot"` 成员（对穷举该联合类型的消费方属 additive 类型变更）。
- 文档化 live 渠道解析完整优先级链：env 字段覆盖 > `E2E_LIVE_CONFIG_PATH` 显式文件 > repo `.env.e2e.yaml` > `~/.env.e2e.yaml` > 历史 home 路径 > 声明内 `from: harness` 借用宿主默认渠道 > 代码显式 `LiveBackend` channel，见 `docs/spec/llm-fixture.md`。

### Fixed

- 宿主 E 渠道借用支持内置 provider 兜底：settings 默认 provider 不落盘用户 models 配置时（宿主内置注册表渠道），由 harness 包内置注册表快照解析 baseUrl/wire（按 `BOUNDARY-DEBT(harness)` 模式标注）；裸 `from: harness` 声明因此可解析出宿主默认渠道，消费者无需再自写解析器。用户 models 配置中的同名条目恒优先于快照。

## 0.1.1 - 2026-09-04

### Fixed

- 消除跨制品 `LiveBackend` 类身份依赖：`LlmBackend` 契约新增 `liveChannel` 品牌字段（`start()` 后可读），harness live 分支改为结构化判定。修复 pty-driver 制品把 `LiveBackend` 内联进 bundle 后，消费者从核心包创建的实例在 `instanceof` 检查中恒为 false、live 分支（`liveEnv` / `ctx.live`）静默失效的问题。PTY 制品新增构建期完整性守卫（禁止内联 `LiveBackend`）与跨制品行为冒烟。

## 0.1.0 - 2026-09-04

### Added

- 首个公开发布：通用 Agent 测试套件框架，核心聚合包 `x-agent-suite` 承载 contracts / driver / sandbox / llm-fixture / harness / observation / matrix 七个子路径，PTY 能力由独立制品 `@x-agent-suite/pty-driver` 分发；统一入口 `artifacts:pack` 从 Git history 推导 lockstep 版本、构建 tarball、生成清单与校验和，并执行仓库外安装冒烟。
