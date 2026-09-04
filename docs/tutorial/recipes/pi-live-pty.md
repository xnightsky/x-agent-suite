# Pi Live PTY（真实 provider/model）

把 [Pi PTY 集成](./pi-pty-integration.md) 的 fake provider 换成真实渠道：PtyAgentDriver 的 live 分支把借用渠道（baseUrl 原值 + 借用 token）写进沙盒 `models.json`，真实 Pi TUI 按声明的 provider/model 打真实端点。会产生真实 token、费用与数据出站。

源码：[`examples/tutorial/11-pi-live-pty.token.ittest.ts`](../../../examples/tutorial/11-pi-live-pty.token.ittest.ts)。唯一入口：

```bash
pnpm itest:token:pi-pty
```

直接运行仍会 skip。测试必须同时获得：

1. `XAS_TUTORIAL_LIVE_AUTHORIZATION=I_ACCEPT_LIVE_COST_AND_DATA_EGRESS` 单次授权值；
2. 真实 home 的 `~/.env.e2e.yaml` 里 `carriers.pi` 声明（`from: harness` 借用宿主渠道；多 provider 宿主可用 `provider` 字段选择借用目标，此时须显式声明 `model`）；
3. 宿主 CLI（Pi）已安装且对应 provider 登录态有效（如 OAuth 未过期）。

显式运行形如：

```bash
XAS_TUTORIAL_LIVE_AUTHORIZATION=I_ACCEPT_LIVE_COST_AND_DATA_EGRESS \
pnpm itest:token:pi-pty
```

## 执行链

1. runner 精确选中单个 `*.token.ittest.ts` 文件；默认 `pnpm test/itest/check` 均不会加载它。
2. 文件级测试再次检查单次授权值；缺失时连测试回调都不执行。
3. `loadLiveConfig` 读真实 home 的 `~/.env.e2e.yaml`，经 `createHarnessLiveConfigHooks` 借用宿主渠道；`carriers.pi` 未配置或借用失败显式 skip。
4. `LiveBackend`（mode live）作为 PTY driver 的 backend：start 时解析借用凭据（OAuth access，过期显式 missing）。
5. driver 建沙盒 HOME，`piProfile.writeConfig` 按 `live` 渠道写沙盒 `models.json`（baseUrl 取 `harnessBaseUrl` 宿主原值）与 `settings.json`；PTY 启动真实 Pi。
6. footer 出现声明的模型 id 后发 "hi"，等待一轮真实回复；关闭后沙盒 home/cwd（含借用 token 副本）一并删除。

## 它实际证明什么

1. `from: harness` + `provider` 选择器借出的渠道与凭据能驱动真实宿主完成真实对话（0.84.4 实测：footer 显示声明模型，一轮回复约 6s）。
2. PtyAgentDriver live 分支的沙盒配置注入链路（`harnessBaseUrl` 原值回写）与宿主运行时约定兼容。

## 仍然存在的风险

- 借用的是 OAuth access 快照：宿主 token 寿命短（约 1 小时），过期则显式 missing，需在宿主里重新登录/运行让其刷新；harness 不代替宿主刷新。
- 沙盒只隔离 HOME/cwd 与配置，不是 OS 级网络封锁；真实 token 会短暂写入沙盒 `models.json`，关闭即删。
- 显式闸门只代表本次运行责任人的授权，不代表第三方条款许可。
