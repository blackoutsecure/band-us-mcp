import { McpServer } from "@modelcontextprotocol/server";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { BandClient } from "../band/client.js";
import type { WorkerEnv } from "../env.js";
import { createSecretCredentialStore } from "../storage/index.js";
import { registerBandTools } from "./tools.js";

export function createBandMcpServer(
  env: WorkerEnv,
  correlationId: string,
): McpServer {
  const server = new McpServer(
    { name: "band-us-mcp", version: "0.1.0" },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  registerBandTools(server, {
    client: new BandClient(createSecretCredentialStore(env)),
    env,
    correlationId,
  });
  return server;
}
