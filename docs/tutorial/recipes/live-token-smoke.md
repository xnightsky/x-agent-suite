# Live Token Smoke

这是教程目录中真正访问 provider 的最小证据，不是 guard 模拟。源码：[`examples/tutorial/10-live-smoke.token.ittest.ts`](../../../examples/tutorial/10-live-smoke.token.ittest.ts)，唯一入口是：

```bash
pnpm itest:token:tutorial
```

直接运行仍会 skip。测试必须同时获得：

1. `XAS_TUTORIAL_LIVE_AUTHORIZATION=I_ACCEPT_LIVE_COST_AND_DATA_EGRESS` 单次授权值；
2. `XAS_TUTORIAL_LIVE_CARRIER=<carrier>` 选择渠道；
3. 仓库根 `.env.e2e.yaml` 中该 carrier 的 wire、base URL、model 和凭据声明。

示意配置只引用环境变量，不把 key 写进源码：

```yaml
carriers:
  tutorial:
    wire: openai-chat
    baseUrl: https://provider.example/v1
    model: model-id
    apiKeyEnv: TUTORIAL_PROVIDER_API_KEY
```

一次 POSIX shell 显式运行形如：

```bash
XAS_TUTORIAL_LIVE_AUTHORIZATION=I_ACCEPT_LIVE_COST_AND_DATA_EGRESS \
XAS_TUTORIAL_LIVE_CARRIER=tutorial \
TUTORIAL_PROVIDER_API_KEY='<从安全凭据源注入>' \
pnpm itest:token:tutorial
```

## 执行链

1. runner 精确选中单个 `*.token.ittest.ts` 文件；默认 `pnpm test/itest/check` 均不会加载它。
2. 文件级测试再次检查单次授权值；缺失时连测试回调都不执行。
3. 创建临时 sandbox，并把 live 配置的 home fallback 指向空临时 HOME，避免无意读取真实用户目录。
4. `loadLiveConfig` 读取 repo 私密配置，`resolveLiveChannel` 解析指定 carrier；缺配置显式 skip。
5. `sniffLiveChannel` 发起一轮最多 256 output token 的 tool-calling 探针，超时 20 秒。
6. 失败诊断通过 `redactLiveSecrets`，最后清理 sandbox。

## 证据与停点

通过只证明“这次授权运行中，该渠道可连通、鉴权有效并能返回合法工具调用”。它不证明模型长期稳定，也不替代 fixture 回归。

该文件可以与其他教程平铺，因为默认 runner 按完整 `.token.ittest.ts` 后缀排除，不依赖 `tests/token/` 目录。PTY、live、smoke 只是描述词；风险车道由完整 token 后缀、精确脚本和运行时授权三重确定。
