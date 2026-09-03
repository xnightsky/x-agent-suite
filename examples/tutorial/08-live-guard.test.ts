/**
 * @module examples/tutorial/08-live-guard
 * live 安全门的零网络演示：默认阻断，诊断脱敏，transport 不被调用。
 */
import {
  redactLiveSecrets,
  type LiveChannel,
} from "@x-agent-suite/llm-fixture";
import { printTutorialSummary } from "./support.ts";

const AUTHORIZATION = "I_ACCEPT_LIVE_COST_AND_DATA_EGRESS";
const channel: LiveChannel = {
  wire: "openai-chat",
  baseUrl: "https://private-provider.example.test/v1",
  model: "tutorial-live",
  apiKey: "tutorial-secret-key",
};
const authorized =
  process.env.XAS_TUTORIAL_LIVE_AUTHORIZATION === AUTHORIZATION;
let transportInvoked = false;

if (authorized) {
  // 这里仍只允许注入式假 transport；真实网络必须移入 *.token.ittest.ts。
  const syntheticTransport = async (): Promise<{
    status: number;
    text: string;
  }> => {
    transportInvoked = true;
    return { status: 200, text: "{}" };
  };
  await syntheticTransport();
}

const diagnostic = redactLiveSecrets(
  `blocked ${channel.baseUrl}; authorization=${channel.apiKey}`,
  [channel],
);
const redacted =
  !diagnostic.includes(channel.baseUrl) &&
  !diagnostic.includes(channel.apiKey ?? "") &&
  diagnostic.includes("[REDACTED]");

printTutorialSummary({
  recipe: "live-guard",
  authorized,
  networkAttempted: false,
  transportInvoked,
  redacted,
});
