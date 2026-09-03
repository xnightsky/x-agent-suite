# 发布指南

## 🚀 快速发布（推荐）

**只需打 tag，GitHub Actions 自动完成所有工作**：

```bash
# 1. 确保测试通过
pnpm check

# 2. 打 annotated tag（版本号从 Git 历史自动推导）
git tag -a v0.1.3 -m "release: v0.1.3"

# 3. 推送 tag（触发自动发布）
git push origin v0.1.3
```

**GitHub Actions 会自动**：

- ✅ 运行完整测试（pnpm check）
- ✅ 构建制品（pnpm artifacts:pack）
- ✅ 创建 GitHub Release
- ✅ 上传所有 tarball 和校验文件

查看进度：https://github.com/xnightsky/x-agent-suite/actions

---

## 📋 版本号规则

版本号由 Git 历史自动推导，**不需要手动编辑 package.json**：

```bash
# 查看下一个版本应该是什么
pnpm artifacts:pack -- --snapshot
# 输出类似：[artifacts:pack] snapshot 0.1.3-dev.20260115.abc1234 <- abc1234
# 说明下一个稳定版本应该是 0.1.3
```

- 源码中的 `package.json` 版本永远是 `0.0.0`（占位符）
- 真实版本号从最近的 Git tag 开始计算
- 每次打包会验证版本号是否匹配

---

## 🔄 完整发布流程

### 1. 开发功能

```bash
git checkout -b feat/new-feature
# ... 修改代码 ...
git commit -m "feat: 新功能"
git push origin feat/new-feature
# 创建 PR，合并到 main
```

### 2. 准备发布

```bash
git checkout main
git pull

# 运行完整检查
pnpm check

# 确认工作区干净
git status
```

### 3. 打 tag 并推送

```bash
# 打 annotated tag
git tag -a v0.1.3 -m "release: v0.1.3"

# 推送（触发自动发布）
git push origin v0.1.3
```

### 4. 监控发布

访问 https://github.com/xnightsky/x-agent-suite/actions

- ✅ 成功：Release 已创建，制品已上传
- ❌ 失败：查看日志，修复后重新发布

### 5. 验证安装

```bash
cd $(mktemp -d)
pnpm init
pnpm add -D https://github.com/xnightsky/x-agent-suite/releases/download/v0.1.3/x-agent-suite-0.1.3.tgz

# 测试导入
node -e "import('x-agent-suite/matrix').then(() => console.log('✅ OK'))"
```

---

## ❌ 发布失败处理

### 场景 1：版本号不匹配

```
期望版本 0.1.3 与 Git history 推导版本 0.1.4 不一致
```

**解决**：使用推导的版本号

```bash
git tag -d v0.1.3                              # 删除本地 tag
git tag -a v0.1.4 -m "release: v0.1.4"         # 使用正确版本
git push origin v0.1.4
```

### 场景 2：测试失败

```bash
# 删除远程 tag
git push origin :refs/tags/v0.1.3

# 删除本地 tag
git tag -d v0.1.3

# 修复代码并重新发布
git commit -m "fix: 修复测试"
git push
git tag -a v0.1.3 -m "release: v0.1.3"
git push origin v0.1.3
```

### 场景 3：Release 创建失败

检查 GitHub Actions 日志，常见原因：

- 权限问题（已配置 `contents: write`）
- 网络超时（重新触发 workflow）

---

## 📦 本地构建（调试用）

如果需要本地测试打包流程：

```bash
# 构建制品到本地
pnpm artifacts:pack -- --version 0.1.3

# 检查输出
ls artifacts/0.1.3/
# 应该看到：
#   x-agent-suite-0.1.3.tgz
#   x-agent-suite-pty-driver-0.1.3.tgz
#   manifest.json
#   SHA256SUMS
```

**注意**：本地构建不会自动推送或创建 Release，只用于调试。

---

## 🔐 发布到 npm（可选）

当前只发布到 GitHub Release。如需发布到 npm registry：

### 1. 获取 npm token

1. 访问 https://www.npmjs.com/settings/YOUR_USERNAME/tokens
2. 创建 "Automation" token
3. 添加到 GitHub Secrets：`NPM_TOKEN`

### 2. 修改 Release workflow

编辑 `.github/workflows/release.yml`，在最后添加：

```yaml
- name: 发布到 npm
  if: "!contains(github.ref, '-')" # 只发布正式版本
  run: |
    echo "//registry.npmjs.org/:_authToken=${{ secrets.NPM_TOKEN }}" > ~/.npmrc
    npm publish artifacts/${{ steps.version.outputs.version }}/x-agent-suite-${{ steps.version.outputs.version }}.tgz --access public
    npm publish artifacts/${{ steps.version.outputs.version }}/x-agent-suite-pty-driver-${{ steps.version.outputs.version }}.tgz --access public
```

之后推送 tag 会**同时发布到 GitHub Release 和 npm**。

---

## 🤔 常见问题

### Q: 为什么不直接修改 package.json 版本号？

A: 版本号由 Git tag 管理，避免手动编辑导致的不一致。

### Q: 如何发布 beta 版本？

当前发布流水线只接受 annotated `vMAJOR.MINOR.PATCH` 稳定 tag，暂不支持 prerelease。请不要推送带预发布后缀的 tag；如需 prerelease，应先单独设计版本推导、制品命名与 Release 策略。

### Q: 制品在哪里？

- **远程**：GitHub Release（https://github.com/xnightsky/x-agent-suite/releases）
- **本地**：`artifacts/` 目录（gitignore，不推送）

### Q: 能否不通过 GitHub Actions 发布？

可以，但不推荐。如果必须：

```bash
pnpm artifacts:pack -- --version 0.1.3
gh release create v0.1.3 artifacts/0.1.3/* --title "v0.1.3" --notes "..."
```
