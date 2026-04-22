import { getExecutionContext, shouldBlockActionForExecutionMode } from "@/ai/executionMode";
import { routeAction, type AppAction } from "@/ai/actionRouter";

export type PlanExecutionResult = {
  action: AppAction;
  success: boolean;
  error?: unknown;
};

function withTimeout<T>(promise: Promise<T>, ms?: number) {
  if (!ms) {
    return promise;
  }

  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`Action timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function runActionWithRetry(action: AppAction) {
  const attempts = Math.max(1, (action.retry ?? 0) + 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await withTimeout(Promise.resolve(routeAction(action)), action.timeout);

      if (
        result === false ||
        (typeof result === "object" && result !== null && "ok" in result && (result as { ok?: boolean }).ok === false)
      ) {
        console.warn("[ActionPlanner] Action skipped or not handled cleanly", action, result);
      }

      return result;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
    }
  }

  throw lastError;
}

export class ActionPlanner {
  private queue = Promise.resolve<PlanExecutionResult[]>([]);

  run(actions: AppAction[]) {
    const nextRun = this.queue.then(async () => {
      const results: PlanExecutionResult[] = [];

      for (const action of actions) {
        const blockedReason = shouldBlockActionForExecutionMode(action);

        if (blockedReason) {
          const context = getExecutionContext();
          results.push({
            action,
            success: false,
            error: new Error(`Action blocked by ${context.mode.toLowerCase()} ${context.policy} policy: ${blockedReason}`),
          });

          if (!action.continueOnError) {
            break;
          }

          continue;
        }

        try {
          await runActionWithRetry(action);
          results.push({ action, success: true });
        } catch (error) {
          results.push({ action, success: false, error });
          if (!action.continueOnError) {
            break;
          }
        }
      }

      return results;
    });

    this.queue = nextRun.catch(() => []);
    return nextRun;
  }
}

export const actionPlanner = new ActionPlanner();

export async function executeActionPlan(actions: AppAction[]) {
  return actionPlanner.run(actions);
}
