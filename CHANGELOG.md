# 变更记录

本文件记录影响消费者接口、行为、安装、配置、协议或报告格式的变化。版本遵循 [Semantic Versioning 2.0.0](https://semver.org/)；源码 workspace 的 `0.0.0` 是不可发布占位值，制品版本由 Git history 与稳定 tag 管理。

## Unreleased

## 0.2.0 - 2026-08-28

### Added

- 制品 manifest 记录上一稳定 tag 与参与自动划版的 Conventional Commit 标题，便于兄弟仓审计版本来源。

## 0.1.0 - 2026-08-28

### Added

- 确立本地 tarball、远程 GET 与未来 package registry 共用同一制品的分发方向。
- 确立全仓 lockstep versioning、根级 changelog 与版本制品不可覆盖规则。
- 记录兄弟仓库针对本地、远程与 registry 制品的 `package.json` 依赖配置。
- 区分开发态本地源码目录引用与三种版本化交付来源。
- 补全统一打包命令契约、固定版本打包和本地 tarball 消费之间的交接链路。
- 规定稳定版绑定 release commit，开发 HEAD 使用包含日期与 commit 的唯一 snapshot 版本。
- 实现 `artifacts:pack`：自动划分 SemVer、构建核心与 PTY tarball、生成清单和校验和、执行仓库外消费冒烟，并在稳定构建成功后补 annotated tag。
