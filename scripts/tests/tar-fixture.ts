/**
 * @module scripts/tests/tar-fixture
 * 跨平台构造最小 tar.gz 测试夹具；路径字节原样写入，不经过系统 tar 的归一化。
 */
import { gzipSync } from "node:zlib";

/** 手工 tar entry；rawBlock 可插入扩展头或特殊块。 */
export interface RawTarEntry {
  /** header name 字段。 */
  readonly name?: string;
  /** POSIX type flag；默认普通文件 0。 */
  readonly typeFlag?: string;
  /** entry 数据。 */
  readonly data?: Buffer;
  /** header 声明的 size；缺省等于 data.length。 */
  readonly headerSize?: number;
  /** 直接插入的 512 字节块。 */
  readonly rawBlock?: Buffer;
}

function writeOctal(
  buffer: Buffer,
  offset: number,
  length: number,
  value: number,
): void {
  const text = value.toString(8).padStart(length - 1, "0");
  buffer.write(text, offset, "ascii");
  buffer[offset + length - 1] = 0;
}

/** 构造一个最小 ustar header；name 字节不做系统路径归一。 */
export function rawTarHeader(
  name: string,
  typeFlag: string,
  size: number,
): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(typeFlag, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

/** 把 entries 组装成 tar.gz；固定以双零块结束。 */
export function rawTarGz(entries: readonly RawTarEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    if (entry.rawBlock) {
      chunks.push(entry.rawBlock);
      continue;
    }
    const data = entry.data ?? Buffer.alloc(0);
    chunks.push(
      rawTarHeader(
        entry.name ?? "",
        entry.typeFlag ?? "0",
        entry.headerSize ?? data.length,
      ),
    );
    chunks.push(data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

/** 按 PAX 长度前缀生成一条 key=value record。 */
export function paxRecord(key: string, value: string): Buffer {
  const body = Buffer.from(`${key}=${value}\n`, "utf8");
  let length = body.length + 2;
  for (;;) {
    const next = body.length + 1 + String(length).length;
    if (next === length) break;
    length = next;
  }
  return Buffer.from(`${length} ${body.toString()}`);
}
