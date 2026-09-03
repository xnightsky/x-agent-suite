/**
 * @module @x-agent-suite/contracts/sandbox
 * 沙箱上下文类型：一个 harness 子进程一份隔离环境。
 *
 * 不变量：
 * - homeDir 与 cwd 均为临时生成的唯一目录；
 * - env 已剥离代理变量与 profile 声明的 stripEnv；
 * - 具体宿主的专用配置目录通过 `configDirs` 自由区表达，本模块不解释键名。
 */

/** 一个 harness 的隔离沙箱上下文。 */
export interface SandboxContext {
  /** 作为子进程 HOME 的临时目录。 */
  readonly homeDir: string;
  /** 子进程工作目录（项目根）。 */
  readonly cwd: string;
  /** 消费者专用配置目录映射；键为目录语义，值为沙箱内绝对路径。 */
  readonly configDirs?: Record<string, string>;
  /** 独立配置文件路径（config 文件型宿主使用）。 */
  readonly configFilePath?: string;
  /** broker-backed 模式时的临时 runtime 目录。 */
  readonly runtimeDir?: string;
  /** 本次测试合并后的环境变量（已剥离代理与 stripEnv 声明的变量）。 */
  readonly env: Record<string, string | undefined>;
  /** 唯一标识，用于日志与诊断。 */
  readonly id: string;
}

/** createSandbox 的可选项。 */
export interface CreateSandboxOptions {
  /** 除内置代理变量外，还要从子进程环境剥离的变量名。 */
  readonly stripEnv?: readonly string[];
  /** 注入的额外环境变量；不能覆盖 HOME、代理剥离项或 stripEnv。 */
  readonly env?: Record<string, string>;
  /** 需要创建的专用配置目录语义列表（在 homeDir 下建同名子目录）。 */
  readonly configDirs?: readonly string[];
  /** 是否提供独立配置文件路径（homeDir/config.json，不预写内容）。 */
  readonly configFile?: boolean;
  /** 是否创建 broker runtime 临时目录（homeDir/runtime）。 */
  readonly runtimeDir?: boolean;
}
