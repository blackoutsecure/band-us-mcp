import type { WorkerEnv } from "../env.js";
import { IntegrationError } from "../errors.js";

const bearerPattern = /^[A-Za-z0-9._~+/-]+=*$/;

// This validates pre-provisioned bearer credentials, not an OAuth login flow.
export async function authenticateMcpRequest(
  request: Request,
  env: WorkerEnv,
): Promise<boolean> {
  const expected = env.MCP_AUTH_TOKEN;
  if (
    !expected ||
    expected.length < 32 ||
    expected.length > 512 ||
    expected.startsWith("replace-") ||
    !bearerPattern.test(expected)
  ) {
    throw new IntegrationError(
      "NOT_CONFIGURED",
      "The operator must configure a strong MCP authentication token.",
      "configuration",
    );
  }
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~+/-]+=*)$/i);
  const provided = match?.[1];
  if (!provided || provided.length > 512) {
    return false;
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(expected),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(expected),
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(provided),
  );
}

export function validateOrigin(request: Request, env: WorkerEnv): boolean {
  const configured = env.MCP_ALLOWED_ORIGINS;
  const allowed = new Set([new URL(request.url).origin]);
  if (configured) {
    for (const value of configured.split(",")) {
      const origin = value.trim();
      const parsed = URL.canParse(origin) ? new URL(origin) : undefined;
      if (
        !parsed ||
        !["https:", "http:"].includes(parsed.protocol) ||
        parsed.origin !== origin
      ) {
        throw new IntegrationError(
          "NOT_CONFIGURED",
          "MCP_ALLOWED_ORIGINS must contain exact HTTP(S) origins.",
          "configuration",
        );
      }
      allowed.add(origin);
    }
  }
  const origin = request.headers.get("Origin");
  return origin === null || allowed.has(origin);
}
