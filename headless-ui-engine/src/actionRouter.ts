import { execute, type UIAction } from "@/ai/uiActionEngine";
import type { ExecutionPolicy } from "@/ai/executionMode";

export type SystemAction = {
  type: `system.${string}`;
  target?: string;
  workflow?: string;
  payload?: Record<string, unknown>;
  retry?: number;
  timeout?: number;
  continueOnError?: boolean;
  executionPolicy?: ExecutionPolicy;
  requiresConfirmation?: boolean;
  previewOnly?: boolean;
};

export type AppAction = UIAction | SystemAction;

export type SystemActionHandler = (action: SystemAction) => Promise<unknown> | unknown;

let systemActionHandler: SystemActionHandler | null = null;

export function registerSystemActionHandler(handler: SystemActionHandler) {
  systemActionHandler = handler;
}

export async function routeAction(action: AppAction) {
  if (action.type.startsWith("ui.")) {
    return execute(action as UIAction);
  }

  if (action.type.startsWith("system.")) {
    if (!systemActionHandler) {
      console.info("[ActionRouter] System action queued without registered handler", action);
      return {
        ok: false,
        reason: "system-handler-not-registered",
        action,
      };
    }

    return systemActionHandler(action as SystemAction);
  }

  throw new Error(`Unsupported action type: ${String(action.type)}`);
}

export const actionRouter = {
  routeAction,
  registerSystemActionHandler,
};
