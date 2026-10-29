/**
 * @module profiles/pi-recall-guard
 * 消费者侧宿主工具守卫源码；只约束显式工具、命令和工作区路径。
 * 不变量：不构成 OS 级沙箱，领域脚本由受信任消费者声明。
 */
import type { RecallEffects } from "@x-agent-suite/recall";

/** 默认原生只读工具集。 */
export const PI_RECALL_READ_TOOLS = ["read", "grep", "find", "ls"] as const;

/** 在启动前拒绝无法兑现的命令策略；执行时仍按完整字符串匹配。 */
export function assertPiRecallCommands(effects: RecallEffects): void {
  if (effects.commands.allow.length === 0) return;
  if (effects.tools !== "allowlist") {
    throw new Error("Pi Recall Driver 命令执行需要显式 tools:allowlist");
  }
  for (const command of [...effects.commands.allow, ...effects.commands.deny]) {
    if (
      !command.startsWith("node ") ||
      !command.includes(".mjs") ||
      /[;&|<>`$\\\r\n*?{}\[\]~#()]/.test(command)
    ) {
      throw new Error(
        "Pi Recall Driver 命令白名单只接受无 shell 组合的 node .mjs 调用",
      );
    }
  }
}

/** 根据实际权限选择工具；仅显式命令白名单可开启命令入口。 */
export function piRecallTools(effects: RecallEffects): string[] {
  const tools: string[] =
    effects.tools === "none" ? [] : [...PI_RECALL_READ_TOOLS];
  if (effects.commands.allow.length > 0) tools.push("bash");
  return tools;
}

/** 生成实际下发的守卫；命令只接受固定 Node 脚本与字面量 argv。 */
export function createPiRecallGuardSource(
  workspace: string,
  effects: RecallEffects,
): string {
  const tools = piRecallTools(effects);
  return String.raw`
import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
const workspace = ${JSON.stringify(workspace)};
const tools = ${JSON.stringify(tools)};
const commands = ${JSON.stringify(effects.commands)};
const nodeExecutable = ${JSON.stringify(process.execPath)};

function inside(path) {
  const target = resolve(workspace, path);
  const nested = relative(workspace, target);
  if (nested === '..' || nested.startsWith('..' + sep) || isAbsolute(nested)) {
    throw new Error('路径越出隔离工作区');
  }
  let parent = target;
  for (;;) {
    try {
      const actual = realpathSync(parent);
      const rel = relative(workspace, actual);
      if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
        throw new Error('路径链接越出隔离工作区');
      }
      return target;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const next = dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
}

function argv(command) {
  if (typeof command !== 'string' || /[;&|<>$\\\r\n*?{}\[\]~#()]/.test(command) || command.includes(String.fromCharCode(96))) {
    throw new Error('命令只接受字面量 Node argv，禁止 shell 组合与展开');
  }
  const result = [];
  let word = '', quote = '', active = false;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = ''; else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch; active = true;
    } else if (/\s/.test(ch)) {
      if (active) { result.push(word); word = ''; active = false; }
    } else { word += ch; active = true; }
  }
  if (quote) throw new Error('命令引号未闭合');
  if (active) result.push(word);
  if ((result[0] !== 'node' && result[0] !== nodeExecutable) || !result[1]?.endsWith('.mjs')) {
    throw new Error('仅允许 node 执行工作区内的 .mjs 脚本');
  }
  result[0] = 'node';
  result[1] = inside(result[1]);
  if (!statSync(result[1]).isFile()) throw new Error('脚本不是普通文件');
  for (let i = 2; i < result.length; i++) {
    if (!result[i].startsWith('-') && result[i].includes('/')) result[i] = inside(result[i]);
  }
  return JSON.stringify(result);
}

export default function (pi) {
  pi.on('tool_call', (event) => {
    if (!tools.includes(event.toolName)) return { block: true, reason: '工具不在只读白名单或显式命令范围内' };
    try {
      if (event.toolName === 'bash') {
        const raw = event.input?.command;
        argv(raw);
        if (commands.deny.includes(raw)) {
          return { block: true, reason: '命令被显式拒绝' };
        }
        if (!commands.allow.includes(raw)) {
          return { block: true, reason: '命令未命中显式白名单，请原样使用 Skill 中获准的命令' };
        }
      } else {
        const path = inside(event.input?.path ?? '.');
        realpathSync(path);
      }
      return undefined;
    } catch (error) {
      return { block: true, reason: 'Pi Recall Driver：' + error.message };
    }
  });
  pi.on('turn_end', async (event, ctx) => {
    if (event.turnIndex >= ${effects.maxSteps - 1}) await ctx.abort();
  });
}
`;
}
