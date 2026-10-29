# 宿主配置保真与单次运行参数

## 结论与边界

渠道选择与执行偏好分离：live config / `.env.auth.yaml` 负责 provider/model、端点和凭据；TargetTags 只描述能力与用量事实；消费者 Profile/Adapter 负责将原生配置和本次运行参数投影到隔离 HOME。

- 通用接缝仍是 `HarnessProfile.writeConfig(sandbox, context)`，不增加宿主专用契约字段。
- Recall 只将 `--execution-params <JSON对象>` 传到当前 `registry.profiles[*].createDriver` 的 `executionParams`，不解释思考强度。
- `kind: cli` 始终 borrowed，`kind: ephemeral-client` 始终通过 `clientRef` 执行自定义 direct Adapter；PTY 是 IO 机制，不是第三种 Carrier，也不会使临时真实 CLI 变成 Client。
- 不在 case YAML 或 effects Plan 中增加 driver/mode/cliRef、思考配置或模型能力；不跨路径 fallback。

## Pi 消费者投影

公开安装入口为 `@xnightsky/x-agent-suite/profiles/pi-config`，源码为根目录 `profiles/pi-config.ts`。这是独立消费者适配，不属于 `packages/*/src/`，不内建注册 Pi Driver，不复制消费者仓库脚本。

`writePiLiveConfig(sandbox, context, { agentDir?, executionParams? })`：

1. 只读 `agentDir/settings.json` 和 `agentDir/models.json`。目录默认取 `PI_CODING_AGENT_DIR`，否则为当前 HOME 下的 `.pi/agent`；测试可显式注入合成目录。缺文件视为未声明；不可读、损坏 JSON 或结构错误显式失败，不回显原文。
2. 保留宿主 `defaultThinkingLevel` 与 `thinkingBudgets`；宿主没有声明时不自行写入 `off`。只有本次 `executionParams.thinkingLevel` 显式给值才覆盖隔离 settings，允许 `off/minimal/low/medium/high/xhigh/max`；未知字段与非法值拒绝。
3. 保留已选原生 provider ID，不改成 fake provider。原生自定义 provider/model 的 `api`、`reasoning`、`contextWindow`、`maxTokens`、`compat`、`thinkingLevelMap`、`samplingParams`、`samplingParamsByThinkingLevel` 与 `modelOverrides` 保留原生结构。内建模型不伪造这些字段，继续由真实 CLI 的原生目录/套餐解析；不维护第二份模型事实表。
4. provider 端点来自已解析的 live context；存在 `harnessBaseUrl` 时使用宿主原值。模型级旧端点不复制，不能绕过已选渠道。凭据仅使用 `context.apiKey`，不读取 `auth.json`，不执行原生 `!command`，不复制原生 apiKey。带原生 `headers/oauth` 的配置显式拒绝，需消费者专用认证适配，不能默默丢失认证语义。
5. 不复制宿主的 packages/extensions、提示词、工具策略、其他账号或无关 settings。需要 reference MCP 时只注册本仓 fixture 明确使用的适配包；`injectServer:false` 时不注入。MCP server 文件仍由消费者 Profile 自己写入。
6. 只写 `sandbox.configDirs.piHome/{settings,models}.json`，新文件权限为 `0600`；目标与宿主目录相同或符号链接同址时拒绝。沙箱清理由 Driver 的 close/finally 负责；不会回写真实 HOME/settings。

### 在消费者 Profile 接线

下面的函数仅包装消费者已有的 `HarnessProfile`；不会重写 CLI 参数、权限或路由。

```ts
import type { HarnessProfile } from "@xnightsky/x-agent-suite/contracts";
import { writePiLiveConfig } from "@xnightsky/x-agent-suite/profiles/pi-config";

/** 把本次 Recall 参数交给隔离配置投影。 */
function withRunParameters(
  profile: HarnessProfile,
  executionParams: Readonly<Record<string, unknown>>,
): HarnessProfile {
  return {
    ...profile,
    writeConfig: async (sandbox, context) => {
      await writePiLiveConfig(sandbox, context, { executionParams });
      // 若消费者需要 MCP，在这里继续写自己的隔离 mcp.json。
    },
  };
}
```

registry 的 `createDriver({ backend, spec, effects, executionParams })` 用该包装后的 Profile 创建原有 PTY/JSONL Driver，并继续兑现 effects、provision 和清理约束。独立 Client Adapter 则校验自己支持的参数，直接交给自己的 SDK/临时 Client；不为读取渠道而无故调用 Pi 投影。

```sh
x-agent-suite recall --carrier pi --live-config private-live.yaml \
  --registry ./registry.ts --execution-params '{"thinkingLevel":"high"}' \
  .recall/rules.yaml
```

省略 `--execution-params` 或传 `{}` 均继承宿主；显式覆盖只对当前 case/repeat 的隔离配置生效。参数不记录为原始报告字段，也不得承载凭据；secret 继续走 live/auth 配置及既有脱敏器。

## Pi Recall 单轮工厂

不需要自持 Driver 时，可显式注册根 `profiles/pi-recall.ts` 的工厂；它仍复用 Harness 与 `writePiLiveConfig`，不在核心包识别宿主，不改变 TargetTags 或 live 审批。

```ts
import { createPiRecallDriver } from "@xnightsky/x-agent-suite/profiles/pi-recall";

const profiles = {
  pi: { carrier: "pi", createDriver: createPiRecallDriver },
};
```

- 只支持单轮，创建时拒绝多轮；`executionParams` 只支持 `thinkingLevel`，默认继承原生配置。
- `contextFiles` 与 `skills` 是受信任 Profile 选项，均默认 `off`；显式 `project` 后分别启用隔离工作区的 AGENTS/CLAUDE 与 Skill 原生发现，不把正文拼进追加系统提示词。场景资源仍只来自 `spec.provision`，不复制真实 HOME 的规则或 Skill；扩展发现、MCP 与提示模板保持关闭。Skill 正文由模型通过显式只读工具权限读取。
- `appendSystemPrompt` 只接受受信任调用方显式提供的字符串，不自动读取消费者提示词；`commandOverride` 仅为零 token 测试注入。
- `tools: none` 禁用工具；`read-only` 使用固定的 `read,grep,find,ls`。只有 `tools: allowlist` 且显式配置 `commands.allow` 时才增加 `bash`，命令限定为工作区内 `.mjs` 的 Node 调用；拒绝 shell 组合、变量展开和其他解释器。命令按完整字符串精确匹配，deny 优先，路径表示变化不会自动放行。
- guard 按 realpath 检查已有路径与新输出的最近实体祖先，保留完成、错误、usage 和预算证据；只向子进程投影环境白名单，不复制真实 HOME 或认证状态。此限制约束工具入口，不限制受信任脚本内部的一切系统调用。
- `evidence` 是受信任 Profile 的具名工作区相对路径表；在 `sendPrompt` 返回前读取文件并保存到 `Observation.metadata.fileEvidence`，随后由 Runner 评分和清理。缺失记为 `exists:false`，其他读取错误显式失败；拒绝路径逃逸、任一段符号链接及超过 64 KiB 的文件。该机制不是通用 Runner 的自动文件收集器。
- 渠道兼容快照的 Kimi 条目已按本机 Pi 1.4.0 原生目录更新为 OpenAI Completions，保留 `/coding/v1` 路径；旧 Anthropic 快照投影到新宿主会丢失版本路径并返回 404。该快照仍是已标记的边界债务，不保证其他版本或 provider 全部一致。
- 这不是 OS 级沙箱。默认回归覆盖 fake CLI 和实际加载的 guard handler；Cedar 的显式 token 场景验证真实模型读取 Skill、执行许可脚本及文件产物。跨版本行为尚未验收，不宣称完成安全隔离认证。

## 安全与验证边界

- borrowed 测试暂不按计费类型筛选，不需要冒充 subscription；live unknown/disallowed 仍拒绝，review-required 仍需本次批准。
- fixture 才允许用 fake 模型的 `reasoning:false` 与 `defaultThinkingLevel:off`。live 分支必须独立于这套 fixture 默认值。
- 合成原生配置测试覆盖默认继承、配套映射、显式覆盖、源文件不变、坏配置拒绝；源码入口与外部安装入口均验证。
- 外部安装冒烟同时验证公共 TargetTags YAML、独立 CLI live 拒绝门禁和 Pi 隔离 settings 的继承证据，不启动真实 provider，不产生 token。
- 尚不保证扩展动态注册、原生认证 headers/OAuth、远程目录缓存或多版本 CLI 的完全等价；需要这些能力时由对应消费者 Profile 明确实现，不能靠投影辅助函数声称已完成真实宿主验收。
