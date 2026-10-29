# 资源安装开关与目标位置调研

> 日期：2026-10-28。范围：Skill 的发现位置、资源铺设与原生包安装的区别，以及这些事实对 `resources` DSL 的影响。本文是调研笔记，不构成已实现的契约。

设计已收敛为通用资源安装开关，正式规则以 [Recall 资源规范](../spec/recall.md#resources-字段与路径) 为准；下列验证边界仅记录调研阶段的证据范围。

## 结论

载体可以从多个目录和显式配置路径发现 Skill；它们不要求调用方提供一个叫 `base` 的字段。资源 DSL 仍须明确目标路径基准，但“单独增加 base”只是表达方案之一。`source: installed/change-report` 中的 `installed` 只是目录名，不能表示来源已经安装，也不能控制是否安装；示例应写实际存在的仓内来源路径。

上述 DSL 判断是基于下列官方事实的设计推论，不是官方推荐的统一 DSL。

## 用户约束下的设计收口

本轮选择 `resources`、`install` 和现有 `kind: directory`；destination 仅使用相对隔离工作区 cwd 的路径。移除独立 base 与 `~/` 目标提案，安装目标不进入真实 HOME、源仓库或全局目录。下文关于原生用户目录与路径语法的内容保留为调研事实，不表示本 DSL 开放这些目标。

显式 `install: false` 时不填写 destination，同时出现即配置错误；`install: true` 或省略时 destination 必填。保留既有运行时 sandbox，sandbox DSL 后续按需引入。

## Pi 官方事实

Pi 的用户资源目录基于 agent directory，默认位置是 `~/.pi/agent`，可以通过 `PI_CODING_AGENT_DIR` 或 SDK 的 `agentDir` 改变；用户 Skill 目录为 `<agent-dir>/skills/`，项目目录为 `.pi/skills/`。因此“用户位置”并不总等于一个固定 HOME 子目录。[官方 Configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md#agent-directory)

Pi 还支持 `~/.agents/skills/` 和项目 `.agents/skills/`；项目 `.agents/skills/` 会从工作目录向祖先查找，存在仓库根时在那里停止。包含 `SKILL.md` 的目录可递归发现；启动时先把名称、描述和路径加入上下文，正文按需读取。[官方 Skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md#add-it-to-pi)

Settings 的 `skills` 接受文件或目录；用户配置中的资源路径相对 agent directory，项目配置中的路径相对项目 `.pi` 目录，也支持绝对路径和 `~`。用户与项目资源列表合并加载，不能把“项目没有声明”推断成“载体没有可用 Skill”。[官方 Settings / Resources](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md#resources)

CLI 的 `--skill <path>` 可以重复，显式路径的相对基准是 cwd。`--no-skills` 关闭发现与配置的 Skill，但不关闭显式 `--skill` 路径。[官方 Command Line / Resources](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md#resources)

原生 `pi install` 管理 npm、git 或本地包声明，用户声明写入用户 settings，`--local` 写入项目 settings；本地包从解析后路径直接加载而不复制。因此原生包安装、目录复制、Skill 发现是不同动作。[官方 Pi Packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md#install-and-manage-packages)、[本地来源行为](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md#choose-a-source)

检索时旧官方仓库 `badlogic/pi-mono` 的链接重定向到 `earendil-works/pi`；本文引用重定向后的上游，不使用搜索结果中的 fork。

## 其他一手来源交叉核对

Claude Code 官方列出个人目录 `~/.claude/skills/`、项目目录 `.claude/skills/`，并支持嵌套目录、额外工作目录和插件等来源。这进一步说明“Skill 安装位置”不能简化为唯一固定目录。[官方 Skills / Choose where skills load](https://code.claude.com/docs/en/skills#choose-where-skills-load)

Claude Code 可通过 `--add-dir` 或 `/add-dir` 加载项目外目录中的 `.claude/skills/`；`permissions.additionalDirectories` 只授予文件访问权限，不会加载该目录的 Skill。这表明能访问资源与把资源纳入发现范围也不是同一行为。[官方 Skills / Load skills from a directory outside the project](https://code.claude.com/docs/en/skills#load-skills-from-a-directory-outside-the-project)

Agent Skills 规范规定以 `SKILL.md` 为入口的目录结构以及可选脚本、参考资料等内容，没有为消费者仓库规定一个名为 `installed/` 的资源来源目录。[官方 Agent Skills Specification / Directory structure](https://agentskills.io/specification#directory-structure)

## 对当前 DSL 的设计推论

| 问题                         | 推论                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| 是否必须有 base              | 不必须；必须明确的是 destination 如何解析，字段拆分形式由本框架决定。                        |
| 是否能只写 destination       | 可以；当前方案仅接受相对隔离 cwd 的路径，`~/` 映射隔离 HOME 的候选已不采用。                 |
| install 表示什么             | 若保留此布尔字段，应明确只控制本次资源铺设，不能暗示调用原生包安装器，也不是来源的安装状态。 |
| source 表示什么              | 只表示相对 rootDir 的实际来源路径；目录名不参与状态判断。                                    |
| install=false 能否证明未安装 | 只能证明该声明没有执行铺设；其他启用的发现来源也必须隔离，才能证明不可发现。                 |

使用当前考卷已有来源的概念示例：

```yaml
resources:
  - source: .pi/skills/change-report
    install: true
    destination: .pi/skills/change-report
    kind: directory
```

其中来源由操作者预先准备；`install` 是本次讨论中的提案。实际 destination 应填写载体支持的项目发现目录，并保持在隔离 cwd 内；不通过主目录简写或绝对路径指定用户或全局位置。

跳过安装时仅保留来源与开关：

```yaml
resources:
  - source: .pi/skills/change-report
    install: false
```

## 验证边界

- 已验证：上述官方文档的发现位置、路径基准、显式路径开关及包管理语义。
- 未验证：当前消费者所用 CLI 版本与上游 main 的差异；在真实宿主中发现、读取和执行 Skill 的行为。
- 迁移风险：载体的用户资源根可能通过 agent-dir 或环境变量重定位，实际 destination 必须与所选 Profile 一致；把所有用户级目录机械改写为 HOME 下固定位置可能导致资源无法发现。
- 本次仅记录资料与设计推论，未修改生产代码或源码注释，未运行测试或真实模型调用。
