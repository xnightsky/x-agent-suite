/**
 * @module scripts/artifacts-manifest
 * 构造可审计的制品清单，记录版本、构建环境与 Git history 推导依据。
 */
import type { ArtifactVersionPlan } from "./artifacts-git.ts";

/** 清单中的单个 tarball 描述。 */
export interface ArtifactDescriptor {
  /** tarball 文件名。 */
  readonly file: string;
  /** tarball 内容的 SHA-256。 */
  readonly sha256: string;
  /** 制品职责。 */
  readonly kind: "core" | "pty";
}

/** 可复现检查所需的构建环境信息。 */
export interface ArtifactBuildEnvironment {
  /** ISO 8601 构建时间。 */
  readonly builtAt: string;
  /** Node.js 版本。 */
  readonly node: string;
  /** pnpm 版本。 */
  readonly pnpm: string;
}

/** 构造 schema v2 制品清单。 */
export function createArtifactManifest(
  plan: ArtifactVersionPlan,
  artifacts: readonly ArtifactDescriptor[],
  environment: ArtifactBuildEnvironment,
) {
  return {
    schemaVersion: 2,
    version: plan.version,
    stableVersion: plan.stableVersion,
    commit: plan.commit,
    tag: plan.snapshot ? null : plan.tag,
    dirty: false,
    mode: plan.snapshot ? "snapshot" : "stable",
    versioning: {
      strategy: "conventional-commits",
      previousTag: plan.previousTag,
      commits: plan.commits.map((commit) => commit.subject),
    },
    ...environment,
    artifacts,
  } as const;
}
