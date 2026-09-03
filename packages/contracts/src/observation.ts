/**
 * @module @x-agent-suite/contracts/observation
 * 观测层公共类型：ToolCall、DriverEvent、Observation、TurnObservation、SessionObservation、ScenarioResult。
 *
 * 不变量：
 * - 本模块只声明契约，不依赖任何运行时；
 * - 具体宿主产出的原始字段统一进 `metadata` 自由区，本模块不解释；
 * - `ScenarioResult` 的 `artifact` 用泛型解耦，由消费者自行定义证据形状。
 */

/** 一次工具调用的结构化记录。 */
export interface ToolCall {
  /** 工具名（宿主侧命名，可能含命名空间前缀）。 */
  readonly name: string;
  /** 工具入参（宿主原始结构，未做归一化）。 */
  readonly input: unknown;
  /** 工具出参（可选）。 */
  readonly output?: unknown;
  /** 宿主侧报告的调用结果状态；判据应优先据此判断，而非文本或退出码。 */
  readonly status?: "completed" | "failed";
}

/** 驱动层事件：按序暴露底层事件流，供时序断言。 */
export interface DriverEvent {
  /** 事件类别（driver 自定义命名，如 "prompt" / "text" / "tool_call" / "closed"）。 */
  readonly type: string;
  /** 事件发生时间（epoch 毫秒）。 */
  readonly timestamp: number;
  /** 事件载荷（可选，结构化原始数据）。 */
  readonly payload?: unknown;
}

/** 一条用户 prompt 的结构化观测结果。 */
export interface Observation {
  /** 原始文本输出。 */
  readonly text: string;
  /** 该轮内发生的工具调用（按发生顺序，含入参与状态）。 */
  readonly toolCalls: ToolCall[];
  /** 模型轮数（不是工具调用数）。 */
  readonly steps?: number;
  /** 工具调用总数。 */
  readonly toolCallsCount: number;
  /** 是否撞步数/预算上限。 */
  readonly exhausted?: boolean;
  /** 该轮 token 用量（fixture 模式通常为空，live 模式由 driver 填充）。 */
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  /** carrier 标识；由外层测试/报告填入，driver 本身不强制生产。 */
  readonly carrier?: string;
  /** 该轮内底层原始事件（按发生顺序）。 */
  readonly events: DriverEvent[];
  /** 领域自由区；具体宿主专有字段进这里。 */
  readonly metadata?: Record<string, unknown>;
}

/**
 * 单轮切片 —— `scope: 'turn'` 判据的输入。
 *
 * 逐轮判据能区分「行为从未发生」与「行为发生过但之后衰减了」。
 */
export interface TurnObservation {
  /** 0-based 轮次序号。 */
  readonly index: number;
  /** 本轮送入被测系统的内容。 */
  readonly sent: string;
  /** 本轮产出的文本。 */
  readonly text: string;
  /** 本轮发生的工具调用。 */
  readonly toolCalls: ToolCall[];
  /** 从 toolCalls 中抽取的 shell 命令；非 shell 类 driver 下为空数组。 */
  readonly commands: string[];
  /** 本轮开始时间（epoch 毫秒）。 */
  readonly startedAt: number;
  /** 本轮结束时间（epoch 毫秒）。 */
  readonly endedAt: number;
  /** 本轮等待 idle 超时被中断。 */
  readonly timedOut?: boolean;
  /** 领域自由区。 */
  readonly metadata: Record<string, unknown>;
}

/** 全会话 —— `scope: 'session'` 判据的输入。 */
export interface SessionObservation {
  /** driver 标识；注册时声明，框架不枚举取值。 */
  readonly driver: string;
  /** driver profile 标识；agent-pty 等形态下由 driver 自行解释。 */
  readonly profile?: string;
  /** 各轮切片。 */
  readonly turns: TurnObservation[];
  /** 全会话文本，等价于按序拼接各轮 text。 */
  readonly text: string;
  /** 全会话工具调用。 */
  readonly toolCalls: ToolCall[];
  /** 全会话 shell 命令。 */
  readonly commands: string[];
  /** 会话未能正常完成（进程崩溃、启动失败、全局超时）。判据应先经护栏短路。 */
  readonly exhausted: boolean;
  /** workspace 销毁前物化的文件态证据；键由 provision hook 声明，框架只透传。 */
  readonly evidence?: Record<string, unknown>;
  /** 领域自由区。 */
  readonly metadata: Record<string, unknown>;
}

/**
 * 场景评分结果：dry/hard/fuzzy 三层判定 + 可选列举核对 + 耗时/成本/错误归类。
 *
 * @typeParam Artifact 场景跑完后收集的状态证据形状，由消费者定义。
 */
export interface ScenarioResult<Artifact = Record<string, unknown>> {
  /** 发送轮的结构化观测。 */
  readonly observation: Observation;
  /** 消费者自定义的状态证据；默认退化为自由键值记录。 */
  readonly artifact: Artifact;
  /** dry contract 层是否通过（Observation 结构合法）。 */
  readonly dryPass: boolean;
  /** hard 层是否通过（工具调用 completed + 入参正确 + 证据命中）。 */
  readonly hardPass: boolean;
  /** fuzzy 层是否通过（文本兜底匹配）。 */
  readonly fuzzyPass: boolean;
  /** enumerate 核对结果（仅列举类场景填写）。 */
  readonly enumerate?: {
    readonly hallucinated: string[];
    readonly missing: string[];
  };
  /** 从 sendPrompt 到结果返回的耗时（毫秒，由场景编排实测）。 */
  readonly latencyMs: number;
  /** 估算成本（美元）；fixture 模式无真实 usage，必须留 undefined。 */
  readonly costUsd?: number;
  /** 失败归类（无 tool call / 参数错误 / 证据缺失等），通过时留空。 */
  readonly error?: string;
}
