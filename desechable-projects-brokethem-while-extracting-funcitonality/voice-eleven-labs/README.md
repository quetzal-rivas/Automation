# Automation: IDE Directive MCP Server

MCP server for your IDE-side agent that talks to a centralized AWS middleware (`Lambda + DynamoDB + API Gateway`) using an `AGENT_ID`.

This server is designed for your "Global Directive Hub" flow:

- Trigger an outbound voice call (`trigger_call`).
- Poll and retrieve agent-specific directives (`get_directive`, `wait_for_directive`).
- Track state transitions (for example `CALL_IN_PROGRESS`, `USER_MISSED_CALL`, `USER_BUSY`, `COMPLETED`) while polling.

## Requirements

- Node.js `>=20`
- AWS middleware endpoints available over HTTPS

## Run With npx (Local Package)

From this repository root:

```bash
npx --yes . \
  --agent-id vscode-macbook-pro \
  --api-base-url https://<api-id>.execute-api.us-west-2.amazonaws.com/prod \
  --api-token <bearer-token>
```

## Environment Variables

You can pass config through env vars instead of CLI flags:

```bash
cp .env.example .env
export AGENT_ID=vscode-macbook-pro
export API_BASE_URL=https://<api-id>.execute-api.us-west-2.amazonaws.com/prod
export BEARER_TOKEN=<bearer-token>
npx --yes .
```

Optional env vars:

- `DIRECTIVE_TRIGGER_PATH` (default `/trigger-call`)
- `DIRECTIVE_GET_PATH` (default `/get-directive`)
- `DIRECTIVE_POLL_INTERVAL_SECONDS` (default `30`)
- `DIRECTIVE_REQUEST_TIMEOUT_MS` (default `15000`)
- Backward-compatible aliases are supported: `DIRECTIVE_API_BASE_URL`, `DIRECTIVE_API_TOKEN`, `API_BEARER_TOKEN`.
- `BEARER_TOKEN` may be raw token text or a full `Bearer <token>` string.

## MCP Client Example

```json
{
  "mcpServers": {
    "directiveHub": {
      "command": "npx",
      "args": [
        "--yes",
        "/Users/aztecgod/Active-Projects/Automation",
        "--agent-id",
        "vscode-macbook-pro",
        "--api-base-url",
        "https://<api-id>.execute-api.us-west-2.amazonaws.com/prod"
      ],
      "env": {
        "BEARER_TOKEN": "<bearer-token>"
      }
    }
  }
}
```

## Tool Contracts

The server expects these middleware endpoint shapes:

- `POST /trigger-call`
  - Body: `{ "agent_id": "...", "summary": "...", "context": {...}, "session_id": "..." }`
- `GET /get-directive?agent_id=...`
- `POST /webhook` exists in your backend but is internal to ElevenLabs callback flow and is not called by this MCP server.

If your response keys differ, this server still attempts to normalize common fields such as:
`directive|instruction|transcript`, `status|state`, `session_id|sessionId`.
