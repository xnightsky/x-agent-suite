/**
 * scripts/release-notes.mjs 的类型声明孪生：CI 脚本保持 .mjs（plain node 可跑），
 * 此处为 TS 消费方（测试与 artifacts-pack）提供类型。
 */
export declare function extractChangelogSection(
  changelog: string,
  version: string,
): string;
export declare function composeReleaseBody(
  version: string,
  section: string,
): string;
export declare function writeReleaseBody(options: {
  root: string;
  version: string;
  output: string;
}): void;
