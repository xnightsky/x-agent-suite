/**
 * @module @x-agent-suite/runner/registry
 * Registry 运行时：契约写侧（注册）+ runner 读侧（按 id/名查找）。
 * 不变量：重复注册与未注册查找均显式抛错（配置错误不等于评测失败）。
 */

import type {
  Criterion,
  DriverRegistration,
  HarnessProfile,
  Registry,
  Scenario,
} from "@x-agent-suite/contracts";

/** Registry 运行时：契约的写侧 + runner 需要的读侧。 */
export interface RuntimeRegistry extends Registry {
  /** 按 id 取 driver；未注册显式抛错。 */
  driver(id: string): DriverRegistration;
  /** 按 scope + name 取判据；未注册显式抛错。 */
  criterion(scope: Criterion["scope"], name: string): Criterion;
  /** 全部已注册判据。 */
  criteria(): readonly Criterion[];
  /** 全部已注册场景。 */
  scenarios(): readonly Scenario<unknown, unknown>[];
}

/** 创建内存注册表。 */
export function createRegistry(): RuntimeRegistry {
  const drivers = new Map<string, DriverRegistration>();
  const profiles = new Map<string, HarnessProfile>();
  const criteriaIndex = new Map<string, Criterion>();
  const scenarioIndex = new Map<string, Scenario<unknown, unknown>>();

  const put = <T>(
    map: Map<string, T>,
    key: string,
    value: T,
    kind: string,
  ): void => {
    if (map.has(key)) {
      throw new Error(`${kind}重复注册：${key}`);
    }
    map.set(key, value);
  };

  return {
    registerDriver: (driver) => put(drivers, driver.id, driver, "driver"),
    registerProfile: (profile) =>
      put(profiles, profile.name, profile, "profile"),
    registerCriterion: (criterion) =>
      put(
        criteriaIndex,
        `${criterion.scope}:${criterion.name}`,
        criterion,
        "判据",
      ),
    registerScenario: (scenario) =>
      put(
        scenarioIndex,
        scenario.id,
        scenario as Scenario<unknown, unknown>,
        "场景",
      ),
    driver: (id) => {
      const found = drivers.get(id);
      if (!found) throw new Error(`未注册的 driver：${id}`);
      return found;
    },
    criterion: (scope, name) => {
      const found = criteriaIndex.get(`${scope}:${name}`);
      if (!found) throw new Error(`未注册的判据：${name}（${scope}）`);
      return found;
    },
    criteria: () => [...criteriaIndex.values()],
    scenarios: () => [...scenarioIndex.values()],
  };
}
