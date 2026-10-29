# Cedar

可复用的场景测试仓，用于打磨项目全局提示词，后续也可承载其他测试素材。

`.recall.yaml` 验证全局提示词，`skills-def/<name>/.recall.yaml` 验证对应 Skill。

## 准备 Skill 安装态

安装由当前负责验证的 AI 在本仓完成，Recall 不执行安装。
在本目录使用 `skills` CLI 安装本地 Skill 定义：

```bash
npx --yes skills add ./skills-def/change-summary --agent pi --yes
```

当前安装器将 Pi 的安装内容写入 `.agents/skills/change-summary/`，并生成 `skills-lock.json`。
显式指定定义目录，可避免再次安装时把已有安装产物当成源定义。
为保持本仓的 Pi 软链入口，首次安装后创建：

```bash
mkdir -p .pi/skills
ln -s ../../.agents/skills/change-summary .pi/skills/change-summary
readlink .pi/skills/change-summary
test -f .pi/skills/change-summary/SKILL.md
```

重复验证时，先核对现有链接指向 `../../.agents/skills/change-summary`；正确则复用，
遇到实体目录、断链或不同目标时先处理原因，不覆盖已有内容。
修改 Skill 定义后重新执行安装命令，再确认安装内容与源定义一致。
`.gitignore` 忽略 `.pi/`、`.agents/skills/` 和 `skills-lock.json`，版本库只维护 Skill 源定义与考卷。
以上准备步骤由 AI 按本仓引导完成，不需要初始化脚本。

## 执行真实验证

使用已安装 CLI，在本目录运行：

```bash
x-agent-suite recall skills-def/change-summary/.recall.yaml \
  --carrier pi --registry ../../pi.registry.ts \
  --plan use:skill-readonly --approve-live
```

源码仓将 `x-agent-suite` 替换为 `pnpm exec tsx ../../../packaging/cli.ts`；
也可在仓库根目录执行 `pnpm ittest:token:cedar-skill --carrier pi --approve-live`。
`--carrier pi` 使用私密 live 配置中的默认渠道；需要固定目标时追加
`--provider kimi-coding --model kimi-for-coding`。这些命令会真实消耗 token。

`--plan use:skill-readonly` 显式选择 registry 中的只读权限，最多四步、六十秒，不开放 shell 或写工具。
该 Profile 使用 Pi 已声明的工具 allowlist 能力，将工具集固定为 `read,grep,find,ls`，由守卫约束工作区路径。
不提供渠道或缺少需审批目标的 `--approve-live` 时，执行前拒绝。

考卷验证自然任务触发、无关任务不触发，以及未安装时不出现 Skill 专属行为。
`skill-loaded` 只配置 Skill 名称（如 `name: change-summary`）：原生 `read` 成功读取同名目录下的 `SKILL.md` 即算加载，源目录与安装目录都接受；当前按名字唯一处理，原始路径保留在工具事件中供诊断。
发布说明场景还要求正文行为标记，不采信模型自述。
任务不会显式点名 Skill，也不会直接要求读取文件。

本仓保留软链安装；Recall 通过这个安装入口解析正文，将内容复制进每次独立的隔离工作区。
隔离现场只包含 AGENTS 与已安装的 SKILL.md，不包含源考卷或预期答案，结束后自动清理。
本轮验证安装内容的发现与触发，不验证 Pi 在原仓内直接跟随软链的行为。

现有全局提示词回归仍可运行：

```bash
x-agent-suite recall .recall.yaml --carrier pi --registry ../../pi.registry.ts --approve-live
```

## 带脚本 Skill：改动统计报告

安装 `change-report` 仍由当前 AI 在本目录完成：

```bash
npx --yes skills add ./skills-def/change-report --agent pi --yes
ln -s ../../.agents/skills/change-report .pi/skills/change-report
test -f .pi/skills/change-report/scripts/build-report.mjs
```

重复安装沿用上面的链接核对规则；不会由 Recall 自动安装。
安装产物的 SKILL.md 与 scripts/ 进入隔离现场，考卷不进入；输入素材只读，输出目录初始不存在。

```bash
x-agent-suite recall skills-def/change-report/.recall.yaml \
  --carrier pi --registry ../../pi.registry.ts \
  --plan use:skill-script --approve-live
```

源码仓仍可替换 CLI 前缀，或从根目录运行 `pnpm ittest:token:cedar-script --carrier pi --approve-live`。
该权限只放行指定 Node 脚本命令，六步、六十秒；不开放其他写工具或任意 shell 组合。
脚本只读取隔离输入，生成 `out/change-report.json`。模型回答不是文件证据：Profile 在返回观测前直接读取产物，
判据核对原生命令事件、成功/失败状态以及实际 JSON，随后清理沙箱。

考卷覆盖实际生成、无关任务、只询问方法不执行，以及非法输入明确失败且不生成产物。
命令白名单只约束入口，不等同于 OS 级沙箱；本场景脚本不访问网络。
