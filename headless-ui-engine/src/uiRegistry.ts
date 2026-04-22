import { sharedDashboardSections, toAiTarget, type DashboardSectionDefinition } from "@/ai/uiMaps";

export type AIUIRegistryAction = "focus" | "open" | "highlight" | "click" | "fill" | "scroll" | "wait" | "simulate";

export type AIUIRegistryEntry = {
  id: string;
  title: string;
  type: "module" | "panel" | "control" | "flow";
  actions: AIUIRegistryAction[];
  children: string[];
  aliases: string[];
  routeSegment?: string;
  parent?: string;
  focusTarget?: string;
  highlightTarget?: string;
};

function unique(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)));
}

function buildModuleEntry(section: DashboardSectionDefinition): AIUIRegistryEntry {
  return {
    id: section.target,
    title: section.title,
    type: "module",
    actions: ["open", "focus", "highlight", "scroll"],
    children: unique([
      section.focusTarget,
      section.highlightTarget,
      ...(section.relatedTargets ?? []),
    ]),
    aliases: unique([section.target, section.routeSegment, ...(section.aliases ?? [])]),
    routeSegment: section.routeSegment,
    focusTarget: section.focusTarget,
    highlightTarget: section.highlightTarget,
  };
}

function buildChildEntries(section: DashboardSectionDefinition): AIUIRegistryEntry[] {
  const childIds = unique([
    section.focusTarget,
    section.highlightTarget,
    ...(section.relatedTargets ?? []),
  ]);

  return childIds.map((childId) => ({
    id: childId,
    title: childId.split(/[-_]/g).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
    type: "panel",
    actions: ["focus", "highlight", "click", "fill", "scroll"],
    children: [],
    aliases: unique([childId, toAiTarget(childId)]),
    parent: section.target,
  }));
}

const registryEntries = [
  ...sharedDashboardSections.map(buildModuleEntry),
  ...sharedDashboardSections.flatMap(buildChildEntries),
];

const registryMap = new Map<string, AIUIRegistryEntry>();
for (const entry of registryEntries) {
  registryMap.set(entry.id, entry);
}

function resolve(target?: string) {
  const normalized = toAiTarget(target ?? "");
  if (!normalized) {
    return undefined;
  }

  if (registryMap.has(normalized)) {
    return registryMap.get(normalized);
  }

  return registryEntries.find((entry) => entry.aliases.includes(normalized));
}

function can(action: AIUIRegistryAction, target?: string) {
  const entry = resolve(target);
  return Boolean(entry?.actions.includes(action));
}

function getChildren(target?: string) {
  return resolve(target)?.children ?? [];
}

function list(type?: AIUIRegistryEntry["type"]) {
  return type ? registryEntries.filter((entry) => entry.type === type) : [...registryEntries];
}

export const aiUiRegistry = {
  entries: registryEntries,
  map: registryMap,
  resolve,
  can,
  getChildren,
  list,
};
