import type { UIAction } from "@/ai/uiActionEngine";

export function toAiTarget(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export type DashboardSectionDefinition = {
  title: string;
  target: string;
  routeSegment?: string;
  aliases?: string[];
  focusTarget?: string;
  highlightTarget?: string;
  relatedTargets?: string[];
};

export const sharedDashboardSections: DashboardSectionDefinition[] = [
  {
    title: "Overview",
    target: "overview",
    routeSegment: "",
    aliases: ["home", "dashboard"],
  },
  {
    title: "Lead Management",
    target: "lead-management",
    routeSegment: "leads",
    aliases: ["leads", "crm"],
    focusTarget: "lead-registry",
    highlightTarget: "lead-registry",
    relatedTargets: ["lead-registry"],
  },
  {
    title: "Tactical Automations",
    target: "tactical-automations",
    routeSegment: "automations",
    aliases: ["automations"],
    highlightTarget: "automation-matrix",
    relatedTargets: ["automation-matrix"],
  },
  {
    title: "Landing Page",
    target: "landing-page",
    routeSegment: "landing-page",
    aliases: ["landing", "site"],
  },
  {
    title: "Conversations",
    target: "conversations",
    routeSegment: "conversations",
    aliases: ["messages", "inbox"],
  },
  {
    title: "Class Command",
    target: "class-command",
    routeSegment: "classes",
    aliases: ["schedule", "classes"],
  },
  {
    title: "Ad Deployment",
    target: "ad-deployment",
    routeSegment: "ads",
    aliases: ["ads", "campaigns"],
    focusTarget: "campaign-name",
    highlightTarget: "create-campaign",
    relatedTargets: ["campaign-builder", "campaign-name", "create-campaign"],
  },
  {
    title: "Voice Dispatch",
    target: "voice-dispatch",
    routeSegment: "voice",
    aliases: ["voice"],
    focusTarget: "voice-panel",
    highlightTarget: "voice-panel",
    relatedTargets: ["voice-panel"],
  },
  {
    title: "Billing Hub",
    target: "billing-hub",
    routeSegment: "billing",
    aliases: ["billing", "invoices"],
    focusTarget: "invoices-panel",
    highlightTarget: "invoices-panel",
    relatedTargets: ["invoices-panel"],
  },
  {
    title: "Compliance Hub",
    target: "compliance-hub",
    routeSegment: "compliance",
    aliases: ["compliance"],
  },
  {
    title: "Engagement Policy",
    target: "engagement-policy",
    routeSegment: "engagement-policy",
    aliases: ["policy", "engagement"],
  },
  {
    title: "Integrations",
    target: "integrations",
    routeSegment: "settings",
    aliases: ["settings", "connections"],
  },
];

export const demoDashboardUiMap = {
  initialSection: sharedDashboardSections[0]?.title ?? "Overview",
  navItems: sharedDashboardSections.map((section) => ({
    title: section.title,
    target: section.target,
  })),
  sectionByTarget: sharedDashboardSections.reduce<Record<string, string>>((acc, section) => {
    const keys = [
      section.target,
      ...(section.aliases ?? []),
      ...(section.relatedTargets ?? []),
    ];

    for (const key of keys) {
      acc[key] = section.title;
    }

    return acc;
  }, {}),
};

export function createTenantDashboardUiMap(basePath: string) {
  return sharedDashboardSections.map((section) => ({
    title: section.title,
    target: section.target,
    href: section.routeSegment ? `${basePath}/${section.routeSegment}` : basePath,
  }));
}

export function createEnterActions(section: DashboardSectionDefinition): UIAction[] {
  const actions: UIAction[] = [
    { type: "ui.open", target: section.target, continueOnError: true },
  ];

  if (section.focusTarget) {
    actions.push({ type: "ui.focus", target: section.focusTarget, continueOnError: true });
  }

  actions.push({
    type: "ui.highlight",
    target: section.highlightTarget ?? section.focusTarget ?? section.target,
    continueOnError: true,
  });

  return actions;
}

export function resolveDashboardPageTarget(page?: string) {
  const normalized = toAiTarget(page ?? "");
  if (!normalized) {
    return "overview";
  }

  const matched = sharedDashboardSections.find((section) => {
    return section.target === normalized
      || section.routeSegment === normalized
      || section.aliases?.includes(normalized)
      || section.relatedTargets?.includes(normalized);
  });

  return matched?.target ?? "overview";
}
