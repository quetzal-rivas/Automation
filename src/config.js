import process from "node:process";

const DEFAULT_PATHS = {
  triggerPath: "/trigger-call",
  directivePath: "/get-directive"
};

const DEFAULT_POLL_INTERVAL_SECONDS = 30;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

const ARG_TO_KEY = {
  "--api-base-url": "apiBaseUrl",
  "--api-token": "apiToken",
  "--agent-id": "agentId",
  "--trigger-path": "triggerPath",
  "--directive-path": "directivePath",
  "--poll-interval-seconds": "pollIntervalSeconds",
  "--request-timeout-ms": "requestTimeoutMs"
};

function parseArgv(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }

    if (!token.startsWith("--")) {
      continue;
    }

    let option = token;
    let value;

    if (token.includes("=")) {
      [option, value] = token.split(/=(.+)/, 2);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      value = argv[i + 1];
      i += 1;
    } else {
      value = "true";
    }

    const key = ARG_TO_KEY[option];
    if (key) {
      parsed[key] = value;
    }
  }

  return parsed;
}

function parsePositiveInt(value, fallback, fieldName) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${fieldName}: expected a positive integer.`);
  }

  return parsed;
}

function normalizePath(pathValue, fallback) {
  const source = pathValue && String(pathValue).trim() ? String(pathValue).trim() : fallback;
  return source.startsWith("/") ? source : `/${source}`;
}

function parseBaseUrl(value) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    throw new Error(
      "Missing API base URL. Use --api-base-url or API_BASE_URL (DIRECTIVE_API_BASE_URL also supported)."
    );
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid API base URL: ${trimmed}`);
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`Invalid API base URL protocol: ${parsed.protocol}`);
  }

  const normalized = parsed.toString().replace(/\/+$/, "");
  return normalized;
}

function parseAgentId(value) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    throw new Error("Missing agent ID. Use --agent-id or AGENT_ID.");
  }

  return trimmed;
}

export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgv(argv);
  if (args.help) {
    return { help: true };
  }

  const apiBaseUrl = parseBaseUrl(args.apiBaseUrl ?? env.DIRECTIVE_API_BASE_URL ?? env.API_BASE_URL);
  const agentId = parseAgentId(args.agentId ?? env.AGENT_ID ?? env.IDE_AGENT_ID);

  return {
    help: false,
    apiBaseUrl,
    apiToken: (
      args.apiToken ??
      env.DIRECTIVE_API_TOKEN ??
      env.API_BEARER_TOKEN ??
      env.BEARER_TOKEN ??
      ""
    ).trim(),
    agentId,
    triggerPath: normalizePath(args.triggerPath ?? env.DIRECTIVE_TRIGGER_PATH, DEFAULT_PATHS.triggerPath),
    directivePath: normalizePath(args.directivePath ?? env.DIRECTIVE_GET_PATH, DEFAULT_PATHS.directivePath),
    pollIntervalSeconds: parsePositiveInt(
      args.pollIntervalSeconds ?? env.DIRECTIVE_POLL_INTERVAL_SECONDS,
      DEFAULT_POLL_INTERVAL_SECONDS,
      "poll interval seconds"
    ),
    requestTimeoutMs: parsePositiveInt(
      args.requestTimeoutMs ?? env.DIRECTIVE_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "request timeout ms"
    )
  };
}

export function getHelpText() {
  return [
    "ide-directive-mcp-server",
    "",
    "MCP server that fetches directives from your AWS middleware using AGENT_ID identity.",
    "",
    "Usage:",
    "  npx --yes . --agent-id vscode-home --api-base-url https://api.example.com/prod",
    "",
    "Required:",
    "  --agent-id <id>            or AGENT_ID",
    "  --api-base-url <url>       or API_BASE_URL / DIRECTIVE_API_BASE_URL",
    "",
    "Optional:",
    "  --api-token <token>        or BEARER_TOKEN / DIRECTIVE_API_TOKEN",
    "  --trigger-path <path>      default: /trigger-call",
    "  --directive-path <path>    default: /get-directive",
    "  --poll-interval-seconds    default: 30",
    "  --request-timeout-ms       default: 15000",
    "  --help                     show this message"
  ].join("\n");
}

export const configInternals = {
  parseArgv,
  parsePositiveInt,
  normalizePath,
  parseBaseUrl,
  parseAgentId
};
