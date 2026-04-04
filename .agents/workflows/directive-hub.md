---
description: How to operate as a named agent in the Global Directive Hub — polling for voice directives, reporting back, and scheduling follow-up calls via the AWS middleware.
---

## Identity

Every agent that uses this workflow MUST have a unique, descriptive `AGENT_ID` that reflects exactly what it does and where it runs. Examples:

- `Agent_in_charge_of_backend_codespaces`
- `Agent_in_charge_of_frontend_firebasestudio`
- `Agent_in_charge_of_cicd_githubactions`
- `vscode-macbook-pro` (this machine)

When operating in this repo on the local Mac, the `AGENT_ID` is: **`vscode-macbook-pro`**

---

## Phase 1 — Check for a Directive Before Starting Any Work

At the start of every session, BEFORE doing anything else, use the `get_directive` MCP tool to check if there is a pending directive for this agent.

```
get_directive(agent_id="vscode-macbook-pro")
```

**Possible responses and how to act on each:**

| Status | Meaning | Action |
|---|---|---|
| `DIRECTIVE_AVAILABLE` | A voice directive is waiting | Read it. Confirm it back to the user in a brief summary. Then execute it. |
| `CALL_IN_PROGRESS` | A voice call is happening right now | Wait 30 seconds, poll again. Do not start new work. |
| `USER_MISSED_CALL` | The user didn't pick up | Inform the user in the IDE chat. Ask: "Should I trigger another call now, or wait?" |
| `USER_BUSY` | User was busy | Inform the user. Wait for manual trigger. |
| `SNOOZED` | User said "don't call me now" | Do not call. Wait quietly. Check again at next session start. |
| `CALLBACK_SCHEDULED` | A follow-up call is scheduled | Inform the user of the scheduled time. Proceed with other tasks if any. |
| `NO_DIRECTIVES` | Nothing pending | Proceed with last known context or ask the user in chat. |

---

## Phase 2 — Request a Voice Directive (When Needed)

When you need human input before proceeding — blocked on a decision, need a design choice, or have completed a task and need the next one — use the `trigger_call` MCP tool:

```
trigger_call(
  agent_id="vscode-macbook-pro",
  summary="[Brief description of what the agent finished or what decision it needs]"
)
```

**Good summary examples:**
- `"Finished migrating the database schema. Ready for next task."`
- `"Build is failing on the auth module — need a decision on the token strategy."`
- `"Completed the frontend layout. Should I start on the API integration or the auth flow first?"`

Then immediately switch to `wait_for_directive` to poll until the user responds by voice.

---

## Phase 3 — Wait for the Voice Response

After triggering a call, poll using `wait_for_directive`:

```
wait_for_directive(agent_id="vscode-macbook-pro", poll_interval_seconds=30)
```

- Poll every 30 seconds.
- If `USER_MISSED_CALL` comes back, inform the user in IDE chat and stop polling.
- If `CALLBACK_SCHEDULED` comes back, inform the user of the scheduled time and stop polling — the system will call back automatically.
- If `SNOOZED` comes back, stop all polling. Do not trigger another call unless the user manually runs the VS Code task.

---

## Phase 4 — Execute and Report Back

Once a directive arrives:

1. **Confirm** — Summarize the directive back to the user in the IDE chat before starting.
2. **Execute** — Carry out the task.
3. **Report** — When done, trigger a new call to report completion and ask for the next directive, using this summary format:
   ```
   trigger_call(
     agent_id="vscode-macbook-pro",
     summary="Completed: [what was done]. Ready for next instruction."
   )
   ```

The ElevenLabs agent will automatically ask the user about scheduling the follow-up at the end of the reporting call.

---

## State Reference

These are the full status values stored in DynamoDB. The agent should understand all of them:

| Status | Description |
|---|---|
| `CALL_IN_PROGRESS` | ElevenLabs is currently calling the user |
| `COMPLETED` | Directive received and stored |
| `DIRECTIVE_AVAILABLE` | Directive ready to be read by the agent |
| `USER_MISSED_CALL` | No answer — needs retry |
| `USER_BUSY` | User declined — needs manual retry |
| `SNOOZED` | User explicitly said "don't call me" |
| `CALLBACK_NOW` | User said call back immediately after finishing |
| `CALLBACK_SCHEDULED` | EventBridge rule created for a specific future time |
| `PENDING_MORNING_CALL` | Scheduled for next business morning (8 AM) |
| `NO_DIRECTIVES` | No records for this agent |

---

## API Reference

**Base URL:** `https://mrdbw1d3e9.execute-api.us-east-2.amazonaws.com/prod`

| Endpoint | Method | Purpose |
|---|---|---|
| `/trigger-call` | POST | Start a voice call to the user |
| `/get-directive` | GET | Poll for the latest directive |
| `/webhook` | POST | ElevenLabs callback (internal — do not call directly) |

Auth header required on all except `/webhook`: `Authorization: Bearer <BEARER_TOKEN>`

---

## Multi-Agent Rules

- Every agent only reads directives addressed to its own `AGENT_ID`. Never read another agent's directives.
- If you are a browser-based agent, set your `AGENT_ID` to something descriptive: `Agent_in_charge_of_backend_codespaces`, `Agent_in_charge_of_frontend_firebasestudio`, etc.
- The `AGENT_ID` must be consistent across all calls in a session. Don't change it mid-session.
- Multiple agents can be running simultaneously. They operate completely independently.
