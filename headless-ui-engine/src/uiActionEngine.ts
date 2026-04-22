import { aiCursor } from "@/ai/aiCursor";

export type UIActionType =
  | "ui.focus"
  | "ui.open"
  | "ui.highlight"
  | "ui.click"
  | "ui.fill"
  | "ui.scroll"
  | "ui.wait";

export type UIAction = {
  type: UIActionType;
  target?: string;
  value?: string;
  ms?: number;
  retry?: number;
  timeout?: number;
  continueOnError?: boolean;
  executionPolicy?: 'preview' | 'execute';
  requiresConfirmation?: boolean;
  previewOnly?: boolean;
};

export type UIActionListener = (action: UIAction) => boolean | void | Promise<boolean | void>;

export type UIElementState = {
  target: string | null;
  exists: boolean;
  visible: boolean;
  tagName: string | null;
  text: string;
  value: string;
  classes: string[];
  rect: { x: number; y: number; width: number; height: number } | null;
};

export type UISnapshotState = {
  timestamp: string;
  activePath: string;
  title: string;
  target: string | null;
  targetState: UIElementState;
  highlightedTargets: string[];
  visibleTargets: string[];
  scroll: { x: number; y: number };
};

export type UISnapshotArtifact = {
  target: string | null;
  mimeType: string;
  dataUrl: string;
  summary: string;
  state: UISnapshotState;
};

const uiActionListeners = new Set<UIActionListener>();
const DEFAULT_WAIT_MS = 600;
const DEFAULT_EFFECT_MS = 3200;
const effectTimers = new WeakMap<HTMLElement, Map<string, number>>();

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function escapeTarget(target: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(target);
  }

  return target.replace(/"/g, '\\"');
}

function findTargetElement(target?: string) {
  if (typeof document === "undefined" || !target) {
    return null;
  }

  return document.querySelector<HTMLElement>(`[data-ai="${escapeTarget(target)}"]`);
}

function getVisibleTargets(limit = 12) {
  if (typeof document === "undefined") {
    return [] as string[];
  }

  return Array.from(document.querySelectorAll<HTMLElement>("[data-ai]"))
    .map((element) => ({
      target: element.dataset.ai || "",
      rect: element.getBoundingClientRect(),
    }))
    .filter((entry) => entry.target && entry.rect.width > 0 && entry.rect.height > 0)
    .slice(0, limit)
    .map((entry) => entry.target);
}

function serializeElementState(element: HTMLElement | null, target?: string): UIElementState {
  if (!element) {
    return {
      target: target ?? null,
      exists: false,
      visible: false,
      tagName: null,
      text: "",
      value: "",
      classes: [],
      rect: null,
    };
  }

  const rect = element.getBoundingClientRect();
  const isVisible = rect.width > 0 && rect.height > 0;
  const textContent = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 220);
  const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.value.slice(0, 220)
    : "";

  return {
    target: target ?? element.dataset.ai ?? null,
    exists: true,
    visible: isVisible,
    tagName: element.tagName.toLowerCase(),
    text: textContent,
    value,
    classes: Array.from(element.classList).slice(0, 12),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

export function getUIStateSnapshot(target?: string): UISnapshotState {
  const element = findTargetElement(target);
  const highlightedTargets = typeof document === "undefined"
    ? []
    : Array.from(document.querySelectorAll<HTMLElement>("[data-ai].ai-highlight, [data-ai].ai-focus"))
        .map((entry) => entry.dataset.ai || "")
        .filter(Boolean)
        .slice(0, 8);

  return {
    timestamp: new Date().toISOString(),
    activePath: typeof window === "undefined" ? "" : window.location.pathname,
    title: typeof document === "undefined" ? "" : document.title,
    target: target ?? null,
    targetState: serializeElementState(element, target),
    highlightedTargets,
    visibleTargets: getVisibleTargets(),
    scroll: {
      x: typeof window === "undefined" ? 0 : Math.round(window.scrollX),
      y: typeof window === "undefined" ? 0 : Math.round(window.scrollY),
    },
  };
}

function buildSnapshotSummary(state: UISnapshotState) {
  const text = state.targetState.text || state.targetState.value || "No readable text";
  return [
    `Path: ${state.activePath || "/"}`,
    `Target: ${state.targetState.target || "viewport"}`,
    `Visible: ${state.targetState.visible ? "yes" : "no"}`,
    `Text: ${text.slice(0, 120)}`,
    `Highlights: ${state.highlightedTargets.join(", ") || "none"}`,
  ].join(" | ");
}

export async function captureUISnapshot(options?: { target?: string }): Promise<UISnapshotArtifact | null> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  const state = getUIStateSnapshot(options?.target);
  const summary = buildSnapshotSummary(state);
  const width = 640;
  const height = 360;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return null;
  }

  ctx.fillStyle = "#050816";
  ctx.fillRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#991b1b");
  gradient.addColorStop(1, "#111827");
  ctx.fillStyle = gradient;
  ctx.fillRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.fillStyle = "#f9fafb";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("Academy Pilot UI Verification", 32, 52);

  ctx.fillStyle = "#fca5a5";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText(`Target: ${state.targetState.target || "viewport"}`, 32, 84);

  ctx.fillStyle = "#e5e7eb";
  ctx.font = "13px sans-serif";
  const lines = [
    `Path: ${state.activePath || "/"}`,
    `Visible targets: ${state.visibleTargets.join(", ") || "none"}`,
    `Highlights: ${state.highlightedTargets.join(", ") || "none"}`,
    `Rect: ${state.targetState.rect ? `${state.targetState.rect.x}, ${state.targetState.rect.y}, ${state.targetState.rect.width}x${state.targetState.rect.height}` : "n/a"}`,
    `Text: ${(state.targetState.text || state.targetState.value || "No readable content").slice(0, 180)}`,
  ];

  lines.forEach((line, index) => {
    ctx.fillText(line, 32, 118 + index * 28, width - 64);
  });

  const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  return {
    target: options?.target ?? null,
    mimeType: "image/jpeg",
    dataUrl,
    summary,
    state,
  };
}

function dispatchUIStateEvent(detail: Record<string, unknown>) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent("ai-ui-state", { detail }));
}

function addTransientClass(element: HTMLElement, className: string, duration = DEFAULT_EFFECT_MS, target?: string) {
  const timers = effectTimers.get(element) ?? new Map<string, number>();
  effectTimers.set(element, timers);

  const existingTimer = timers.get(className);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  element.classList.add(className);
  dispatchUIStateEvent({
    phase: "started",
    className,
    target: target ?? element.dataset.ai ?? null,
    state: getUIStateSnapshot(target ?? element.dataset.ai),
  });

  const timeoutId = window.setTimeout(() => {
    element.classList.remove(className);
    timers.delete(className);
    dispatchUIStateEvent({
      phase: "completed",
      className,
      target: target ?? element.dataset.ai ?? null,
      state: getUIStateSnapshot(target ?? element.dataset.ai),
    });
  }, Math.max(duration, 250));

  timers.set(className, timeoutId);
}

function dispatchNativeClick(element: HTMLElement) {
  element.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    })
  );
}

async function typeIntoElement(element: HTMLInputElement | HTMLTextAreaElement, text: string) {
  element.focus();
  element.value = "";

  for (const character of text) {
    element.value += character;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await delay(35);
  }

  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function notifyListeners(action: UIAction) {
  let handled = false;

  for (const listener of uiActionListeners) {
    const result = await listener(action);
    if (result) {
      handled = true;
    }
  }

  return handled;
}

async function settleOnElement(element: HTMLElement) {
  element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
  await aiCursor.moveTo(element);
}

export function subscribeToUIActions(listener: UIActionListener) {
  uiActionListeners.add(listener);
  return () => {
    uiActionListeners.delete(listener);
  };
}

export async function execute(action: UIAction) {
  if (typeof window === "undefined") {
    return false;
  }

  if (action.type === "ui.wait") {
    await delay(action.ms ?? DEFAULT_WAIT_MS);
    return true;
  }

  const handledSemantically = await notifyListeners(action);
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));

  const element = findTargetElement(action.target);

  switch (action.type) {
    case "ui.focus":
    case "ui.scroll": {
      if (!element) {
        return handledSemantically;
      }

      await settleOnElement(element);
      addTransientClass(element, "ai-focus", action.ms ?? DEFAULT_EFFECT_MS, action.target);
      return true;
    }

    case "ui.open": {
      if (element) {
        await settleOnElement(element);
        addTransientClass(element, "ai-focus", action.ms ?? DEFAULT_EFFECT_MS, action.target);
        await aiCursor.click(element, handledSemantically ? undefined : () => dispatchNativeClick(element));
      }

      return handledSemantically || Boolean(element);
    }

    case "ui.highlight": {
      if (!element) {
        return handledSemantically;
      }

      await aiCursor.moveTo(element);
      aiCursor.hover(element);
      addTransientClass(element, "ai-highlight", action.ms ?? DEFAULT_EFFECT_MS, action.target);
      return true;
    }

    case "ui.click": {
      if (element) {
        await settleOnElement(element);
        addTransientClass(element, "ai-highlight", action.ms ?? DEFAULT_EFFECT_MS, action.target);
        await aiCursor.click(element, handledSemantically ? undefined : () => dispatchNativeClick(element));
      }

      return handledSemantically || Boolean(element);
    }

    case "ui.fill": {
      if (!element) {
        return handledSemantically;
      }

      await settleOnElement(element);
      aiCursor.hover(element);
      addTransientClass(element, "ai-highlight", DEFAULT_EFFECT_MS, action.target);
      const value = action.value ?? "";

      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        await typeIntoElement(element, value);
        return true;
      }

      if (element.isContentEditable) {
        element.textContent = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }

      return handledSemantically;
    }

    default:
      return false;
  }
}

export const uiActionEngine = {
  execute,
  subscribe: subscribeToUIActions,
  getStateSnapshot: getUIStateSnapshot,
  captureSnapshot: captureUISnapshot,
};
