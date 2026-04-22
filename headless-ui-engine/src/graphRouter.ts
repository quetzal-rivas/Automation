import { commandTranslator } from "@/ai/commandTranslator";
import type { AppAction } from "@/ai/actionRouter";
import { uiGraph } from "@/ai/uiGraph";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dedupeActions(actions: AppAction[]): AppAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = JSON.stringify(action);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function resolveAICommandToPlan(input: unknown): AppAction[] {
  if (Array.isArray(input)) {
    return dedupeActions(input.flatMap((entry) => resolveAICommandToPlan(entry)));
  }

  if (isRecord(input)) {
    const goal = typeof input.goal === "string" ? input.goal : undefined;
    if (goal) {
      const goalPlan = uiGraph.resolveGoal(goal, isRecord(input.params) ? input.params : input);
      if (goalPlan.length) {
        return dedupeActions(goalPlan);
      }
    }

    const node = typeof input.node === "string" ? input.node : undefined;
    if (node) {
      const route = uiGraph.getRouteActions(node);
      if (route.length) {
        return dedupeActions(route);
      }
    }
  }

  const translated = commandTranslator.translate(input) as AppAction[];
  const expanded: AppAction[] = translated.flatMap((action): AppAction[] => {
    if (!action.type.startsWith("ui.")) {
      return [action];
    }

    if ((action.type === "ui.open" || action.type === "ui.focus") && uiGraph.resolveNode(action.target)) {
      const route = uiGraph.getRouteActions(action.target);
      return route.length ? route : [action];
    }

    return [action];
  });

  return dedupeActions(expanded);
}

export const graphRouter = {
  resolveAICommandToPlan,
};
