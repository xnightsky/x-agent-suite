/**
 * @module @x-agent-suite/harness/pty-mirror
 * PTY 屏幕镜像：订阅多个受测端的屏幕变化，节流后把全部整屏脱敏重绘为一帧打到
 * stderr（ANSI 清屏），供人工实时观察 TUI 操作。
 * 不变量：
 * - 多目标自动分屏：按当前终端尺寸等宽并列（见 composeMirrorFrame），每个源镜像到
 *   自己的窗格，终端过窄回退纵向堆叠；终端 resize 后下一帧自动按新尺寸排版；
 * - 终端尺寸探测见 detectTerminalSize：测试子进程 stderr 是管道拿不到 columns，
 *   故回退 /dev/tty 的 stty size 拿真实终端尺寸；
 * - 仅建议 verbose 诊断时使用；返回的关闭函数收尾必须调用。
 */
import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";

/** 屏幕镜像订阅的最小源形状（PtyProcess 只读子集）。 */
export interface ScreenMirrorSource {
  /** 当前屏幕快照。 */
  screen(): string;
  /** 订阅屏幕变化，返回取消订阅函数。 */
  onScreenChange(listener: () => void): () => void;
}

/** 屏幕镜像目标。 */
export interface ScreenMirrorTarget {
  /** 帧内标签（如 "a" / "b"）。 */
  readonly label: string;
  /** 屏幕源（未就绪为 null，自动跳过）。 */
  readonly source: ScreenMirrorSource | null;
}

/** 镜像帧的一个分屏：标签加整屏文本。 */
export interface MirrorPane {
  readonly label: string;
  readonly screen: string;
}

/** 镜像分屏布局：列数与每个窗格的宽/高（行）。 */
export interface MirrorLayout {
  readonly columns: number;
  readonly paneWidth: number;
  readonly paneHeight: number;
}

/** 镜像重绘节流间隔（毫秒）。 */
const MIRROR_THROTTLE_MS = 300;

/** 分屏并列时每个窗格的最小宽度（列），低于此值回退纵向堆叠。 */
const MIRROR_MIN_PANE_WIDTH = 24;

/** 分屏窗格的最小高度（行），低于此值认为不可读。 */
const MIRROR_MIN_PANE_HEIGHT = 6;

/** 码点是否按全角（宽 2）计：CJK、谚文、全角符号与平面 2/3 表意文字。 */
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** 文本的终端显示宽度：ASCII 计 1 列，CJK 等全角字符计 2 列。 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += isWideCodePoint(ch.codePointAt(0)!) ? 2 : 1;
  }
  return width;
}

/** 把文本适配到精确显示宽度：超长按列截断（不截半全角字符），不足补空格。 */
export function fitToWidth(text: string, width: number): string {
  let used = 0;
  let out = "";
  for (const ch of text) {
    const w = isWideCodePoint(ch.codePointAt(0)!) ? 2 : 1;
    if (used + w > width) {
      break;
    }
    out += ch;
    used += w;
  }
  return out + " ".repeat(width - used);
}

/**
 * 先算宽高再定布局：从"全部并列"到"单列"依次尝试，取满足窗格最小宽高的
 * 最多列方案（多分屏优先横向铺开，行向均分剩余高度）；任何方案都不可读时
 * 返回 null，由调用方回退无裁切的纵向堆叠。
 */
export function computeMirrorLayout(
  paneCount: number,
  cols: number,
  rows: number,
): MirrorLayout | null {
  for (let columns = paneCount; columns >= 1; columns--) {
    const paneWidth = Math.floor((cols - (columns - 1)) / columns);
    if (paneWidth < MIRROR_MIN_PANE_WIDTH) {
      continue;
    }
    const gridRows = Math.ceil(paneCount / columns);
    const paneHeight = Math.floor((rows - gridRows) / gridRows) - 1;
    if (paneHeight >= MIRROR_MIN_PANE_HEIGHT) {
      return { columns, paneWidth, paneHeight };
    }
  }
  return null;
}

/** 取屏幕尾部 bodyRows 行并底对齐（上方补空行），TUI 尾部信息最相关。 */
function tailLines(screen: string, bodyRows: number): string[] {
  const lines = screen.split("\n").slice(-bodyRows);
  return [
    ...Array<string>(Math.max(bodyRows - lines.length, 0)).fill(""),
    ...lines,
  ];
}

/** 拼一行分屏：不满列的末行补空格窗格，保证每行宽度精确等于终端列数。 */
function joinRow(cells: string[], columns: number, paneWidth: number): string {
  const padded = [
    ...cells,
    ...Array<string>(Math.max(columns - cells.length, 0)).fill(
      " ".repeat(paneWidth),
    ),
  ];
  return padded.join("│");
}

/**
 * 把多个分屏排版为一帧：先用 computeMirrorLayout 按终端宽高算网格布局，
 * 每个源镜像到自己的窗格（标签行 + 尾部屏体，│ 分隔，行列精确铺满终端）；
 * 布局不可读（极端窄/矮）时回退无裁切的纵向堆叠。总高不超 rows、总宽不超 cols。
 */
export function composeMirrorFrame(
  panes: readonly MirrorPane[],
  cols: number,
  rows: number,
): string {
  const layout = computeMirrorLayout(panes.length, cols, rows);
  if (!layout) {
    return panes
      .map((pane) => `──── ${pane.label} ────\n${pane.screen}`)
      .join("\n");
  }
  const { columns, paneWidth, paneHeight } = layout;
  const blank = "";
  const frameLines: string[] = [];
  for (let start = 0; start < panes.length; start += columns) {
    const group = panes.slice(start, start + columns);
    const cells = group.map((pane) => fitToWidth(` ${pane.label} `, paneWidth));
    frameLines.push(joinRow(cells, columns, paneWidth));
    const bodies = group.map((pane) => tailLines(pane.screen, paneHeight));
    for (let row = 0; row < paneHeight; row++) {
      frameLines.push(
        joinRow(
          bodies.map((lines) => fitToWidth(lines[row] ?? blank, paneWidth)),
          columns,
          paneWidth,
        ),
      );
    }
  }
  return frameLines.join("\n");
}

/**
 * verbose 屏幕镜像：订阅各目标屏幕变化，节流后把全部目标的整屏脱敏重绘为一帧
 * 打到 stderr（ANSI 清屏）。挂载即绘一帧；返回关闭函数，收尾必须调用。
 * @param targets 镜像目标列表（source 为 null 的自动跳过；全空时返回空操作关闭函数）。
 * @param redact 脱敏函数，逐屏应用；缺省不脱敏。
 */
export function attachScreenMirror(
  targets: readonly ScreenMirrorTarget[],
  redact: (text: string) => string = (text) => text,
): () => void {
  const sources = targets
    .map((target) => ({ label: target.label, source: target.source }))
    .filter((entry): entry is { label: string; source: ScreenMirrorSource } =>
      Boolean(entry.source),
    );
  if (sources.length === 0) {
    return () => undefined;
  }
  let lastPaint = 0;
  let pending: NodeJS.Timeout | null = null;
  const paint = (): void => {
    lastPaint = Date.now();
    pending = null;
    const { cols, rows } = detectTerminalSize();
    const panes = sources.map((entry) => ({
      label: entry.label,
      screen: redact(entry.source.screen()),
    }));
    const frame = composeMirrorFrame(panes, cols, rows - 1);
    process.stderr.write(
      `\x1b[2J\x1b[H[screen-mirror ${new Date().toISOString()} ${cols}x${rows}]\n${frame}\n`,
    );
  };
  const onChange = (): void => {
    if (pending) {
      return;
    }
    const wait = MIRROR_THROTTLE_MS - (Date.now() - lastPaint);
    if (wait <= 0) {
      paint();
      return;
    }
    pending = setTimeout(paint, wait);
    pending.unref?.();
  };
  const unsubscribes = sources.map((entry) =>
    entry.source.onScreenChange(onChange),
  );
  paint();
  return () => {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  };
}

/** 终端尺寸缓存有效期（毫秒）：/dev/tty 探测是子进程调用，需节流。 */
const TERMINAL_SIZE_CACHE_MS = 2000;

let terminalSizeCache: { cols: number; rows: number; at: number } | null = null;

/** 解析 `stty size` 输出（"rows cols"）；零值、空串、乱码一律返回 null。 */
export function parseSttySize(
  text: string,
): { cols: number; rows: number } | null {
  const match = text.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) {
    return null;
  }
  const rows = Number(match[1]);
  const cols = Number(match[2]);
  return rows > 0 && cols > 0 ? { cols, rows } : null;
}

/**
 * 探测宿主终端尺寸（列/行）。测试子进程 stderr/stdout 是管道，columns 永远
 * undefined，故经 /dev/tty 上 stty size 拿真实终端尺寸；依次回退 COLUMNS/LINES
 * 环境变量与 80x24。结果缓存 2s（resize 下一帧生效）。
 */
export function detectTerminalSize(): { cols: number; rows: number } {
  const now = Date.now();
  if (
    terminalSizeCache &&
    now - terminalSizeCache.at < TERMINAL_SIZE_CACHE_MS
  ) {
    return terminalSizeCache;
  }
  const size = probeTerminalSize();
  terminalSizeCache = { ...size, at: now };
  return size;
}

/** 探测链：TTY 流尺寸 → /dev/tty 的 stty size → COLUMNS/LINES → 80x24。 */
function probeTerminalSize(): { cols: number; rows: number } {
  const streamCols = process.stderr.columns ?? process.stdout.columns ?? 0;
  const streamRows = process.stderr.rows ?? process.stdout.rows ?? 0;
  if (streamCols > 0 && streamRows > 0) {
    return { cols: streamCols, rows: streamRows };
  }
  const ttySize = probeTtySizeViaStty();
  if (ttySize) {
    return ttySize;
  }
  const envCols = Number(process.env.COLUMNS);
  const envRows = Number(process.env.LINES);
  if (envCols > 0 && envRows > 0) {
    return { cols: envCols, rows: envRows };
  }
  return { cols: 80, rows: 24 };
}

/** 在 /dev/tty 上执行 stty size 取真实终端尺寸；无控制终端或输出异常返回 null。 */
function probeTtySizeViaStty(): { cols: number; rows: number } | null {
  try {
    const fd = openSync("/dev/tty", "r");
    try {
      const result = spawnSync("stty", ["size"], {
        stdio: [fd, "pipe", "ignore"],
        timeout: 1000,
      });
      return result.status === 0
        ? parseSttySize(result.stdout?.toString() ?? "")
        : null;
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}
