# Live 安全门与 token 测试停点

这一条只演示 live 前的授权判断与诊断脱敏，默认且始终不发真实网络请求。它不是“live 已验收”的证据。

## 运行安全门

```bash
pnpm tutorial:live:guard
```

源码：[`examples/tutorial/08-live-guard.test.ts`](../../../examples/tutorial/08-live-guard.test.ts)。默认摘要应为 `authorized: false`、`networkAttempted: false`、`redacted: true`，所以它属于 `*.test.ts`。

## 为什么不在教程默认命令里直连

真实 provider 会产生数据出站、费用、限额和账号风险。仅把 `LiveBackend` 或 `sniffLiveChannel` 写进普通示例，会让复制、CI 或自动发现误触真实调用；因此默认教程只验证 guard 和 `redactLiveSecrets`。

## 真正的 token 用例已经落地

可执行参照是 [`examples/tutorial/10-live-smoke.token.ittest.ts`](../../../examples/tutorial/10-live-smoke.token.ittest.ts)，详细运行方式见 [Live Token Smoke](./live-token-smoke.md)。消费者复制时可以平铺：

```text
packages/<consumer-boundary>/tests/<scenario>.token.ittest.ts
```

如果同一边界已有大量 token 用例，也可以按需放进 `tests/token/`，但这只是可选分组。无论位置如何，都要同时新增精确指向该文件或明确集合的 `itest:token:*` 脚本。用例顺序必须是：

1. 检查单次授权开关；缺失则 skip。
2. 从仓库根 `.env.e2e.yaml` 加载渠道，不从源码读取字面量密钥。
3. 创建最小权限 sandbox，并限制费用、token、并发、速率和总超时。
4. `sniffLiveChannel` 验证连通、鉴权和 tool calling；失败结构化 skip。
5. 才创建 `LiveBackend` 或启动真实宿主 live 路径。
6. `finally` 清理进程、端口、sandbox 和临时产物。
7. 所有错误、skip 和报告先经过 `redactLiveSecrets`。

`*.token.ittest.ts` 可以平铺或分组，但不进 `pnpm test`、`pnpm itest`、`pnpm check`；默认 runner 按完整后缀排除，不依赖路径约定。本仓用精确的 `pnpm itest:token:tutorial` 运行当前唯一 token 教程，不提供宽泛的默认 token glob。

## fixture 与 live 的证据关系

- fixture 回归证明配置、wire、工具轮和结构化观测是确定可复现的。
- live 对照只回答“目标渠道/模型在这次授权运行中是否表现一致”。
- live 结果会随模型、账号、路由和服务状态漂移，不能替代 fixture 默认回归。
