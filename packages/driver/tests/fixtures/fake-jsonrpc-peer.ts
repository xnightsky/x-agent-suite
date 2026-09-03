/**
 * @module @x-agent-suite/driver/tests/fixtures/fake-jsonrpc-peer
 * 脚本化假 JSON-RPC 服务端引擎：stdin 严格 LF 分帧（复用 LfFramer），
 * stdout 逐行回写 JSON-RPC 消息。本文件不内置任何协议语义：
 * 行为由外部模块注入 —— 直接运行（node --import tsx）时从环境变量
 * FAKE_JSONRPC_PEER_BEHAVIOR 指向的模块加载默认导出 setup 函数。
 * 不变量：
 * - 方法 → handler 注册表由测试脚本注入；未注册方法回 -32601；
 * - handler 抛错回 -32000 并带原因，不静默吞错；
 * - 支持 server→client 反向请求（id 配对等待应答）与主动推送通知；
 * - stdin 解析失败的行写 stderr 诊断并继续（对端异常不应静默挂起）。
 */
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LfFramer } from "../../src/jsonl-framing.ts";

/** 一次 client→server 调用的上下文。 */
export interface FakePeerContext {
  /** 请求 id；通知（无 id）时为 undefined，此时不应答。 */
  readonly id?: number | string;
}

/** 测试脚本注入行为的 API 面。 */
export interface FakePeerApi {
  /** 注册方法 handler（请求与通知统一；通知无 id 不回写应答）。 */
  onRequest(
    method: string,
    handler: (
      params: unknown,
      context: FakePeerContext,
    ) => unknown | Promise<unknown>,
  ): void;
  /** server→client 反向请求并等待应答；对端回 error 时显式 reject。 */
  request(method: string, params?: unknown): Promise<unknown>;
  /** 主动推送一条通知（无 id）。 */
  notify(method: string, params?: unknown): void;
  /** 写一行原始内容到 stdout（用于注入非法 JSONL 等异常场景）。 */
  sendRaw(line: string): void;
}

/** 一条待处理的客户端消息（宽松视图）。 */
interface IncomingMessage {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
}

/** 在飞的 server→client 反向请求。 */
interface PendingServerRequest {
  readonly method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

/** 假 JSON-RPC 服务端引擎：注册表驱动的最小 JSON-RPC 对端。 */
export class FakeJsonRpcPeerScript {
  private readonly handlers = new Map<
    string,
    (params: unknown, context: FakePeerContext) => unknown | Promise<unknown>
  >();
  private readonly pending = new Map<number, PendingServerRequest>();
  private nextId = 9000;

  /** 行为注入 API。 */
  api(): FakePeerApi {
    return {
      onRequest: (method, handler) => {
        if (this.handlers.has(method)) {
          throw new Error(`FakeJsonRpcPeer: 重复注册方法 ${method}`);
        }
        this.handlers.set(method, handler);
      },
      request: (method, params) => this.sendServerRequest(method, params),
      notify: (method, params) => this.send({ jsonrpc: "2.0", method, params }),
      sendRaw: (line) => {
        process.stdout.write(`${line}\n`);
      },
    };
  }

  /** 绑定 stdin/stdout 开始服务（阻塞至 stdin 结束）。 */
  attach(): void {
    const framer = new LfFramer((line) => {
      if (line.trim() === "") {
        return;
      }
      let msg: IncomingMessage;
      try {
        msg = JSON.parse(line) as IncomingMessage;
      } catch (error) {
        console.error(
          `FakeJsonRpcPeer: 非 JSON 行: ${line.slice(0, 200)}；原因: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      void this.handleMessage(msg);
    });
    process.stdin.on("data", (chunk: Buffer) => framer.push(chunk));
    process.stdin.on("end", () => framer.end());
  }

  /** 路由一条客户端消息：反向请求应答归位 / 方法与通知分发。 */
  private async handleMessage(msg: IncomingMessage): Promise<void> {
    if (
      msg.id !== undefined &&
      (msg.result !== undefined || msg.error !== undefined)
    ) {
      this.resolveServerRequest(msg);
      return;
    }
    if (typeof msg.method !== "string") {
      console.error(`FakeJsonRpcPeer: 无法路由的消息: ${JSON.stringify(msg)}`);
      return;
    }
    await this.dispatch(msg);
  }

  /** 分发到注册 handler；未注册方法回 -32601；通知（无 id）不应答。 */
  private async dispatch(msg: IncomingMessage): Promise<void> {
    const method = msg.method as string;
    const handler = this.handlers.get(method);
    if (!handler) {
      if (msg.id !== undefined) {
        this.send({
          jsonrpc: "2.0",
          id: msg.id,
          error: {
            code: -32601,
            message: `FakeJsonRpcPeer: 未注册方法 ${method}`,
          },
        });
      }
      return;
    }
    try {
      const result = await handler(msg.params, { id: msg.id });
      if (msg.id !== undefined) {
        this.send({ jsonrpc: "2.0", id: msg.id, result });
      }
    } catch (error) {
      if (msg.id !== undefined) {
        this.send({
          jsonrpc: "2.0",
          id: msg.id,
          error: {
            code: -32000,
            message: `FakeJsonRpcPeer: 方法 ${method} 处理失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        });
      } else {
        console.error(
          `FakeJsonRpcPeer: 通知 ${method} 处理失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** server→client 反向请求：id 配对等待应答。 */
  private sendServerRequest(
    method: string,
    params?: unknown,
  ): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** 反向请求应答归位：error 显式 reject。 */
  private resolveServerRequest(msg: IncomingMessage): void {
    const pending = this.pending.get(Number(msg.id));
    if (!pending) {
      console.error(`FakeJsonRpcPeer: 未知应答 id: ${String(msg.id)}`);
      return;
    }
    this.pending.delete(Number(msg.id));
    if (msg.error) {
      pending.reject(
        new Error(
          `FakeJsonRpcPeer: 反向请求 ${pending.method} 被拒绝: ${msg.error.message ?? JSON.stringify(msg.error)}（code=${msg.error.code ?? "?"}）`,
        ),
      );
      return;
    }
    pending.resolve(msg.result);
  }

  /** 写一条 JSON-RPC 消息到 stdout。 */
  private send(message: unknown): void {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

/**
 * 以注入的 setup 启动假 JSON-RPC 服务端。
 * @param setup 行为脚本：通过 api 注册方法 handler。
 */
export function runFakeJsonRpcPeer(setup: (api: FakePeerApi) => void): void {
  const script = new FakeJsonRpcPeerScript();
  setup(script.api());
  script.attach();
}

const entry = process.argv[1];
if (entry && resolve(entry) === fileURLToPath(import.meta.url)) {
  const behaviorPath = process.env.FAKE_JSONRPC_PEER_BEHAVIOR;
  if (!behaviorPath) {
    console.error(
      "FakeJsonRpcPeer: 缺少 FAKE_JSONRPC_PEER_BEHAVIOR（行为模块路径）",
    );
    process.exit(1);
  }
  const mod = (await import(pathToFileURL(behaviorPath).href)) as {
    default: (api: FakePeerApi) => void;
  };
  runFakeJsonRpcPeer(mod.default);
}
