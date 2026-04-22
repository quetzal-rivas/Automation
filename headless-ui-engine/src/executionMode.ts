export type ExecutionMode = 'IDLE' | 'DEMO' | 'GUIDED_ACTION';
export type ExecutionPolicy = 'preview' | 'execute';

export type ExecutionContext = {
  mode: ExecutionMode;
  policy: ExecutionPolicy;
  source: 'system' | 'landing-demo' | 'dashboard-copilot';
  updatedAt: number;
};

export type ExecutionActionLike = {
  type?: string;
  executionPolicy?: ExecutionPolicy;
  requiresConfirmation?: boolean;
  previewOnly?: boolean;
};

const EXECUTION_MODE_EVENT = 'academy-ai:execution-mode';

let currentExecutionContext: ExecutionContext = {
  mode: 'IDLE',
  policy: 'preview',
  source: 'system',
  updatedAt: Date.now(),
};

function broadcastExecutionContext() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(EXECUTION_MODE_EVENT, {
    detail: currentExecutionContext,
  }));
}

export function getExecutionContext() {
  return currentExecutionContext;
}

export function setExecutionContext(next: {
  mode: ExecutionMode;
  policy?: ExecutionPolicy;
  source?: ExecutionContext['source'];
}) {
  currentExecutionContext = {
    mode: next.mode,
    policy: next.policy ?? currentExecutionContext.policy ?? 'preview',
    source: next.source ?? 'system',
    updatedAt: Date.now(),
  };

  broadcastExecutionContext();
  return currentExecutionContext;
}

export function resetExecutionContext(source: ExecutionContext['source'] = 'system') {
  return setExecutionContext({
    mode: 'IDLE',
    policy: 'preview',
    source,
  });
}

export function subscribeExecutionContext(listener: (context: ExecutionContext) => void) {
  if (typeof window === 'undefined') {
    listener(currentExecutionContext);
    return () => undefined;
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ExecutionContext>).detail;
    listener(detail ?? currentExecutionContext);
  };

  listener(currentExecutionContext);
  window.addEventListener(EXECUTION_MODE_EVENT, handler);

  return () => {
    window.removeEventListener(EXECUTION_MODE_EVENT, handler);
  };
}

export function resolveExecutionPolicyForAction(action?: ExecutionActionLike | null) {
  if (action?.previewOnly) {
    return 'preview' as const;
  }

  return action?.executionPolicy ?? currentExecutionContext.policy;
}

export function shouldBlockActionForExecutionMode(action?: ExecutionActionLike | null) {
  if (!action?.type) {
    return null;
  }

  const policy = resolveExecutionPolicyForAction(action);

  if (action.requiresConfirmation && policy !== 'execute') {
    return 'confirmation-required';
  }

  if (action.type.startsWith('system.') && policy !== 'execute') {
    return 'preview-policy-blocked';
  }

  return null;
}

export function describeExecutionContext(context = currentExecutionContext) {
  return `${context.mode.toLowerCase()}:${context.policy}`;
}

export const executionMode = {
  eventName: EXECUTION_MODE_EVENT,
  get: getExecutionContext,
  set: setExecutionContext,
  reset: resetExecutionContext,
  subscribe: subscribeExecutionContext,
};
