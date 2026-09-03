# Security Policy

## ⚠️ 重要提醒

**本框架会自动化驱动第三方 AI CLI 工具。** 使用前请阅读：

- **风险详情**：[AI CLI 风险评估](docs/research/ai-cli-account-session-risk.md)（完整的 R1-R7 风险表和上游服务条款引用）
- **免责声明**：[LICENSE](LICENSE)（MIT "AS IS" 条款）
- **使用警告**：[README.md](README.md)（CAUTION 块）

**你对使用本框架产生的任何后果（包括账号封禁、费用超支、数据泄露）承担全部责任。**

---

## 安全最佳实践

1. **使用专用测试凭据** - 不要用生产账号
2. **设置预算限制** - 在云服务商控制台设置费用上限
3. **审查 profile 配置** - 避免 `--yolo` 等自动批准模式
4. **优先使用 fake 模式** - 默认不消耗真实 token
5. **阅读上游服务条款** - 确保你的用途合规

详见 [INSTALLATION.md](docs/INSTALLATION.md) 和 [ai-cli-account-session-risk.md](docs/research/ai-cli-account-session-risk.md)。

---

## 报告安全问题

如果你发现安全漏洞：

1. **不要**公开 issue 或讨论漏洞细节
2. 通过 [Private Vulnerability Reporting](https://github.com/xnightsky/x-agent-suite/security/advisories/new) 私密报告
3. 如果该入口不可用，请暂缓披露，不要改用公开 Issue
4. 报告应包含：
   - 漏洞描述
   - 复现步骤
   - 潜在影响
   - 建议修复方案（可选）

我们会在 **72 小时内**回复，并在修复后公开披露。

---

## 上游服务条款（截至 2026-01-15）

- **OpenAI**: https://openai.com/policies/terms-of-use/
- **Anthropic**: https://code.claude.com/docs/en/legal-and-compliance
- **Google Gemini**: https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md
- **Kimi**: https://www.kimi.com/code/docs/en/kimi-code/community-guidelines.html

**注意**：条款可能变更，使用 live 模式前请重新核对。
