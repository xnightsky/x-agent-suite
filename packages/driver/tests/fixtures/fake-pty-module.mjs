/**
 * @module @x-agent-suite/driver/tests/fixtures/fake-pty-module
 * 可观测的 node-pty 替身：测试通过 registerHooks 将 "node-pty" 解析到这里。
 * 行为由 XAS_FAKE_PTY_MODE 控制；实例通过 globalThis.__xasFakePtyState 暴露给测试，
 * 不启动真实系统进程。
 */
const state = (globalThis.__xasFakePtyState ??= {
  spawnCount: 0,
  instances: [],
});

function createInstance(command, args, options) {
  let exitInfo = null;
  const dataListeners = new Set();
  const exitListeners = new Set();
  const instance = {
    pid: 60_000 + state.spawnCount,
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
      if (exitInfo) return;
      instance.writes.push(data);
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
  const mode = process.env.XAS_FAKE_PTY_MODE ?? "ready";
  if (mode === "ready") {
    queueMicrotask(() => instance.emitData("READY\r\n"));
  }
  return instance;
}

export function spawn(command, args, options) {
  return createInstance(command, args, options);
}

export default { spawn };
