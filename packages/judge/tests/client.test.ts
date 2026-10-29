import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { AgentDriver, Observation } from "@x-agent-suite/contracts";
import {
  parseTargetTagDictionary,
  type ResolvedLiveTarget,
  type TargetTagCatalog,
} from "@x-agent-suite/llm-fixture";
import {
  createJudgeClient,
  judge,
  JudgeDefinitionError,
  JudgeModelError,
} from "../src/index.ts";
import type { BorrowedJudgeClientOptions } from "../src/index.ts";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const dictionary = parseTargetTagDictionary(
  await readFile(join(REPO_ROOT, "config/target-tags/keys.yaml"), "utf8"),
);

const target = {
  carrier: "fixture-carrier",
  channel: {
    wire: "openai-chat",
    baseUrl: "https://fixture.invalid/v1",
    provider: "fixture-provider",
    model: "fixture-model",
    apiKey: "fixture-secret",
  },
} satisfies ResolvedLiveTarget;

const CLEAN_CLI_TAGS = [
  "cli.execution.one-shot",
  "cli.execution.unattended",
  "cli.session.ephemeral",
  "cli.context.context-files.off",
  "cli.context.extensions.off",
  "cli.context.skills.off",
  "cli.tools.none",
  "cli.io.text",
];

const DEFAULT_PROVIDER_TAGS = [
  "provider.usage.api-payg",
  "provider.usage.third-party-subscription",
  "provider.usage.live.allowed",
];

interface CatalogOverrides {
  readonly cli?: boolean;
  readonly cliTags?: readonly string[];
  readonly providerTags?: readonly string[];
  readonly modelTags?: readonly string[];
  readonly extraCli?: boolean;
}

function catalogWith(overrides: CatalogOverrides = {}): TargetTagCatalog {
  const profiles =
    overrides.cli === false
      ? []
      : [
          {
            id: "fixture-cli",
            carrier: target.carrier,
            wires: [target.channel.wire],
            tags: overrides.cliTags ?? CLEAN_CLI_TAGS,
          },
        ];
  if (overrides.extraCli) {
    profiles.push({
      id: "fixture-cli-other",
      carrier: target.carrier,
      wires: [target.channel.wire],
      tags: overrides.cliTags ?? CLEAN_CLI_TAGS,
    });
  }
  return {
    dictionary,
    instances: {
      cli: profiles,
      providers: [
        {
          id: "fixture-provider",
          tags: overrides.providerTags ?? DEFAULT_PROVIDER_TAGS,
        },
      ],
      providerModels: [
        {
          id: "fixture-provider/fixture-model",
          providerRef: "fixture-provider",
          model: target.channel.model,
          modelRef: "fixture-canonical",
          wire: target.channel.wire,
          tags: ["provider-model.api.complete"],
        },
      ],
      models: [
        {
          id: "fixture-canonical",
          tags: overrides.modelTags ?? ["model.inference.chat"],
        },
      ],
    },
  };
}

function observation(
  text: string,
  toolCalls: Observation["toolCalls"] = [],
): Observation {
  return { text, toolCalls, toolCallsCount: toolCalls.length, events: [] };
}

function driverWith(
  sendPrompt: AgentDriver["sendPrompt"],
  log: string[],
): AgentDriver {
  return {
    async start() {
      log.push("start");
    },
    sendPrompt,
    events: async function* () {},
    async close() {
      log.push("close");
    },
  };
}

function borrowedOptions(
  createDriver: BorrowedJudgeClientOptions["createDriver"],
): BorrowedJudgeClientOptions {
  return { target, mode: "borrowed", tags: catalogWith(), createDriver };
}

test("TargetTags、遗留字段与不降级规则在执行前严格校验", () => {
  let factoryCalls = 0;
  let transportCalls = 0;
  const createDriver = () => {
    factoryCalls += 1;
    return driverWith(async () => observation("{}"), []);
  };
  const transport = async () => {
    transportCalls += 1;
    throw new Error("不应执行 transport");
  };
  const withoutLive = catalogWith({
    providerTags: [
      "provider.usage.api-payg",
      "provider.usage.third-party-subscription",
    ],
  });
  const borrowedOnly = catalogWith({
    providerTags: [
      "provider.usage.third-party-subscription",
      "provider.usage.live.allowed",
    ],
  });
  for (const options of [
    { ...borrowedOptions(createDriver), allowedModes: ["borrowed"] },
    { ...borrowedOptions(createDriver), createDriver: undefined },
    { ...borrowedOptions(createDriver), tags: withoutLive },
    { ...borrowedOptions(createDriver), cliRef: "missing" },
    { ...borrowedOptions(createDriver), toolPolicy: "read-only" },
    { target, tags: borrowedOnly, mode: "direct", transport },
  ]) {
    assert.throws(
      () => createJudgeClient(options as never),
      JudgeDefinitionError,
    );
  }
  assert.equal(factoryCalls, 0);
  assert.equal(transportCalls, 0);
});

test("双候选未明确 mode 时不按 transport/createDriver 猜选", () => {
  let factoryCalls = 0;
  const createDriver = () => {
    factoryCalls += 1;
    return driverWith(async () => observation("{}"), []);
  };
  assert.throws(
    () => createJudgeClient({ target, tags: catalogWith(), createDriver }),
    JudgeDefinitionError,
  );
  assert.equal(factoryCalls, 0);
});

test("唯一 direct/borrowed 候选允许省略 mode", () => {
  const direct = createJudgeClient({
    target,
    tags: catalogWith({ cli: false }),
    transport: async () => ({ status: 200, text: "{}" }),
  });
  assert.equal(direct.mode, "direct");
  const borrowed = createJudgeClient({
    target,
    tags: catalogWith({
      providerTags: [
        "provider.usage.third-party-subscription",
        "provider.usage.live.allowed",
      ],
    }),
    createDriver: () => driverWith(async () => observation("{}"), []),
  });
  assert.equal(borrowed.mode, "borrowed");
});

test("同 mode 多 profile 必须由 cliRef 唯一确定", () => {
  const options = {
    target,
    tags: catalogWith({ extraCli: true }),
    mode: "borrowed" as const,
    createDriver: () => driverWith(async () => observation("{}"), []),
  };
  assert.throws(() => createJudgeClient(options), JudgeDefinitionError);
  const client = createJudgeClient({ ...options, cliRef: "fixture-cli-other" });
  assert.equal(client.cliRef, "fixture-cli-other");
});

test("live review-required 仅本次显式审批放行", () => {
  const tags = catalogWith({
    providerTags: [
      "provider.usage.api-payg",
      "provider.usage.third-party-subscription",
      "provider.usage.live.review-required",
    ],
  });
  const options = {
    target,
    tags,
    mode: "borrowed" as const,
    createDriver: () => driverWith(async () => observation("{}"), []),
  };
  assert.throws(() => createJudgeClient(options), JudgeDefinitionError);
  const client = createJudgeClient({ ...options, liveReviewApproved: true });
  assert.equal(client.mode, "borrowed");
});

test("borrowed 不按非 live 计费分类过滤，其他准入与 direct 要求不变", () => {
  let factoryCalls = 0;
  const providerTags = [
    "provider.usage.api-credit",
    "provider.usage.live.review-required",
  ];
  const options = {
    target,
    mode: "borrowed" as const,
    tags: catalogWith({ providerTags }),
    liveReviewApproved: true,
    createDriver: () => {
      factoryCalls += 1;
      return driverWith(async () => observation("{}"), []);
    },
  };
  const rejects = (overrides: Partial<BorrowedJudgeClientOptions>) =>
    assert.throws(
      () => createJudgeClient({ ...options, ...overrides }),
      JudgeDefinitionError,
    );
  const client = createJudgeClient(options);
  assert.equal(client.mode, "borrowed");
  assert.equal(factoryCalls, 0);

  for (const [liveTag, approved] of [
    [undefined, true],
    ["provider.usage.live.disallowed", true],
    ["provider.usage.live.review-required", false],
  ] as const) {
    rejects({
      tags: catalogWith({
        providerTags: [
          "provider.usage.api-credit",
          ...(liveTag ? [liveTag] : []),
        ],
      }),
      liveReviewApproved: approved,
    });
  }

  for (const missing of [...CLEAN_CLI_TAGS, "model.inference.chat"]) {
    rejects({
      tags: catalogWith({
        providerTags,
        cliTags: CLEAN_CLI_TAGS.filter((tag) => tag !== missing),
        ...(missing === "model.inference.chat" ? { modelTags: [] } : {}),
      }),
    });
  }

  rejects({ tags: catalogWith({ providerTags, extraCli: true }) });
  assert.throws(
    () =>
      createJudgeClient({
        target,
        mode: "direct",
        tags: catalogWith({
          providerTags: [
            "provider.usage.third-party-subscription",
            "provider.usage.live.allowed",
          ],
        }),
      }),
    JudgeDefinitionError,
  );
  assert.equal(factoryCalls, 0);
});

test("borrowed 每次 attempt 新 driver，单发且 finally close；失败不切 direct", async () => {
  const log: string[] = [];
  const drivers: AgentDriver[] = [];
  const client = createJudgeClient(
    borrowedOptions(() => {
      const driver = driverWith(async (prompt) => {
        log.push("send");
        assert.match(prompt, /policy: judge-v1/);
        return observation('{"correct":true,"bounded":false}');
      }, log);
      drivers.push(driver);
      return driver;
    }),
  );
  assert.equal(client.mode, "borrowed");
  assert.equal(client.target, target);
  const result = await judge(
    {
      output: "answer",
      rubrics: [
        { name: "correct", rubric: "正确" },
        { name: "bounded", rubric: "完整" },
      ],
    },
    { client },
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(log, ["start", "send", "close"]);
  assert.equal(drivers.length, 1);
});

test("borrowed 重试使用全新 driver 且每个 attempt 都 close", async () => {
  const log: string[] = [];
  let creates = 0;
  const client = createJudgeClient(
    borrowedOptions(() => {
      creates += 1;
      return driverWith(async () => {
        log.push("send");
        if (creates === 1) throw new JudgeModelError("rate-limited", "429");
        return observation('{"correct":true}');
      }, log);
    }),
  );
  const result = await judge(
    { output: "x", rubrics: [{ name: "correct", rubric: "正确" }] },
    { client, maxRetries: 1 },
  );
  assert.equal(result.status, "completed");
  assert.equal(result.attempts, 2);
  assert.equal(creates, 2);
  assert.deepEqual(log, ["start", "send", "close", "start", "send", "close"]);
});

test("borrowed 工具调用与 close 失败分别归类 protocol 与 cleanup", async () => {
  for (const [closeFails, kind] of [
    [false, "protocol"],
    [true, "cleanup"],
  ] as const) {
    const client = createJudgeClient(
      borrowedOptions(() => ({
        ...driverWith(
          async () => observation("{}", [{ name: "shell", input: {} }]),
          [],
        ),
        async close() {
          if (closeFails) throw new Error("close failed");
        },
      })),
    );
    const result = await judge(
      { output: "x", rubrics: [{ name: "correct", rubric: "正确" }] },
      { client },
    );
    assert.equal(result.status, "not-evaluated");
    if (result.status === "not-evaluated")
      assert.equal(result.failure.kind, kind);
  }
});

test("read-only 仅选择 borrowed，保留工具证据并传递策略", async () => {
  const cliTags = CLEAN_CLI_TAGS.filter(
    (tag) => tag !== "cli.tools.none",
  ).concat("cli.tools.allowlist", "cli.tools.read-only");
  const contexts: { readonly toolPolicy?: string; readonly cliRef?: string }[] =
    [];
  const client = createJudgeClient({
    target,
    tags: catalogWith({ cliTags }),
    toolPolicy: "read-only",
    createDriver: (context) => {
      contexts.push(context);
      return driverWith(
        async () =>
          observation('{"correct":true}', [
            { name: "read", input: { path: "x" } },
          ]),
        [],
      );
    },
  });
  assert.equal(client.mode, "borrowed");
  const result = await judge(
    { output: "x", rubrics: [{ name: "correct", rubric: "正确" }] },
    { client },
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(
    contexts.map(({ toolPolicy }) => toolPolicy),
    ["read-only"],
  );
  assert.equal(contexts[0]?.cliRef, "fixture-cli");
});

test("direct 复用 LiveBackend，单 user message、无 tools、signal 到 transport", async () => {
  const signals: unknown[] = [];
  const bodies: unknown[] = [];
  const client = createJudgeClient({
    target,
    mode: "direct",
    tags: catalogWith(),
    transport: async (request) => {
      signals.push(request.signal);
      bodies.push(request.body);
      return {
        status: 200,
        text: JSON.stringify({
          choices: [{ message: { content: '{"correct":true}' } }],
        }),
      };
    },
  });
  const result = await judge(
    { output: "x", rubrics: [{ name: "correct", rubric: "正确" }] },
    { client },
  );
  assert.equal(result.status, "completed");
  assert.equal(client.mode, "direct");
  assert.ok(signals[0] instanceof AbortSignal);
  const body = bodies[0] as { messages: unknown[]; tools?: unknown };
  assert.equal(body.messages.length, 1);
  assert.equal("tools" in body, false);
});

test("direct 工具调用拒绝且不会回退 borrowed", async () => {
  const client = createJudgeClient({
    target,
    mode: "direct",
    tags: catalogWith(),
    transport: async () => ({
      status: 200,
      text: JSON.stringify({
        choices: [
          {
            message: {
              content: "{}",
              tool_calls: [
                {
                  id: "1",
                  type: "function",
                  function: { name: "shell", arguments: "{}" },
                },
              ],
            },
          },
        ],
      }),
    }),
  });
  const result = await judge(
    { output: "x", rubrics: [{ name: "correct", rubric: "正确" }] },
    { client },
  );
  assert.equal(result.status, "not-evaluated");
  if (result.status === "not-evaluated")
    assert.equal(result.failure.kind, "protocol");
});
