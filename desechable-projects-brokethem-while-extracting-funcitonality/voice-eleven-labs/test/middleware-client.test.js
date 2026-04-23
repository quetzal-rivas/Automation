import test from "node:test";
import assert from "node:assert/strict";
import { MiddlewareClient, normalizeDirectivePayload } from "../src/middleware-client.js";

test("normalizeDirectivePayload handles common key variants", () => {
  const normalized = normalizeDirectivePayload({
    instruction: "Change padding to 20px",
    state: "COMPLETED",
    sessionId: "abc-123",
    updatedAt: "2026-04-04T12:00:00Z"
  });

  assert.equal(normalized.hasDirective, true);
  assert.equal(normalized.directive, "Change padding to 20px");
  assert.equal(normalized.status, "COMPLETED");
  assert.equal(normalized.sessionId, "abc-123");
});

test("normalizeDirectivePayload supports array payloads", () => {
  const normalized = normalizeDirectivePayload([
    {
      transcript: "Use blue for primary button",
      status: "DIRECTIVE_READY",
      session_id: "xyz-789"
    }
  ]);

  assert.equal(normalized.directive, "Use blue for primary button");
  assert.equal(normalized.status, "DIRECTIVE_READY");
  assert.equal(normalized.sessionId, "xyz-789");
});

test("request does not double-prefix bearer token", async () => {
  const captured = { authorization: null };
  const client = new MiddlewareClient(
    {
      apiBaseUrl: "https://api.example.com",
      apiToken: "Bearer already-prefixed",
      agentId: "vscode-home",
      requestTimeoutMs: 1000,
      triggerPath: "/trigger-call",
      directivePath: "/get-directive",
      pollIntervalSeconds: 30
    },
    async (_url, init) => {
      captured.authorization = init.headers.authorization;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  );

  await client.getDirective();
  assert.equal(captured.authorization, "Bearer already-prefixed");
});
