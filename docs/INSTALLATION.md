# 安装指南

> **⚠️ 重要提示**
>
> 本框架会启动并驱动第三方 AI CLI（如 Claude Code、OpenAI Codex 等）。使用前请：
>
> 1. **阅读风险说明**：详见 [AI CLI 风险评估](../docs/research/ai-cli-account-session-risk.md)
> 2. **遵守服务条款**：确保你的使用方式符合 OpenAI、Anthropic、Google 等的服务条款
> 3. **使用测试凭据**：建议使用专用 API key 或测试账号，不要用主账号
> 4. **监控费用**：live 模式会产生真实 API 调用费用
>
> **你对使用本框架产生的任何后果（包括但不限于账号封禁、费用超支、数据泄露）承担全部责任。**

## 快速开始

### 开发此项目（贡献者）

```bash
git clone https://github.com/xnightsky/x-agent-suite
cd x-agent-suite
pnpm install
pnpm check  # 运行所有测试
```

---

## 在其他项目中使用

### 方式一：从 GitHub Release 安装（推荐）

适用于：已发布正式版本，想要稳定的 tarball

#### 使用 pnpm

```bash
cd your-project
pnpm add -D https://github.com/xnightsky/x-agent-suite/releases/download/v0.1.0/x-agent-suite-0.1.0.tgz
```

#### 使用 npm

```bash
cd your-project
npm install --save-dev https://github.com/xnightsky/x-agent-suite/releases/download/v0.1.0/x-agent-suite-0.1.0.tgz
```

#### 使用 yarn

```bash
cd your-project
yarn add -D https://github.com/xnightsky/x-agent-suite/releases/download/v0.1.0/x-agent-suite-0.1.0.tgz
```

**如果需要 PTY 交互能力**，额外安装对应的包（同样支持三种包管理器）。

### 方式二：从 npm 安装（未来）

当项目发布到 npm registry 后：

```bash
pnpm add -D x-agent-suite@0.1.0

# 如果需要 PTY 能力
pnpm add -D @x-agent-suite/pty-driver@0.1.0
```

**对应的 package.json**：

```json
{
  "devDependencies": {
    "x-agent-suite": "0.1.0",
    "@x-agent-suite/pty-driver": "0.1.0"
  }
}
```

### 方式三：本地开发联调（临时）

适用于：你在同时开发两个项目，需要实时看到 x-agent-suite 的改动

```bash
# 假设两个项目在同一父目录
cd ../your-other-project
pnpm add -D link:../x-agent-suite
```

**注意**：

- 这种方式**不稳定**，不要提交到 Git
- x-agent-suite 需要先 `pnpm install` 和构建
- 联调结束后改回方式一或方式二

---

## 使用示例

安装后，在你的项目中：

```typescript
import { runMatrix } from "x-agent-suite/matrix";
import { createSandbox } from "x-agent-suite/sandbox";

// 使用框架...
```

---

## 常见问题

### Q: 为什么不能直接 `git clone` 然后 `pnpm add ../x-agent-suite`？

A: 这个项目是 monorepo，源码中的包是 `workspace:*` 内部依赖。必须先运行 `pnpm artifacts:pack` 构建聚合包，才能作为外部依赖安装。

### Q: 版本号在哪里？

A: 源码中的版本号是 `0.0.0` 占位符。真实版本由 Git tag 决定，运行 `pnpm artifacts:pack` 时自动推导。

### Q: 如何切换版本？

**GitHub Release 方式**：修改 URL 中的版本号

```json
{
  "devDependencies": {
    "x-agent-suite": "https://github.com/.../v0.2.0/x-agent-suite-0.2.0.tgz"
  }
}
```

**npm 方式**：修改版本号

```json
{
  "devDependencies": {
    "x-agent-suite": "0.2.0"
  }
}
```

然后运行 `pnpm install`。

### Q: 我的项目用 npm，但 x-agent-suite 要求 pnpm，怎么办？

A: **没关系！** pnpm 只是 x-agent-suite **开发时**用的工具。发布后的 tarball 是标准的 npm 包，**pnpm、npm、yarn 都能安装**。

### Q: 需要 Node.js 和 pnpm 什么版本？

- Node.js ≥ 24.0.0
- pnpm ≥ 10.0.0

检查版本：

```bash
node --version
pnpm --version
```
