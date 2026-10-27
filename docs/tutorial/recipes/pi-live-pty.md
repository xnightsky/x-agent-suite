# Pi Live PTY（真实 provider/model）

把 [Pi PTY 集成](./pi-pty-integration.md) 的 fake provider 换成真实渠道：PtyAgentDriver 的 live 分支把借用渠道（baseUrl 原值 + 借用 token）写进沙盒 `models.json`，真实 Pi TUI 按声明的 provider/model 打真实端点。会产生真实 token、费用与数据出站。

源码：[`examples/tutorial/11-pi-live-pty.token.ittest.ts`](../../../examples/tutorial/11-pi-live-pty.token.ittest.ts)。唯一入口：

```bash
pnpm ittest:token:pi-pty
```

直接运行仍会 skip。测试必须同时获得：

1. `XAS_TUTORIAL_LIVE_AUTHORIZATION=I_ACCEPT_LIVE_COST_AND_DATA_EGRESS` 单次授权值；
2. 真实 home 的 `~/.env.e2e.yaml` 里 `carriers.pi` 声明；新格式用 `providers.*.models` 维护可选模型、`default` 维护默认验证目标，旧 `provider/model` 仍兼容但会产生弃用 warning；
3. 宿主 CLI（Pi）已安装且对应 provider 登录态有效（如 OAuth 未过期）。

显式运行形如：

```bash
XAS_TUTORIAL_LIVE_AUTHORIZATION=I_ACCEPT_LIVE_COST_AND_DATA_EGRESS \
pnpm ittest:token:pi-pty
```

默认执行 `carriers.pi.default`；未声明 `default` 的 `from: harness` 继承 Pi 默认 provider/model。可用 `--model` 只运行一个可选模型，模型在当前可选目录中唯一时可省略 provider：

```bash
XAS_TUTORIAL_LIVE_AUTHORIZATION=I_ACCEPT_LIVE_COST_AND_DATA_EGRESS \
pnpm ittest:token:pi-pty -- --model k3-256k
```

模型 ID 自身包含 `/` 时，也可通过完整 `provider/model` 精确选择，例如 `--model co/default/glm5-3-flash`。

## 执行链

1. runner 精确选中单个 `*.token.ittest.ts` 文件；默认 `pnpm test/itest/check` 均不会加载它。
2. 文件级测试再次检查单次授权值；缺失时连测试回调都不执行。
3. `loadLiveConfig` 读取真实 home 配置并借用渠道，`resolveLiveTargets` 解析 `--model` 或汇总 `carriers.pi.default`；未配置或借用失败显式 skip，显式模型无匹配/有歧义则失败。入口启动器将 `--model` 注入 Node 测试子进程，非法或重复参数直接失败，不回退默认集合。
4. 每个 target 创建独立 `LiveBackend` 与 PTY 子测试，显式复用同一份已解析 channel；start 时解析借用凭据（OAuth access，过期显式 missing）。
5. driver 建沙盒 HOME，`piProfile.writeConfig` 按 `live` 渠道写沙盒 `models.json`（baseUrl 取 `harnessBaseUrl` 宿主原值）与 `settings.json`；PTY 启动真实 Pi。
6. footer 出现所选模型 id 后发 "hi"，等待一轮真实回复；每个 target 关闭后即清理其沙盒 home/cwd（含借用 token 副本）。

## 它实际证明什么

1. `from: harness` + `provider` 选择器借出的渠道与凭据能驱动真实宿主完成真实对话（0.84.4 实测：footer 显示声明模型，一轮回复约 6s）。
2. PtyAgentDriver live 分支的沙盒配置注入链路（`harnessBaseUrl` 原值回写）与宿主运行时约定兼容。

## 仍然存在的风险

- 借用的是 OAuth access 快照：宿主 token 寿命短（约 1 小时），过期则显式 missing，需在宿主里重新登录/运行让其刷新；harness 不代替宿主刷新。
- 沙盒只隔离 HOME/cwd 与配置，不是 OS 级网络封锁；真实 token 会短暂写入沙盒 `models.json`，关闭即删。
- 显式闸门只代表本次运行责任人的授权，不代表第三方条款许可。
