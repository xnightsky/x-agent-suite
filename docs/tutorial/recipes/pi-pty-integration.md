# Pi PTY 真实宿主集成

这条教程把合成 PTY 机制升级为真正的宿主证据：启动已安装的 Pi CLI，但把模型端点固定到本机 `FakeProviderBackend`，因此验证真实 TUI 路径而不消耗 token。

源码：[`examples/tutorial/09-pi-pty.ittest.ts`](../../../examples/tutorial/09-pi-pty.ittest.ts)。运行入口：

```bash
pnpm tutorial:pty:pi
```

默认结果是 skip。确认本机已安装 Pi、当前工作区允许启动 PTY 后，再显式运行：

```bash
E2E_PI_PTY=1 pnpm tutorial:pty:pi
```

## 它实际证明什么

1. `createPtyAgentDriver` 能解析并启动真实 Pi 命令。
2. 消费者侧 `piProfile` 把临时 HOME、cwd 和 Pi 配置隔离到 sandbox。
3. `models.json` 只指向本机 fake provider，并剥离常见 API key/OAuth 环境变量。
4. 真实 TUI 完成 ready、prompt 输入、fake 模型响应和屏幕观测。
5. `finally` 关闭 PTY/backend 并删除临时 HOME/cwd。

profile 位于 `packages/harness/tests/fixtures/profiles/pi.ts`，属于测试/消费者边界；具体宿主名、命令和配置不会进入 `packages/*/src/`。

## 为什么是 `*.ittest.ts`

判断依据是“是否启动真实宿主 CLI”，不是“是否使用 PTY”。`07-pty.test.ts` 启动合成 TUI，所以是单元层；本文件启动真实 Pi，所以是集成层。两者都使用 fake provider，均为零 token。

`pnpm itest` 会发现本文件；缺少 `E2E_PI_PTY=1` 时记录 skip，不会启动 Pi。若要同时使用真实 provider，必须另建 `*.token.ittest.ts` 并使用精确显式入口。

## 仍然存在的风险

- fake provider 降低账号/费用风险，但不是 OS 级网络封锁。
- Pi CLI 版本升级可能改变启动横幅、信任对话框或按键时序。
- 显式闸门只代表本次运行责任人的授权，不代表第三方条款许可。
