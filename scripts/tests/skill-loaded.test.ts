/**
 * @module scripts/tests/skill-loaded
 * 验证场景仓的 Skill 名称判据，不启动宿主或模型。
 * 不变量：路径只用于提取名字；调用成功状态仍来自工具事件。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCall, TurnObservation } from "@x-agent-suite/contracts";
import registry from "../../integrations/pi.registry.ts";

async function evaluate(toolCalls: ToolCall[], expect: unknown) {
  const criterion = registry.criteria?.find(
    (item) => item.name === "skill-loaded" && item.scope === "turn",
  );
  assert.ok(criterion?.scope === "turn");
  const turn: TurnObservation = {
    index: 0,
    sent: "",
    text: "",
    toolCalls,
    commands: [],
    startedAt: 0,
    endedAt: 0,
    metadata: {},
  };
  return criterion.evaluate(turn, {
    expect,
    turnIndex: 0,
    session: {
      driver: "unit",
      turns: [turn],
      text: "",
      toolCalls,
      commands: [],
      exhausted: false,
      metadata: {},
    },
  });
}

test("同名 Skill 在源目录和不同安装目录的成功读取都算触发", async () => {
  for (const path of [
    "skills-def/change-report/SKILL.md",
    ".pi/skills/change-report/SKILL.md",
    ".agents/skills/change-report/SKILL.md",
    "/sandbox/skills/change-report/SKILL.md",
    "C:\\sandbox\\skills\\change-report\\SKILL.md",
  ]) {
    const result = await evaluate(
      [{ name: "read", input: { path }, status: "completed" }],
      { name: "change-report", loaded: true },
    );
    assert.equal(result.pass, true, path);
  }
});

test("其他 Skill、脚本读取及失败读取不算成功加载；读取尝试不能通过未触发断言", async () => {
  for (const call of [
    {
      name: "read",
      input: { path: "skills/other/SKILL.md" },
      status: "completed",
    },
    {
      name: "read",
      input: { path: "skills/change-report/scripts/build.mjs" },
      status: "completed",
    },
    {
      name: "read",
      input: { path: "skills/change-report/SKILL.md" },
      status: "failed",
    },
  ] satisfies ToolCall[]) {
    assert.equal(
      (await evaluate([call], { name: "change-report", loaded: true })).pass,
      false,
    );
  }
  assert.equal(
    (await evaluate([], { name: "change-report", loaded: false })).pass,
    true,
  );
  assert.equal(
    (
      await evaluate(
        [
          {
            name: "read",
            input: { path: "skills/change-report/SKILL.md" },
            status: "failed",
          },
        ],
        { name: "change-report", loaded: false },
      )
    ).pass,
    false,
  );
});

test("名称断言拒绝空值与路径，不再接受 path 作为身份", async () => {
  for (const expect of [
    { path: ".pi/skills/change-report/SKILL.md", loaded: true },
    { name: "", loaded: true },
    { name: "skills/change-report", loaded: true },
  ])
    await assert.rejects(evaluate([], expect), /name/);
});
