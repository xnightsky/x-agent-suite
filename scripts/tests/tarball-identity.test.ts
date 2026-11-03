/**
 * @module scripts/tests/tarball-identity
 * 用真实 tar/pnpm pack 产出的 tarball 验证共享 package identity reader。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { packPackage } from "../artifacts-build.ts";
import { readTarballPackageIdentity } from "../install-global.ts";

test("真实 pnpm tarball 的 package/package.json 可被身份 reader 读取", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-tarball-identity-"));
  try {
    const version = "0.7.2";
    const file = `x-agent-suite-${version}.tgz`;
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "@xnightsky/x-agent-suite",
        version,
        bin: { "x-agent-suite": "./dist/cli.js" },
      }),
    );
    await packPackage(root, join(root, "output"), file);
    const identity = await readTarballPackageIdentity(
      join(root, "output", file),
    );
    assert.deepEqual(identity, {
      name: "@xnightsky/x-agent-suite",
      version,
      bin: { "x-agent-suite": "./dist/cli.js" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("重复 package/package.json 显式拒绝，不能只取第一条身份", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-tarball-duplicate-"));
  const first = join(root, "first");
  const second = join(root, "second");
  try {
    await mkdir(join(first, "package"), { recursive: true });
    await mkdir(join(second, "package"), { recursive: true });
    await writeFile(
      join(first, "package", "package.json"),
      JSON.stringify({
        name: "@xnightsky/x-agent-suite",
        version: "0.7.2",
        bin: { "x-agent-suite": "./dist/cli.js" },
      }),
    );
    await writeFile(
      join(second, "package", "package.json"),
      JSON.stringify({
        name: "evil-package",
        version: "9.9.9",
        bin: { "x-agent-suite": "./evil.js" },
      }),
    );
    const archive = join(root, "duplicate.tgz");
    execFileSync("tar", [
      "-czf",
      archive,
      "-C",
      first,
      "package/package.json",
      "-C",
      second,
      "package/package.json",
    ]);
    await assert.rejects(
      () => readTarballPackageIdentity(archive),
      /重复.*package\/package\.json/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const PATH_ALIASES = [
  "package/./package.json",
  "package//package.json",
  "package/foo/../package.json",
] as const;

test("重复 package/package.json 的路径别名均被拒绝", async () => {
  for (const alias of PATH_ALIASES) {
    const root = await mkdtemp(join(tmpdir(), "xas-tarball-alias-"));
    const first = join(root, "first");
    const second = join(root, "second");
    try {
      await mkdir(join(first, "package"), { recursive: true });
      await mkdir(join(second, "package", "foo"), { recursive: true });
      await writeFile(
        join(first, "package", "package.json"),
        JSON.stringify({
          name: "@xnightsky/x-agent-suite",
          version: "0.7.2",
          bin: { "x-agent-suite": "./dist/cli.js" },
        }),
      );
      await writeFile(
        join(second, "package", "package.json"),
        JSON.stringify({
          name: "evil-package",
          version: "9.9.9",
          bin: { "x-agent-suite": "./evil.js" },
        }),
      );
      const archive = join(root, "alias.tgz");
      execFileSync("tar", [
        "-czf",
        archive,
        "-C",
        first,
        "package/package.json",
        "-C",
        second,
        alias,
      ]);
      await assert.rejects(
        () => readTarballPackageIdentity(archive),
        /重复.*package\/package\.json/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("绝对路径和逃逸解包根的 package.json 路径均被拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-tarball-path-escape-"));
  try {
    const absoluteSource = join(root, "absolute");
    await mkdir(join(absoluteSource, "package"), { recursive: true });
    const absoluteJson = join(absoluteSource, "package", "package.json");
    await writeFile(
      absoluteJson,
      JSON.stringify({
        name: "@xnightsky/x-agent-suite",
        version: "0.7.2",
        bin: { "x-agent-suite": "./dist/cli.js" },
      }),
    );
    const absoluteArchive = join(root, "absolute.tgz");
    execFileSync("tar", [
      "-P",
      "-czf",
      absoluteArchive,
      "-C",
      absoluteSource,
      absoluteJson,
    ]);
    await assert.rejects(
      () => readTarballPackageIdentity(absoluteArchive),
      /绝对|逃逸/,
    );

    const escapeSource = join(root, "escape");
    const escapeWork = join(escapeSource, "work");
    await mkdir(join(escapeWork, "package"), { recursive: true });
    await mkdir(join(escapeWork, "sub"), { recursive: true });
    await writeFile(
      join(escapeWork, "package", "package.json"),
      JSON.stringify({
        name: "@xnightsky/x-agent-suite",
        version: "0.7.2",
        bin: { "x-agent-suite": "./dist/cli.js" },
      }),
    );
    const escapeArchive = join(root, "escape.tgz");
    execFileSync("tar", [
      "-czf",
      escapeArchive,
      "-C",
      join(escapeWork, "sub"),
      "../package/package.json",
    ]);
    await assert.rejects(
      () => readTarballPackageIdentity(escapeArchive),
      /绝对|逃逸/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const VALID_PACKAGE_JSON = JSON.stringify({
  name: "@xnightsky/x-agent-suite",
  version: "0.7.2",
  bin: { "x-agent-suite": "./dist/cli.js" },
});
const EVIL_PACKAGE_JSON = JSON.stringify({
  name: "evil-package",
  version: "9.9.9",
  bin: { "x-agent-suite": "./evil.js" },
});

interface RawTarEntry {
  readonly name?: string;
  readonly typeFlag?: string;
  readonly data?: Buffer;
  readonly headerSize?: number;
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

function rawTarHeader(name: string, typeFlag: string, size: number): Buffer {
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

function rawTarGz(entries: readonly RawTarEntry[]): Buffer {
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

function paxRecord(key: string, value: string): Buffer {
  const body = Buffer.from(`${key}=${value}\n`, "utf8");
  let length = body.length + 2;
  for (;;) {
    const next = body.length + 1 + String(length).length;
    if (next === length) break;
    length = next;
  }
  return Buffer.from(`${length} ${body.toString()}`);
}

async function writeRawTar(
  path: string,
  entries: readonly RawTarEntry[],
): Promise<void> {
  await writeFile(path, rawTarGz(entries));
}

test("合法单 path PAX 继续通过身份读取", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-pax-single-"));
  try {
    const archive = join(root, "single-pax.tgz");
    await writeRawTar(archive, [
      {
        name: "PaxHeaders/valid",
        typeFlag: "x",
        data: paxRecord("path", "package/package.json"),
      },
      { name: "package/original", data: Buffer.from(VALID_PACKAGE_JSON) },
    ]);
    assert.deepEqual(await readTarballPackageIdentity(archive), {
      name: "@xnightsky/x-agent-suite",
      version: "0.7.2",
      bin: { "x-agent-suite": "./dist/cli.js" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("合法单 path GNU longname 继续通过身份读取", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-gnu-single-"));
  try {
    const archive = join(root, "single-gnu.tgz");
    await writeRawTar(archive, [
      {
        name: "././@LongLink",
        typeFlag: "L",
        data: Buffer.from("package/package.json\0"),
      },
      { name: "package/original", data: Buffer.from(VALID_PACKAGE_JSON) },
    ]);
    assert.equal((await readTarballPackageIdentity(archive)).version, "0.7.2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PAX 同一扩展头多个 path 字段显式拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-pax-duplicate-"));
  try {
    const archive = join(root, "duplicate-pax-path.tgz");
    await writeRawTar(archive, [
      { name: "package/package.json", data: Buffer.from(VALID_PACKAGE_JSON) },
      {
        name: "PaxHeaders/ambiguous",
        typeFlag: "x",
        data: Buffer.concat([
          paxRecord("path", "package/other"),
          paxRecord("path", "package/package.json"),
        ]),
      },
      { name: "package/original", data: Buffer.from(EVIL_PACKAGE_JSON) },
    ]);
    const extracted = join(root, "extracted");
    await mkdir(extracted, { recursive: true });
    execFileSync("tar", ["-xzf", archive, "-C", extracted]);
    assert.equal(
      await readFile(join(extracted, "package", "package.json"), "utf8"),
      EVIL_PACKAGE_JSON,
      "真实解包应使用最后一个 PAX path",
    );
    await assert.rejects(
      () => readTarballPackageIdentity(archive),
      /PAX.*path|path.*PAX/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PAX 空 path 显式拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-pax-empty-"));
  try {
    const archive = join(root, "empty-pax-path.tgz");
    await writeRawTar(archive, [
      { name: "package/package.json", data: Buffer.from(VALID_PACKAGE_JSON) },
      {
        name: "PaxHeaders/empty",
        typeFlag: "x",
        data: paxRecord("path", ""),
      },
      { name: "package/original", data: Buffer.from(EVIL_PACKAGE_JSON) },
    ]);
    await assert.rejects(
      () => readTarballPackageIdentity(archive),
      /PAX.*path|path.*PAX/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PAX path 与 GNU longname 同时用于同一 entry 时拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-pax-gnu-mix-"));
  try {
    const archive = join(root, "mixed-extension.tgz");
    await writeRawTar(archive, [
      { name: "package/package.json", data: Buffer.from(VALID_PACKAGE_JSON) },
      {
        name: "././@LongLink",
        typeFlag: "L",
        data: Buffer.from("package/long-other\0"),
      },
      {
        name: "PaxHeaders/mixed",
        typeFlag: "x",
        data: paxRecord("path", "package/pax-other"),
      },
      { name: "package/original", data: Buffer.from(EVIL_PACKAGE_JSON) },
    ]);
    await assert.rejects(
      () => readTarballPackageIdentity(archive),
      /扩展头|PAX.*GNU|连续/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("连续 PAX 扩展头产生歧义时拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-pax-consecutive-"));
  try {
    const archive = join(root, "consecutive-pax.tgz");
    await writeRawTar(archive, [
      { name: "package/package.json", data: Buffer.from(VALID_PACKAGE_JSON) },
      {
        name: "PaxHeaders/one",
        typeFlag: "x",
        data: paxRecord("path", "package/one"),
      },
      {
        name: "PaxHeaders/two",
        typeFlag: "x",
        data: paxRecord("path", "package/two"),
      },
      { name: "package/original", data: Buffer.from(EVIL_PACKAGE_JSON) },
    ]);
    await assert.rejects(
      () => readTarballPackageIdentity(archive),
      /连续扩展头|扩展头/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PAX size=0 隐藏第二份 package.json 必须拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-pax-size-zero-"));
  try {
    const hiddenJson = Buffer.from(EVIL_PACKAGE_JSON);
    const hiddenHeader = rawTarHeader(
      "package/package.json",
      "0",
      hiddenJson.length,
    );
    const hiddenData = Buffer.concat([
      hiddenHeader,
      hiddenJson,
      Buffer.alloc((512 - (hiddenJson.length % 512)) % 512),
    ]);
    const archive = join(root, "size-zero.tgz");
    await writeFile(
      archive,
      rawTarGz([
        {
          name: "package/package.json",
          data: Buffer.from(VALID_PACKAGE_JSON),
        },
        {
          name: "PaxHeaders/size-zero",
          typeFlag: "x",
          data: paxRecord("size", "0"),
        },
        {
          name: "package/decoy",
          headerSize: hiddenData.length,
          data: hiddenData,
        },
      ]),
    );
    const extracted = join(root, "extracted");
    await mkdir(extracted, { recursive: true });
    execFileSync("tar", ["-xzf", archive, "-C", extracted]);
    assert.equal(
      await readFile(join(extracted, "package", "package.json"), "utf8"),
      EVIL_PACKAGE_JSON,
      "系统 tar 应遵循 PAX size=0 并解包隐藏 entry",
    );
    await assert.rejects(
      () => readTarballPackageIdentity(archive),
      /重复.*package\/package\.json/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("合法 PAX size override 的 package.json 可正确读取", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-pax-size-valid-"));
  try {
    const packageJson = Buffer.from(VALID_PACKAGE_JSON);
    const archive = join(root, "size-valid.tgz");
    await writeFile(
      archive,
      rawTarGz([
        {
          name: "PaxHeaders/size",
          typeFlag: "x",
          data: Buffer.concat([
            paxRecord("path", "package/package.json"),
            paxRecord("size", String(packageJson.length)),
          ]),
        },
        { name: "package/original", headerSize: 0, data: packageJson },
      ]),
    );
    assert.deepEqual(await readTarballPackageIdentity(archive), {
      name: "@xnightsky/x-agent-suite",
      version: "0.7.2",
      bin: { "x-agent-suite": "./dist/cli.js" },
    });
    const extracted = join(root, "extracted");
    await mkdir(extracted, { recursive: true });
    execFileSync("tar", ["-xzf", archive, "-C", extracted]);
    assert.equal(
      await readFile(join(extracted, "package", "package.json"), "utf8"),
      VALID_PACKAGE_JSON,
      "系统 tar 应遵循合法 PAX size override",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PAX 重复或非法 size 显式拒绝", async () => {
  for (const metadata of [
    [paxRecord("size", "0"), paxRecord("size", "1")],
    [paxRecord("size", "abc")],
    [paxRecord("size", "-1")],
  ]) {
    const root = await mkdtemp(join(tmpdir(), "xas-pax-size-invalid-"));
    try {
      const archive = join(root, "invalid-size.tgz");
      await writeRawTar(archive, [
        {
          name: "package/package.json",
          data: Buffer.from(VALID_PACKAGE_JSON),
        },
        {
          name: "PaxHeaders/invalid-size",
          typeFlag: "x",
          data: Buffer.concat(metadata),
        },
        { name: "package/original", data: Buffer.from(EVIL_PACKAGE_JSON) },
      ]);
      await assert.rejects(
        () => readTarballPackageIdentity(archive),
        /size|布局/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("PAX linkpath、GNU sparse 与 SCHILY 布局扩展显式拒绝", async () => {
  for (const key of [
    "linkpath",
    "GNU.sparse.size",
    "GNU.sparse.realsize",
    "SCHILY.realsize",
  ]) {
    const root = await mkdtemp(join(tmpdir(), "xas-pax-layout-"));
    try {
      const archive = join(root, "layout.tgz");
      await writeRawTar(archive, [
        {
          name: "package/package.json",
          data: Buffer.from(VALID_PACKAGE_JSON),
        },
        {
          name: "PaxHeaders/layout",
          typeFlag: "x",
          data: paxRecord(key, "0"),
        },
        { name: "package/original", data: Buffer.from(EVIL_PACKAGE_JSON) },
      ]);
      await assert.rejects(
        () => readTarballPackageIdentity(archive),
        /布局|size|linkpath|sparse|SCHILY/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("PAX global header 不允许布局覆盖", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-pax-global-layout-"));
  try {
    const archive = join(root, "global-layout.tgz");
    await writeRawTar(archive, [
      {
        name: "PaxHeaders/global",
        typeFlag: "g",
        data: paxRecord("size", "0"),
      },
      { name: "package/package.json", data: Buffer.from(VALID_PACKAGE_JSON) },
    ]);
    await assert.rejects(
      () => readTarballPackageIdentity(archive),
      /global|布局|size/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("单个结束零块后仍有第二份 package.json 时拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-single-zero-"));
  try {
    const archive = join(root, "single-zero.tgz");
    await writeFile(
      archive,
      rawTarGz([
        {
          name: "package/package.json",
          data: Buffer.from(VALID_PACKAGE_JSON),
        },
        { rawBlock: Buffer.alloc(512) },
        { name: "package/package.json", data: Buffer.from(EVIL_PACKAGE_JSON) },
      ]),
    );
    const listed = execFileSync("tar", ["--ignore-zeros", "-tzf", archive], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    assert.deepEqual(listed, ["package/package.json", "package/package.json"]);
    await assert.rejects(
      () => readTarballPackageIdentity(archive),
      /零块|重复.*package\/package\.json/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
