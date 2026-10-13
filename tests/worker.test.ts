import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateMcpRequest } from "../src/auth/oauth.js";
import { errorSchema } from "../src/errors.js";
import worker from "../src/index.js";
import { connectWorker, mockBandApi, testEnv } from "./helpers.js";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Real network is disabled.")));
  vi.stubGlobal("console", { ...console, info: vi.fn(), error: vi.fn() });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function request(headers?: HeadersInit, body = "{}"): Request {
  return new Request("https://worker.test/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${testEnv.MCP_AUTH_TOKEN ?? ""}`,
      ...headers,
    },
    body,
  });
}

describe("Worker HTTP authentication and protocol", () => {
  it("provides a credential-free liveness endpoint, not a BAND readiness claim", async () => {
    const response = await worker.fetch(new Request("https://worker.test/health"), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "band-us-mcp" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 404 for unrelated routes", async () => {
    const response = await worker.fetch(new Request("https://worker.test/other"), testEnv);
    expect(response.status).toBe(404);
  });

  it.each(["", "Bearer wrong-token", "Basic fake-credentials"])("rejects invalid MCP authorization %s before accessing BAND", async (authorization) => {
    const response = await worker.fetch(request({ Authorization: authorization }), testEnv);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(fetch).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(testEnv.BAND_ACCESS_TOKEN);
  });

  it("fails closed when the MCP credential is missing", async () => {
    const response = await worker.fetch(request(), {});
    expect(response.status).toBe(503);
    const body = await response.json<{ error: unknown }>();
    expect(errorSchema.parse(body.error).code).toBe("NOT_CONFIGURED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects weak or placeholder MCP credentials", async () => {
    await expect(authenticateMcpRequest(request(), { MCP_AUTH_TOKEN: "short" })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(authenticateMcpRequest(request(), { MCP_AUTH_TOKEN: "replace-with-a-long-placeholder-token" })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("does not accept the BAND credential as an MCP credential", async () => {
    const response = await worker.fetch(request({ Authorization: `Bearer ${testEnv.BAND_ACCESS_TOKEN ?? ""}` }), testEnv);
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates Origin even when MCP credentials are correct", async () => {
    const response = await worker.fetch(request({ Origin: "https://untrusted.example.com" }), testEnv);
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts only exact additional origins", async () => {
    const env = { ...testEnv, MCP_ALLOWED_ORIGINS: "https://trusted.example.com" };
    const allowed = await worker.fetch(request({ Origin: "https://trusted.example.com" }), env);
    const rejected = await worker.fetch(request({ Origin: "https://trusted.example.com.evil.test" }), env);
    expect(allowed.status).not.toBe(403);
    expect(rejected.status).toBe(403);
  });

  it("reports invalid origin configuration rather than allowing a wildcard", async () => {
    const response = await worker.fetch(request(), { ...testEnv, MCP_ALLOWED_ORIGINS: "*" });
    expect(response.status).toBe(503);
  });

  it("rejects oversized MCP request bodies", async () => {
    const response = await worker.fetch(request(undefined, " ".repeat(128 * 1024 + 1)), testEnv);
    expect(response.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without leaking stack traces", async () => {
    const response = await worker.fetch(request(undefined, "{not-json"), testEnv);
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain("stack");
    expect(text).not.toContain(testEnv.MCP_AUTH_TOKEN);
  });

  it.each([
    ["current protocol", undefined],
    ["2025 legacy protocol", ["2025-11-25"]],
  ])("supports SDK discovery and tools over %s", async (_name, protocols) => {
    mockBandApi();
    const client = await connectWorker(testEnv, protocols);
    try {
      expect((await client.listTools()).tools).toHaveLength(8);
    } finally {
      await client.close();
    }
  });

  it("keeps stateless GET and DELETE session operations unsupported", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await worker.fetch(
        new Request("https://worker.test/mcp", {
          method,
          headers: { Authorization: `Bearer ${testEnv.MCP_AUTH_TOKEN ?? ""}`, Accept: "text/event-stream" },
        }),
        testEnv,
      );
      expect(response.status).toBe(405);
    }
  });
});
