import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";

function asString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new McpError(ErrorCode.InvalidParams, `Expected '${fieldName}' to be a non-empty string.`);
  }
  return value.trim();
}

function asOptionalString(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return asString(value, fieldName);
}

function asOptionalBoolean(value, fieldName) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new McpError(ErrorCode.InvalidParams, `Expected '${fieldName}' to be boolean.`);
  }
  return value;
}

function asOptionalNumber(value, fieldName) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new McpError(ErrorCode.InvalidParams, `Expected '${fieldName}' to be a positive number.`);
  }
  return value;
}

function asOptionalStringArray(value, fieldName) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new McpError(ErrorCode.InvalidParams, `Expected '${fieldName}' to be an array of strings.`);
  }

  return value;
}

function toToolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

export function createDirectiveServer(config, client) {
  const server = new Server(
    {
      name: "ide-directive-mcp-server",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "trigger_call",
        description: "Trigger an outbound call for this agent to capture a new directive.",
        inputSchema: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "Short reason for the call (for example, 'CI failed in prod build')."
            },
            session_id: {
              type: "string",
              description: "Optional idempotency/session key from your orchestration layer."
            },
            context: {
              type: "object",
              description: "Optional JSON context forwarded to middleware."
            }
          },
          required: ["summary"],
          additionalProperties: false
        }
      },
      {
        name: "get_directive",
        description: "Fetch the latest directive/state assigned to this AGENT_ID.",
        inputSchema: {
          type: "object",
          properties: {
            include_consumed: {
              type: "boolean",
              description: "Set true if middleware supports returning consumed directives."
            },
            session_id: {
              type: "string",
              description: "Filter by a specific session id if your API supports it."
            },
            since: {
              type: "string",
              description: "Optional timestamp filter for incremental fetches."
            }
          },
          additionalProperties: false
        }
      },
      {
        name: "wait_for_directive",
        description: "Poll for a directive until one arrives, a tracked status appears, or timeout occurs.",
        inputSchema: {
          type: "object",
          properties: {
            timeout_seconds: {
              type: "number",
              description: "Maximum wait time in seconds. Default: 600."
            },
            poll_interval_seconds: {
              type: "number",
              description: "Polling interval in seconds. Default from server config."
            },
            return_on_statuses: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional status values that should short-circuit the wait. Defaults: USER_MISSED_CALL, USER_BUSY."
            }
          },
          additionalProperties: false
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = request.params.arguments ?? {};

    try {
      switch (name) {
        case "trigger_call": {
          const summary = asString(args.summary, "summary");
          const sessionId = asOptionalString(args.session_id, "session_id");
          const context = args.context;
          if (context !== undefined && (typeof context !== "object" || context === null || Array.isArray(context))) {
            throw new McpError(ErrorCode.InvalidParams, "Expected 'context' to be a JSON object.");
          }
          const result = await client.triggerCall({ summary, sessionId, context });
          return toToolResult({
            agent_id: config.agentId,
            action: "trigger_call",
            result
          });
        }

        case "get_directive": {
          const result = await client.getDirective({
            includeConsumed: asOptionalBoolean(args.include_consumed, "include_consumed"),
            sessionId: asOptionalString(args.session_id, "session_id"),
            since: asOptionalString(args.since, "since")
          });

          return toToolResult({
            agent_id: config.agentId,
            action: "get_directive",
            result
          });
        }

        case "wait_for_directive": {
          const returnOnStatuses = asOptionalStringArray(args.return_on_statuses, "return_on_statuses");
          const result = await client.waitForDirective({
            timeoutSeconds: asOptionalNumber(args.timeout_seconds, "timeout_seconds"),
            pollIntervalSeconds: asOptionalNumber(args.poll_interval_seconds, "poll_interval_seconds"),
            returnOnStatuses
          });

          return toToolResult({
            agent_id: config.agentId,
            action: "wait_for_directive",
            result
          });
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : "Unexpected middleware error.";
      throw new McpError(ErrorCode.InternalError, message);
    }
  });

  return server;
}
