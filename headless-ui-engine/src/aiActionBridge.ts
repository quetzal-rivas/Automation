import { actionPlanner, type PlanExecutionResult } from "@/ai/actionPlanner";
import { graphRouter } from "@/ai/graphRouter";
import type { AppAction } from "@/ai/actionRouter";
import { uiGraph } from "@/ai/uiGraph";
import { captureUISnapshot, getUIStateSnapshot } from "@/ai/uiActionEngine";

export type AICommandInput =
  | string
  | Record<string, unknown>
  | AppAction
  | Array<Record<string, unknown> | AppAction | string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toUiType(action: string) {
  const normalized = action.trim().toLowerCase();
  const mapped = normalized === "type" ? "fill" : normalized;
  return mapped.startsWith("ui.") || mapped.startsWith("system.") ? mapped : `ui.${mapped}`;
}

function normalizeCommand(input: AICommandInput): string | unknown {
  if (Array.isArray(input)) {
    return input.map((entry) => normalizeCommand(entry));
  }

  if (typeof input !== "object" || input === null) {
    return input;
  }

  const record = input as Record<string, unknown>;
  if (record.tool === "ui_action" && record.args) {
    return normalizeCommand(record.args as AICommandInput);
  }

  const action = record.action;
  if (typeof action !== "string") {
    return input;
  }

  const { action: _action, execution_policy, requires_confirmation, preview_only, ...rest } = record;
  return {
    ...rest,
    type: toUiType(action),
    executionPolicy: execution_policy === 'execute' || rest.executionPolicy === 'execute' ? 'execute' : rest.executionPolicy,
    requiresConfirmation: typeof requires_confirmation === 'boolean' ? requires_confirmation : rest.requiresConfirmation,
    previewOnly: typeof preview_only === 'boolean' ? preview_only : rest.previewOnly,
  };
}

function humanizeTarget(target?: string) {
  if (!target) {
    return "the requested area";
  }

  return target
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function narrationForAction(action: AppAction) {
  const target = humanizeTarget(action.target);

  switch (action.type) {
    case "ui.open":
      return `Opening ${target}`;
    case "ui.focus":
    case "ui.scroll":
      return `Focusing ${target}`;
    case "ui.highlight":
      return `Highlighting ${target}`;
    case "ui.click":
      return `Clicking ${target}`;
    case "ui.fill":
      return `Typing into ${target}`;
    default:
      return `Completed ${action.type}`;
  }
}

async function emitActionComplete(result: PlanExecutionResult) {
  if (typeof window === "undefined") {
    return;
  }

  const uiState = getUIStateSnapshot(result.action.target);
  const shouldCapture = result.success && ["ui.open", "ui.focus", "ui.highlight", "ui.click", "ui.fill"].includes(result.action.type);
  const snapshot = shouldCapture ? await captureUISnapshot({ target: result.action.target }) : null;

  window.dispatchEvent(
    new CustomEvent("ai-action-complete", {
      detail: {
        action: result.action,
        success: result.success,
        narration: narrationForAction(result.action),
        uiState,
        snapshot,
      },
    }),
  );
}

async function handleAICommand(command: AICommandInput) {
  const actions = graphRouter.resolveAICommandToPlan(normalizeCommand(command));

  if (!actions.length) {
    console.warn("[AIActionBridge] Ignored empty or invalid AI command", command);
    return [] as PlanExecutionResult[];
  }

  const results = await actionPlanner.run(actions);
  for (const result of results) {
    if (result.success) {
      uiGraph.recordAction(result.action);
    }
    await emitActionComplete(result);
  }
  return results;
}

export const aiActionBridge = {
  handleAICommand,
};
