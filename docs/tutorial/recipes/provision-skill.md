# provision 安装态：能力包铺入沙箱并被宿主读取

这一条演示 P4：评测「安装后的能力」——能力包在 driver 启动前铺进沙箱的宿主可见位置，
宿主进程读到的是安装态副本，判据断言加载行为真实发生。零 token，归单元测试层。

## 运行

```bash
pnpm tutorial:provision
```

源码：[`examples/tutorial/16-provision-skill.test.ts`](../../../examples/tutorial/16-provision-skill.test.ts)，
能力包 fixture：[`examples/tutorial/fixtures/demo-skill/`](../../../examples/tutorial/fixtures/demo-skill/SKILL.md)。

## 预期结果

`TUTORIAL_SUMMARY` 应包含：`hardPass: true`、`backendRequests: 1`——
宿主进程输出了 `SKILL_LOADED:# demo-skill`（证明读到的是沙箱内安装态副本）。

## 代码怎么流动

1. `createDriver` 工厂给 `createHarnessDriver` 传 `sandboxSetup`：
   `provisionSandbox(sandbox, [{ source, target: ".agent/skills/demo-skill" }])`；
2. driver 生命周期内钩子时机固定：sandbox 创建 → `writeConfig` → **sandboxSetup（provision）**
   → 命令解析 → spawn——宿主启动时安装已就位；
3. 宿主（本例为合成 Node 进程）从 `$HOME/.agent/skills/demo-skill/SKILL.md` 读安装态文件；
4. 判据只断言可观测行为（输出含 `SKILL_LOADED:<标题>`），不断言铺设动作本身。

## provision 三模式配方

| 模式                | 适用                                                    | 做法                                                     |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| copy（默认）        | 一切安装态评测；跨平台安全                              | `provisionSandbox` 默认模式，递归复制                    |
| symlink             | 大资产 / 需要原位回写的联调；POSIX 语义，Windows 需特权 | `mode: "symlink"` 显式选择                               |
| install（包管理器） | 依赖安装本身是评测对象                                  | 在 `sandboxSetup` 里跑消费者自己的安装命令（沙箱内执行） |

嵌套依赖（能力包内含脚本/资产目录）随目录树一并铺设，无需特殊处理；
`target` 越出沙箱基准（绝对路径、`..` 逃逸）显式抛错。

## 换成消费者实现

- `source` 指向消费者仓的能力包目录；多能力包声明多条 entry；
- 目标位置按宿主约定的能力发现路径（home 基准放配置面，cwd 基准放项目面）；
- PTY driver 有同名 `sandboxSetup` 钩子，同一套 provision 声明可直接复用。

## 常见误区

- 不要在 `writeConfig` 里做 provision——它是宿主配置播种，钩子语义不同；
- 不要在判据里断言「文件铺没铺」——铺错会导致宿主行为缺失，行为判据自然会红；
  铺设本身失败会在 driver 启动阶段显式抛错（基础设施失败 ≠ 评测失败）。
