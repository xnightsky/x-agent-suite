/** firstOf 公共入口测试工作区；仅注册脚本化本地 transport。 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { stringify } from "yaml";
import { workspace } from "./recall-workspace.ts";
const registry = new URL("./recall-first-of.registry.ts", import.meta.url).href;
/** 生成标准与降级两档，rubric 名驱动零 token 夹具裁定。 */
export function firstOfBranches(standard: string, downgrade: string) {
  return [standard, downgrade].map((name, index) => ({
    name: index ? "downgrade" : "standard",
    score: { hit: index ? 1 : 3, miss: -1 },
    expect: { judge: { maxRetries: 0, rubrics: { [name]: { rubric: name } } } },
  }));
}
/** 从完整 YAML 走真实 Recall 装载与装配，隔离凭据/报告路径。 */
export async function firstOfWorkspace(
  t: TestContext,
  expect: object,
  turns: object[] = [{ send: "same answer" }],
) {
  const ws = await workspace(t);
  await writeFile(
    ws.registryPath,
    "export { default } from " + JSON.stringify(registry) + ";",
  );
  await writeFile(
    ws.recallPath,
    stringify({
      version: 1,
      id: "tiers",
      cases: [{ id: "one", turns, expect }],
    }),
  );
  const log = join(ws.cwd, "requests.jsonl");
  await writeFile(log, "");
  const outDir = join(ws.cwd, "reports");
  const options = {
    cwd: ws.cwd,
    homeDir: ws.cwd,
    selection: { carrier: "fixture-carrier" },
    liveConfigPath: ws.livePath,
    registryPath: ws.registryPath,
    target: ws.recallPath,
    outDir,
  };
  return { ...ws, log, outDir, options, registry };
}
