import { createMcpHandler } from "@modelcontextprotocol/server";
import { authenticateMcpRequest, validateOrigin } from "./auth/oauth.js";
import type { WorkerEnv } from "./env.js";
import { IntegrationError, logFailure, normalizeError } from "./errors.js";
import { createBandMcpServer } from "./mcp/server.js";

function secureResponse(response: Response, correlationId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Correlation-Id", correlationId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const correlationId = crypto.randomUUID();
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") {
      return secureResponse(
        Response.json({ status: "ok", service: "band-us-mcp" }),
        correlationId,
      );
    }
    if (path !== "/mcp") {
      return secureResponse(
        Response.json({ error: "Not found." }, { status: 404 }),
        correlationId,
      );
    }
    try {
      if (!validateOrigin(request, env)) {
        throw new IntegrationError(
          "PERMISSION_DENIED",
          "The request origin is not allowed.",
          "permission",
        );
      }
      if (!(await authenticateMcpRequest(request, env))) {
        return secureResponse(
          Response.json(
            { error: "MCP authentication is required." },
            {
              status: 401,
              headers: { "WWW-Authenticate": 'Bearer realm="band-us-mcp"' },
            },
          ),
          correlationId,
        );
      }
      const handler = createMcpHandler(
        () => createBandMcpServer(env, correlationId),
        {
          legacy: "stateless",
          maxRequestBodySize: 128 * 1024,
          onerror: () => {
            logFailure(
              normalizeError(new Error("MCP request failed."), correlationId),
              "mcp_request",
            );
          },
        },
      );
      return secureResponse(await handler.fetch(request), correlationId);
    } catch (error: unknown) {
      const safe = normalizeError(error, correlationId);
      logFailure(safe, "mcp_request");
      const status =
        safe.category === "configuration"
          ? 503
          : safe.category === "permission"
            ? 403
            : 500;
      return secureResponse(
        Response.json({ ok: false, error: safe }, { status }),
        correlationId,
      );
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
