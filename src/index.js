import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getHelpText, loadConfig } from "./config.js";
import { MiddlewareClient } from "./middleware-client.js";
import { createDirectiveServer } from "./server.js";

export async function run(argv = process.argv.slice(2), env = process.env) {
  const config = loadConfig(argv, env);
  if (config.help) {
    process.stdout.write(`${getHelpText()}\n`);
    return;
  }

  const client = new MiddlewareClient(config);
  const server = createDirectiveServer(config, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`[ide-directive-mcp-server] ready for agent '${config.agentId}'\n`);
}
