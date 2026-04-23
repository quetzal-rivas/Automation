#!/usr/bin/env node

import { run } from "../src/index.js";

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[ide-directive-mcp-server] fatal: ${message}\n`);
  process.exit(1);
});
