import type { AppAction, SystemAction } from "@/ai/actionRouter";
import type { UIAction } from "@/ai/uiActionEngine";

const allowedUICommands = new Set(["focus", "open", "highlight", "click", "fill", "scroll", "wait"]);
const safeTargetPattern = /^[a-z0-9:_-]+$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeTarget(value?: string) {
  if (!value) {
    return undefined;
  }

  const cleaned = value.trim().toLowerCase();
  return safeTargetPattern.test(cleaned) ? cleaned : undefined;
}

function normalizeActionType(rawType: string): AppAction["type"] | null {
  const cleaned = rawType.trim().replace(/^\/?#?/, "").toLowerCase();

  if (cleaned.startsWith("ui.") || cleaned.startsWith("system.")) {
    return cleaned as AppAction["type"];
  }

  if (allowedUICommands.has(cleaned)) {
    return `ui.${cleaned}` as UIAction["type"];
  }

  return null;
}

function toStructuredAction(candidate: unknown): AppAction | null {
  if (!isRecord(candidate) || typeof candidate.type !== "string") {
    return null;
  }

  const type = normalizeActionType(candidate.type);
  if (!type) {
    return null;
  }

  const common = {
    type,
    target: sanitizeTarget(typeof candidate.target === "string" ? candidate.target : undefined),
    retry: typeof candidate.retry === "number" ? candidate.retry : undefined,
    timeout: typeof candidate.timeout === "number" ? candidate.timeout : undefined,
    continueOnError: typeof candidate.continueOnError === "boolean" ? candidate.continueOnError : undefined,
    executionPolicy: candidate.executionPolicy === "execute" || candidate.execution_policy === "execute" ? "execute" : "preview",
    requiresConfirmation: typeof candidate.requiresConfirmation === "boolean"
      ? candidate.requiresConfirmation
      : typeof candidate.requires_confirmation === "boolean"
        ? candidate.requires_confirmation
        : undefined,
    previewOnly: typeof candidate.previewOnly === "boolean"
      ? candidate.previewOnly
      : typeof candidate.preview_only === "boolean"
        ? candidate.preview_only
        : undefined,
  };

  if (type.startsWith("system.")) {
    return {
      ...common,
      workflow: typeof candidate.workflow === "string" ? candidate.workflow : undefined,
      payload: isRecord(candidate.payload) ? candidate.payload : undefined,
    } as SystemAction;
  }

  return {
    ...common,
    value: typeof candidate.value === "string" ? candidate.value : undefined,
    ms: typeof candidate.ms === "number" ? candidate.ms : undefined,
  } as UIAction;
}

function parseCommandSegment(segment: string): AppAction | null {
  const normalized = segment.replace(/^#/, "").trim();
  if (!normalized) {
    return null;
  }

  const [rawCommand, ...rest] = normalized.split(/\s+/);
  const type = normalizeActionType(rawCommand);

  if (!type) {
    return null;
  }

  if (type === "ui.wait") {
    const ms = Number(rest[0]);
    return {
      type,
      ms: Number.isFinite(ms) ? ms : 600,
    } as UIAction;
  }

  const remainder = rest.join(" ").trim();

  if (type === "ui.fill") {
    const match = remainder.match(/^([a-z0-9:_-]+)\s+(.+)$/i);
    if (!match) {
      return null;
    }

    const target = sanitizeTarget(match[1]);
    if (!target) {
      return null;
    }

    return {
      type,
      target,
      value: match[2].replace(/^['"]|['"]$/g, ""),
    } as UIAction;
  }

  const target = sanitizeTarget(remainder);
  if (!target) {
    return null;
  }

  return {
    type: type as UIAction["type"],
    target,
  };
}

export function translateCommands(input: string | unknown): AppAction[] {
  if (Array.isArray(input)) {
    return input.map(toStructuredAction).filter((action): action is AppAction => Boolean(action));
  }

  if (typeof input !== "string") {
    const action = toStructuredAction(input);
    return action ? [action] : [];
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return translateCommands(parsed);
    } catch {
      return [];
    }
  }

  const segments = trimmed.includes("/#")
    ? trimmed.split("/#").map((segment) => segment.trim()).filter(Boolean)
    : trimmed.split(/\r?\n+/).map((segment) => segment.trim()).filter(Boolean);

  return segments.map(parseCommandSegment).filter((action): action is AppAction => Boolean(action));
}

export const commandTranslator = {
  translate: translateCommands,
};
