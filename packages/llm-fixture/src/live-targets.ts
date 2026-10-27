/**
 * @module @x-agent-suite/llm-fixture/live-targets
 * 多 provider 配置展开：可选模型目录与 carrier 级 default 归一。
 * 不变量：本模块只处理声明形状，不读文件、不借用凭据、不发起网络请求。
 */
import type {
  LiveConfigLoad,
  LiveTargetRef,
  LiveTargetSelection,
  LiveTargetsResult,
  ResolvedLiveTarget,
} from "./live-types.ts";

/** 一个待经既有渠道校验流程解析的模型声明。 */
export interface ExpandedTargetDeclaration {
  readonly target: LiveTargetRef;
  readonly declaration: Record<string, unknown>;
}

/** 多 provider carrier 的展开结果。 */
export interface ExpandedCarrier {
  readonly available: readonly ExpandedTargetDeclaration[];
  readonly defaults: readonly LiveTargetRef[];
  readonly inheritDefault: boolean;
  readonly inheritDeclaration: Record<string, unknown>;
}

/** 展开结果：成功返回声明，失败返回可读原因。 */
export type ExpandCarrierResult =
  { readonly expanded: ExpandedCarrier } | { readonly reason: string };

/** 判断声明是否使用 providers/default 新格式。 */
export function hasExpandedCarrierFormat(
  record: Record<string, unknown>,
): boolean {
  return record.providers !== undefined || record.default !== undefined;
}

/** 展开 carriers.*.providers 与 default，不在此阶段解析端点或凭据。 */
export function expandCarrier(
  record: Record<string, unknown>,
): ExpandCarrierResult {
  if (record.provider !== undefined || record.model !== undefined) {
    return {
      reason: "新旧格式混用：provider/model 不得与 providers/default 同时声明",
    };
  }
  const providers = record.providers;
  if (
    typeof providers !== "object" ||
    providers === null ||
    Array.isArray(providers)
  ) {
    return { reason: "providers 必须是对象" };
  }

  const inheritDeclaration = Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => key !== "providers" && key !== "default",
    ),
  );
  const available: ExpandedTargetDeclaration[] = [];
  for (const [provider, rawProvider] of Object.entries(providers)) {
    if (
      provider === "" ||
      typeof rawProvider !== "object" ||
      rawProvider === null
    ) {
      return { reason: `provider "${provider}" 的声明必须是对象且名称非空` };
    }
    const providerRecord = rawProvider as Record<string, unknown>;
    const models = providerRecord.models;
    if (
      !Array.isArray(models) ||
      models.length === 0 ||
      models.some((model) => typeof model !== "string" || model === "")
    ) {
      return {
        reason: `provider "${provider}" 的 models 必须是非空字符串数组`,
      };
    }
    const providerDefaults = Object.fromEntries(
      Object.entries(providerRecord).filter(([key]) => key !== "models"),
    );
    for (const model of models as string[]) {
      available.push({
        target: { provider, model },
        declaration: {
          ...inheritDeclaration,
          ...providerDefaults,
          provider,
          model,
        },
      });
    }
  }
  if (available.length === 0)
    return { reason: "providers 至少声明一个 provider" };

  const hasDefault = Object.prototype.hasOwnProperty.call(record, "default");
  if (!hasDefault) {
    return {
      expanded: {
        available,
        defaults: [],
        inheritDefault: record.from === "harness",
        inheritDeclaration,
      },
    };
  }
  const defaults = normalizeDefaults(
    record.default,
    available.map(({ target }) => target),
  );
  if ("reason" in defaults) return defaults;
  return {
    expanded: {
      available,
      defaults: defaults.targets,
      inheritDefault: false,
      inheritDeclaration,
    },
  };
}

/** 将 default 支持的简写归一成目标引用。 */
function normalizeDefaults(
  raw: unknown,
  catalog: readonly LiveTargetRef[],
): { readonly targets: LiveTargetRef[] } | { readonly reason: string } {
  const entries = Array.isArray(raw) ? raw : [raw];
  const targets: LiveTargetRef[] = [];
  for (const entry of entries) {
    const resolved = resolveDefaultEntry(entry, catalog);
    if (typeof resolved === "string") return { reason: resolved };
    targets.push(resolved);
  }
  return { targets };
}

/** 解析一个 default 条目；失败返回错误文本。 */
function resolveDefaultEntry(
  entry: unknown,
  catalog: readonly LiveTargetRef[],
): LiveTargetRef | string {
  if (typeof entry === "string" && entry !== "") {
    const qualified = catalog.filter(
      ({ provider, model }) => entry === `${provider}/${model}`,
    );
    const candidates =
      qualified.length > 0
        ? qualified
        : catalog.filter(({ model }) => model === entry);
    if (candidates.length === 1) return candidates[0]!;
    if (candidates.length > 1)
      return `default "${entry}" 有歧义，须写 provider/model`;
    return `default "${entry}" 不存在于可选模型目录`;
  }
  if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
    const record = entry as Record<string, unknown>;
    if (
      typeof record.provider === "string" &&
      typeof record.model === "string"
    ) {
      const target = { provider: record.provider, model: record.model };
      const found = catalog.some(
        ({ provider, model }) =>
          provider === target.provider && model === target.model,
      );
      return found
        ? target
        : `default "${target.provider}/${target.model}" 不存在于可选模型目录`;
    }
  }
  return "default 条目必须是非空字符串或 { provider, model }";
}

/** 汇总显式选择候选；完整 provider/model 或精确模型优先于模糊匹配。 */
function explicitCandidates(
  load: Extract<LiveConfigLoad, { kind: "loaded" }>,
  selection: LiveTargetSelection,
): ResolvedLiveTarget[] {
  const candidates = Object.entries(load.available).flatMap(
    ([carrier, channels]) =>
      channels
        .filter(
          (channel) =>
            (!selection.carrier || carrier === selection.carrier) &&
            (!selection.provider || channel.provider === selection.provider),
        )
        .map((channel) => ({ carrier, channel })),
  );
  const qualified = candidates.filter(
    ({ channel }) =>
      selection.model === `${channel.provider ?? "-"}/${channel.model}`,
  );
  const exact =
    qualified.length > 0
      ? qualified
      : candidates.filter(({ channel }) => channel.model === selection.model);
  const matched =
    exact.length > 0
      ? exact
      : candidates.filter(({ channel }) =>
          channel.model.toLowerCase().includes(selection.model!.toLowerCase()),
        );
  return [
    ...new Map(
      matched.map((target) => [
        `${target.carrier}\0${target.channel.provider ?? ""}\0${target.channel.model}`,
        target,
      ]),
    ).values(),
  ];
}

/** 解析显式 target 或在已选范围内展开 defaults；无选择参数拒绝，不叠加 env 字段覆盖。 */
export function resolveLiveTargets(
  load: LiveConfigLoad,
  selection: LiveTargetSelection = {},
): LiveTargetsResult {
  if (load.kind !== "loaded") return load;
  if (!selection.carrier && !selection.provider && !selection.model) {
    return {
      kind: "not-configured",
      reason: "必须显式选择 carrier/provider/model，拒绝隐式执行默认目标",
    };
  }
  if (selection.model !== undefined) {
    if (selection.model === "") {
      return { kind: "not-configured", reason: "model 不得为空" };
    }
    const targets = explicitCandidates(load, selection);
    if (targets.length === 1) {
      return { kind: "configured", source: load.source, targets };
    }
    const candidates = targets.map(
      ({ carrier, channel }) =>
        `${carrier}/${channel.provider ?? "-"}/${channel.model}`,
    );
    return {
      kind: "not-configured",
      reason:
        targets.length > 1
          ? `model "${selection.model}" 有歧义，候选：${candidates.join(", ")}`
          : `model "${selection.model}" 未匹配可选目标`,
    };
  }
  if (selection.carrier && load.invalid[selection.carrier]) {
    return { kind: "not-configured", reason: load.invalid[selection.carrier]! };
  }
  if (!selection.carrier) {
    const invalid = Object.entries(load.invalid)[0];
    if (invalid) {
      return {
        kind: "not-configured",
        reason: `carrier "${invalid[0]}" 配置无效：${invalid[1]}`,
      };
    }
  }
  const carriers = selection.carrier
    ? [selection.carrier]
    : Object.keys(load.available);
  const targets = carriers
    .flatMap((carrier) =>
      (load.defaults[carrier] ?? []).map((channel) => ({ carrier, channel })),
    )
    .filter(
      ({ channel }) =>
        !selection.provider || channel.provider === selection.provider,
    );
  if (targets.length === 0) {
    return { kind: "not-configured", reason: "未配置默认验证目标" };
  }
  return { kind: "configured", source: load.source, targets };
}
