import type { AppAction } from "@/ai/actionRouter";
import type { UIAction } from "@/ai/uiActionEngine";
import { aiUiRegistry } from "@/ai/uiRegistry";
import { createEnterActions, sharedDashboardSections, toAiTarget } from "@/ai/uiMaps";

export type UIGraphNode = {
  id: string;
  label: string;
  type: "page" | "panel" | "flow";
  aliases?: string[];
  enterActions: UIAction[];
  edges?: Record<string, { to: string; actions: UIAction[] }>;
};

const graphNodes: Record<string, UIGraphNode> = Object.fromEntries(
  sharedDashboardSections.map((section) => {
    const registryEntry = aiUiRegistry.resolve(section.target);

    return [
      section.target,
      {
        id: section.target,
        label: section.title,
        type: "page" as const,
        aliases: registryEntry?.aliases ?? [...(section.aliases ?? []), ...(section.relatedTargets ?? [])],
        enterActions: createEnterActions(section),
      },
    ];
  }),
);

let currentNode = "overview";

function normalizeKey(value?: string) {
  return toAiTarget(value ?? "");
}

function resolveNode(target?: string) {
  const normalized = normalizeKey(target);
  if (!normalized) {
    return undefined;
  }

  if (graphNodes[normalized]) {
    return normalized;
  }

  const registryEntry = aiUiRegistry.resolve(normalized);
  if (registryEntry?.parent && graphNodes[registryEntry.parent]) {
    return registryEntry.parent;
  }

  if (registryEntry?.id && graphNodes[registryEntry.id]) {
    return registryEntry.id;
  }

  return Object.values(graphNodes).find((node) => node.aliases?.includes(normalized))?.id;
}

function getRouteActions(target?: string): UIAction[] {
  const nodeId = resolveNode(target);
  if (!nodeId) {
    return [] as UIAction[];
  }

  if (nodeId === currentNode) {
    return [
      { type: "ui.focus", target: target ?? nodeId, continueOnError: true },
      { type: "ui.highlight", target: target ?? nodeId, continueOnError: true },
    ];
  }

  const current = graphNodes[currentNode];
  const edge = current?.edges?.[nodeId];
  return edge?.actions ?? graphNodes[nodeId].enterActions;
}

function resolveGoal(goal?: string, params?: Record<string, unknown>): UIAction[] {
  const normalized = normalizeKey(goal);
  if (!normalized) {
    return [] as UIAction[];
  }

  if (normalized === "create_campaign" || normalized.includes("create-campaign")) {
    const name = typeof params?.name === "string" ? params.name : typeof params?.value === "string" ? params.value : "Summer Campaign";
    return [
      ...getRouteActions("ad-deployment"),
      { type: "ui.fill", target: "campaign-name", value: name, continueOnError: true },
      { type: "ui.highlight", target: "create-campaign", continueOnError: true },
      { type: "ui.click", target: "create-campaign", continueOnError: true },
    ];
  }

  if (normalized === "review_leads" || normalized.includes("review-leads")) {
    return getRouteActions("lead-management");
  }

  if (normalized === "open_billing" || normalized.includes("open-billing")) {
    return getRouteActions("billing-hub");
  }

  const registryEntry = aiUiRegistry.resolve(normalized);
  if (registryEntry) {
    return getRouteActions(registryEntry.parent ?? registryEntry.id);
  }

  return [] as UIAction[];
}

function recordAction(action: AppAction) {
  const nextNode = resolveNode(action.target);
  if (nextNode) {
    currentNode = nextNode;
  }
}

export const uiGraph = {
  nodes: graphNodes,
  resolveNode,
  getRouteActions,
  resolveGoal,
  recordAction,
  getCurrentNode: () => currentNode,
};
