import test from "node:test";
import assert from "node:assert/strict";
import { configInternals, loadConfig } from "../src/config.js";

test("loadConfig reads required env vars", () => {
  const config = loadConfig([], {
    AGENT_ID: "vscode-home",
    API_BASE_URL: "https://api.example.com/prod/"
  });

  assert.equal(config.agentId, "vscode-home");
  assert.equal(config.apiBaseUrl, "https://api.example.com/prod");
  assert.equal(config.triggerPath, "/trigger-call");
  assert.equal(config.pollIntervalSeconds, 30);
});

test("loadConfig allows CLI overrides", () => {
  const config = loadConfig(
    [
      "--agent-id",
      "ide-work",
      "--api-base-url=https://api.example.com/v1",
      "--poll-interval-seconds",
      "30"
    ],
    {}
  );

  assert.equal(config.agentId, "ide-work");
  assert.equal(config.apiBaseUrl, "https://api.example.com/v1");
  assert.equal(config.pollIntervalSeconds, 30);
});

test("parseAgentId rejects empty input", () => {
  assert.throws(() => configInternals.parseAgentId(""), /Missing agent ID/);
});

test("loadConfig reads BEARER_TOKEN alias", () => {
  const config = loadConfig([], {
    AGENT_ID: "ide-work",
    API_BASE_URL: "https://api.example.com",
    BEARER_TOKEN: "secret-token"
  });

  assert.equal(config.apiToken, "secret-token");
});
