/**
 * @module @x-agent-suite/driver/jsonl-framing
 * 严格 LF 分帧器：仅以 \n 为记录分隔符，容忍并剥除行尾 \r，
 * 不将 U+2028 / U+2029 视为换行（node:readline 的已知缺陷）。
 * 不变量：多字节 UTF-8 跨 chunk 安全；超长行显式抛带上下文的 Error；end() 后禁止再 push。
 */
import { StringDecoder } from "node:string_decoder";

/** 分帧器选项。 */
export interface LfFramerOptions {
  /** 单行最大字节数（UTF-8 编码后），超限显式抛错；默认 1 MiB。 */
  readonly maxLineBytes?: number;
}

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

/**
 * 严格 LF 分帧器。
 *
 * @behavior lf-framer-contract
 * Given: 调用方构造 LfFramer 并持有 onLine 回调。
 * When: 以任意粒度 push UTF-8 字节块，最后调用 end()。
 * Then: 每收到一条以 \n 结尾的记录回调一次 onLine（剥除行尾可选 \r）；
 * U+2028 / U+2029 不触发断行；end() 冲刷末尾无换行的残留行。
 * Failure: 单行超过 maxLineBytes、或 end() 后再 push，均显式抛带上下文的 Error。
 */
export class LfFramer {
  private readonly onLine: (line: string) => void;
  private readonly maxLineBytes: number;
  private readonly decoder = new StringDecoder("utf8");
  private buffered = "";
  private bufferedBytes = 0;
  private ended = false;

  constructor(onLine: (line: string) => void, options: LfFramerOptions = {}) {
    this.onLine = onLine;
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  }

  /** 送入一块字节；按 \n 切出完整行回调 onLine。 */
  push(chunk: Uint8Array): void {
    if (this.ended) {
      throw new Error("LfFramer: end() 已调用，禁止继续 push");
    }
    this.buffered += this.decoder.write(chunk);
    this.bufferedBytes = Buffer.byteLength(this.buffered, "utf8");
    this.flushLines(false);
  }

  /** 冲刷：残留内容作为最后一行产出（无换行符也算一条记录）。 */
  end(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.buffered += this.decoder.end();
    this.flushLines(true);
  }

  /** 切出所有完整行；final 时把残留作为最后一行。 */
  private flushLines(final: boolean): void {
    for (;;) {
      const idx = this.buffered.indexOf("\n");
      if (idx < 0) {
        break;
      }
      let line = this.buffered.slice(0, idx);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      this.assertLineLength(line);
      this.buffered = this.buffered.slice(idx + 1);
      this.bufferedBytes = Buffer.byteLength(this.buffered, "utf8");
      this.onLine(line);
    }
    if (final) {
      if (this.buffered.length > 0) {
        let line = this.buffered;
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }
        this.assertLineLength(line);
        this.buffered = "";
        this.bufferedBytes = 0;
        this.onLine(line);
      }
      return;
    }
    if (this.bufferedBytes > this.maxLineBytes) {
      throw new Error(
        `LfFramer: 单行超长（>${this.maxLineBytes} 字节，当前已缓冲 ${this.bufferedBytes} 字节且未见 \\n）`,
      );
    }
  }

  /** 在交给消费方前校验一条完整记录的 UTF-8 字节数。 */
  private assertLineLength(line: string): void {
    const bytes = Buffer.byteLength(line, "utf8");
    if (bytes <= this.maxLineBytes) return;
    throw new Error(
      `LfFramer: 单行超长（>${this.maxLineBytes} 字节，当前 ${bytes} 字节）`,
    );
  }
}
