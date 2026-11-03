/**
 * @module @x-agent-suite/harness/tests/fixtures/fake-pty-module
 * harness PTY driver 测试替身；通过 registerHooks 替代 node-pty。
 * 实例通过 globalThis.__xasHarnessFakePtyState 暴露，支持主动 emitExit。
 */
const state = (globalThis.__xasHarnessFakePtyState ??= {
  spawnCount: 0,
  instances: [],
});

function createInstance(command, args, options) {
  let exitInfo = null;
  const dataListeners = new Set();
  const exitListeners = new Set();
  const instance = {
    pid: 70_000 + state.spawnCount,
    command,
    args,
    options,
    writes: [],
    kills: [],
    get exitInfo() {
      return exitInfo;
    },
    onData(listener) {
      dataListeners.add(listener);
      return { dispose: () => dataListeners.delete(listener) };
    },
    onExit(listener) {
      exitListeners.add(listener);
      if (exitInfo) queueMicrotask(() => listener(exitInfo));
      return { dispose: () => exitListeners.delete(listener) };
    },
    write(data) {
      if (!exitInfo) instance.writes.push(data);
    },
    kill(signal) {
      instance.kills.push(signal ?? "SIGTERM");
      if (!exitInfo) {
        queueMicrotask(() => instance.emitExit({ exitCode: 0, signal: 0 }));
      }
    },
    emitData(data) {
      for (const listener of [...dataListeners]) listener(data);
    },
    emitExit(info) {
      if (exitInfo) return;
      exitInfo = {
        exitCode: info.exitCode ?? null,
        signal: info.signal ?? null,
      };
      for (const listener of [...exitListeners]) listener(exitInfo);
    },
  };
  state.spawnCount += 1;
  state.instances.push(instance);
  if ((process.env.XAS_FAKE_PTY_MODE ?? "ready") === "ready") {
    queueMicrotask(() => instance.emitData("READY\r\n"));
  }
  return instance;
}

export function spawn(command, args, options) {
  return createInstance(command, args, options);
}

export default { spawn };
