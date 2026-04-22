class HttpError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "HttpError";
    this.status = details.status;
    this.body = details.body;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(baseUrl, path, query) {
  const url = /^https?:\/\//.test(path)
    ? new URL(path)
    : new URL(path.replace(/^\/+/, ""), `${baseUrl.replace(/\/+$/, "")}/`);

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => url.searchParams.append(key, String(entry)));
      return;
    }

    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

function pickValue(root, keys) {
  if (!root || typeof root !== "object") {
    return undefined;
  }

  for (const key of keys) {
    if (Object.hasOwn(root, key) && root[key] !== undefined) {
      return root[key];
    }
  }

  if (root.data && typeof root.data === "object") {
    for (const key of keys) {
      if (Object.hasOwn(root.data, key) && root.data[key] !== undefined) {
        return root.data[key];
      }
    }
  }

  return undefined;
}

export function normalizeDirectivePayload(payload) {
  const root =
    Array.isArray(payload) && payload.length > 0
      ? payload[0]
      : payload && typeof payload === "object"
        ? payload
        : {};

  const directive = pickValue(root, ["directive", "instruction", "transcript", "message", "text"]);
  const status = pickValue(root, ["status", "state", "agent_status"]);
  const sessionId = pickValue(root, ["session_id", "sessionId", "session"]);
  const timestamp = pickValue(root, ["timestamp", "updated_at", "updatedAt", "created_at", "createdAt"]);
  const aiSummary = pickValue(root, ["ai_summary", "aiSummary", "summary"]);

  return {
    hasDirective: typeof directive === "string" ? directive.trim().length > 0 : directive !== undefined && directive !== null,
    directive: directive ?? null,
    status: status ?? null,
    sessionId: sessionId ?? null,
    timestamp: timestamp ?? null,
    aiSummary: aiSummary ?? null,
    raw: payload
  };
}

export class MiddlewareClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Global fetch is unavailable. Use Node.js 20+.");
    }

    this.config = config;
    this.fetch = fetchImpl;
  }

  async request(method, path, options = {}) {
    const url = buildUrl(this.config.apiBaseUrl, path, options.query);
    const headers = {
      accept: "application/json",
      "x-agent-id": this.config.agentId
    };

    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    if (this.config.apiToken) {
      headers.authorization = /^Bearer\s+/i.test(this.config.apiToken)
        ? this.config.apiToken
        : `Bearer ${this.config.apiToken}`;
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(`Request timed out after ${this.config.requestTimeoutMs}ms: ${method} ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }

    let data = null;
    const contentType = response.headers.get("content-type") ?? "";

    if (response.status !== 204) {
      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        data = text.length > 0 ? { text } : null;
      }
    }

    if (!response.ok) {
      const preview = typeof data === "object" ? JSON.stringify(data) : String(data);
      throw new HttpError(`Middleware request failed (${response.status}): ${preview}`, {
        status: response.status,
        body: data
      });
    }

    return data;
  }

  async triggerCall({ summary, context, sessionId }) {
    return this.request("POST", this.config.triggerPath, {
      body: {
        agent_id: this.config.agentId,
        summary,
        context,
        session_id: sessionId
      }
    });
  }

  async getDirective({ includeConsumed, sessionId, since } = {}) {
    return this.request("GET", this.config.directivePath, {
      query: {
        agent_id: this.config.agentId,
        include_consumed: includeConsumed,
        session_id: sessionId,
        since
      }
    });
  }

  async waitForDirective({
    timeoutSeconds = 600,
    pollIntervalSeconds,
    returnOnStatuses = ["USER_MISSED_CALL", "USER_BUSY"]
  } = {}) {
    const startedAt = Date.now();
    const timeoutMs = timeoutSeconds * 1000;
    const pollMs = (pollIntervalSeconds ?? this.config.pollIntervalSeconds) * 1000;

    let attempts = 0;
    let lastPayload = null;

    while (Date.now() - startedAt <= timeoutMs) {
      attempts += 1;
      const payload = await this.getDirective();
      const normalized = normalizeDirectivePayload(payload);
      lastPayload = normalized;

      if (normalized.hasDirective) {
        return {
          event: "directive",
          attempts,
          ...normalized
        };
      }

      if (normalized.status && returnOnStatuses.includes(normalized.status)) {
        return {
          event: "status",
          attempts,
          ...normalized
        };
      }

      if (Date.now() - startedAt + pollMs > timeoutMs) {
        break;
      }

      await sleep(pollMs);
    }

    return {
      event: "timeout",
      attempts,
      last: lastPayload
    };
  }
}

export { HttpError };
