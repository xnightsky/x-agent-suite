# AI CLI 自动化风险与上游依据

- 评估日期：2026-08-28
- 维护范围：当前库的可触发风险与上游官方条款/政策引用

## 当前风险点

AI CLI 的 headless、PTY 或脚本驱动本身不必然违规；风险取决于认证类型、流量端点、订阅条款、工具权限和调用强度。

“授权”仅指运行责任人对单次高危操作的明确批准，不代表厂商许可，也不能放行“禁止”项。

| ID  | 等级·处置       | 当前触发点                                                                                                           | 主要后果                                                                        | 上游官方依据                                                                 |
| --- | --------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| R1  | 高危·需显式授权 | `credential: harness` 会解析本机 CLI 的 API key 或 OAuth/session token；`from: harness` 未显式给出凭据时会隐含该路径 | 订阅凭据离开官方客户端信任边界，可能导致 token/session 撤销、权益受限或账号暂停 | [OpenAI](#openai)、[Anthropic](#anthropic)、[Google](#google)、[Kimi](#kimi) |
| R2  | 高危·禁止       | 把订阅 OAuth/session token 发往第三方 endpoint、反向代理或非原始认证目标                                             | 凭据泄露、身份冒用、session 封禁或账号暂停/终止                                 | [Anthropic](#anthropic)、[Google](#google)                                   |
| R3  | 高危·禁止       | 用 Kimi Code **订阅**运行无人值守、批处理或数据标注                                                                  | 违反订阅的个人交互用途限制，可能触发并发限制或账号暂停                          | [Kimi](#kimi)                                                                |
| R4  | 高危·禁止       | 轮换/共享账号或调整调用路径以绕过额度、速率、并发或保护措施                                                          | 条款执法、额外限流、权益暂停或账号终止                                          | [OpenAI](#openai)、[Kimi](#kimi)                                             |
| R5  | 高危·需隔离授权 | 消费者 profile 可以使用 `--yolo`、绕过审批/沙箱或自动接受编辑；仓库的 harness 测试 fixture 中存在此类参数            | 无人确认的命令执行、文件改写、凭据读取或数据外发                                | [OpenAI](#openai)、[Google](#google)                                         |
| R6  | 中高·需显式授权 | `live` 会发起真实请求；headless 和 PTY driver 的 live 分支当前传入空 `stripEnv` 列表                                 | 认证环境变量被继承，以及真实数据出站、费用、token 消耗或速率限制                | [OpenAI](#openai)、[Google](#google)                                         |
| R7  | 中·默认启用     | 默认 `fixture` 使用 loopback fake provider 和临时 HOME/cwd，但 sandbox 不等于系统级公网出站阻断                      | 隔离失效时可能误读真实凭据、误连上游或外发本机数据                              | 工程风险；无特定厂商条款前提                                                 |

### 当前库触发点

- [`harness-credentials.ts`](../../packages/harness/src/harness-credentials.ts)：读取 CLI 原生凭据存储。
- [`live-config.ts`](../../packages/llm-fixture/src/live-config.ts)：`from: harness` 可隐含 `credential: harness`。
- [`driver.ts`](../../packages/harness/src/driver.ts) 与 [`pty-driver.ts`](../../packages/harness/src/pty-driver.ts)：live 分支当前不应用 profile `stripEnv`。
- [`tests/fixtures/profiles`](../../packages/harness/tests/fixtures/profiles)：含绕过审批、`--yolo` 或自动接受编辑的测试 profile；这些不是通用 runtime 的默认内建 profile。

## 上游官方条款与政策依据

以下链接均于 2026-08-28 核验。条款可能变更，live 运行前需重新核对。

### OpenAI

- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)：官方支持 `codex exec` 用于 scripts/CI；默认为只读 sandbox，完全访问仅应在受控隔离 runner 中使用；自动化默认建议 API key。
- [Codex authentication](https://developers.openai.com/codex/auth)：要求把 `auth.json` 按密码级凭据保护。
- [Terms of Use](https://openai.com/policies/terms-of-use/)：禁止共享账号凭据、绕过 rate limit、restriction 或 protective measure；违反条款或造成风险时可暂停或终止访问。

### Anthropic

- [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)：官方提供 `claude -p` 和结构化输出等脚本能力。
- [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)：第三方应用不得代用户路由 Free/Pro/Max 凭据，也不得收集、存储或居间处理 Claude.ai credential/session token。

### Google

- [Gemini CLI Terms of Service and Privacy Notice](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md)：第三方软件复用 Gemini CLI OAuth 直接访问其背后服务违反适用条款，可导致账号暂停或终止。
- [Gemini CLI headless mode](https://geminicli.com/docs/cli/headless/)：官方支持 headless 自动化。
- [Gemini CLI policy engine](https://geminicli.com/docs/core/policy-engine/)：`yolo` 模式自动批准所有工具，官方要求极度谨慎使用。

### Kimi

- [Kimi Code Community Guidelines](https://www.kimi.com/code/docs/en/kimi-code/community-guidelines.html)：订阅仅限个人交互式使用，禁止无人值守脚本、批处理、数据标注、账号/API access 转售或绕过使用限制。
- [Kimi CLI command reference](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/reference/kimi-command.md)：CLI 技术上提供 `-p` 脚本/CI 入口；该能力不覆盖订阅层的用途限制。
