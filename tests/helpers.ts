import {
  Client,
  StreamableHTTPClientTransport,
  isCallToolResult,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/client/validators/cf-worker";
import { vi } from "vitest";
import type { WorkerEnv } from "../src/env.js";
import worker from "../src/index.js";

export const testEnv: WorkerEnv = {
  MCP_AUTH_TOKEN: "unit-test-mcp-key-not-a-real-secret-1234567890",
  BAND_ACCESS_TOKEN: "unit-test-band-token-not-a-real-secret",
  BAND_ENABLE_WRITES: "true",
  BAND_WRITE_BAND_KEYS: "band-test",
};

export const postFixture = {
  band_key: "band-test",
  post_key: "post-test",
  content: "Synthetic post content",
  author: { name: "Test author", user_key: "user-test" },
  created_at: 1_700_000_000_000,
  comment_count: 1,
  emotion_count: 0,
};
export const commentFixture = {
  comment_key: "comment-test",
  content: "Synthetic comment content",
  author: { name: "Test author" },
  created_at: 1_700_000_000_000,
  emotion_count: 0,
};

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly parameters: URLSearchParams;
  readonly redirect: RequestInit["redirect"];
}

const responses: Readonly<Record<string, unknown>> = {
  "/v2.1/bands": {
    bands: [
      {
        band_key: "band-test",
        name: "Test Band",
        cover: "https://example.com/cover.png",
        member_count: 2,
      },
    ],
  },
  "/v2/band/posts": {
    items: [postFixture],
    paging: { next_params: null },
  },
  "/v2.1/band/post": { post: postFixture },
  "/v2.2/band/post/create": {
    band_key: "band-test",
    post_key: "new-post-test",
  },
  "/v2/band/post/remove": { message: "success" },
  "/v2/band/post/comments": {
    items: [commentFixture],
    paging: { next_params: null },
  },
  "/v2/band/post/comment/create": { message: "success" },
  "/v2/band/permissions": {
    permissions: ["posting", "commenting", "contents_deletion"],
  },
  "/v2/profile": { user_key: "user-test" },
};

export function bandSuccess(data: unknown): Response {
  return Response.json({ result_code: 1, result_data: data });
}

export function mockBandApi(
  override?: (request: RecordedRequest) => Response | undefined,
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const request = new Request(input instanceof URL ? input.href : input, init);
    const url = new URL(request.url);
    if (url.origin !== "https://openapi.band.us") {
      throw new Error("Tests forbid real or unexpected network requests.");
    }
    const parameters = new URLSearchParams(url.searchParams);
    if (request.method === "POST") {
      const form = await request.formData();
      for (const [name, value] of form) {
        if (typeof value !== "string") {
          throw new Error("BAND requests must not upload files.");
        }
        parameters.append(name, value);
      }
    }
    const recorded: RecordedRequest = {
      method: request.method,
      path: url.pathname,
      parameters,
      redirect: init?.redirect,
    };
    requests.push(recorded);
    const overridden = override?.(recorded);
    if (overridden) {
      return overridden;
    }
    if (!Object.hasOwn(responses, recorded.path)) {
      throw new Error("The test encountered an undocumented BAND endpoint.");
    }
    return bandSuccess(responses[recorded.path]);
  });
  return requests;
}

export async function connectWorker(
  env: WorkerEnv = testEnv,
  protocolVersions?: string[],
): Promise<Client> {
  const client = new Client(
    { name: "offline-test-client", version: "1.0.0" },
    {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      ...(protocolVersions ? { supportedProtocolVersions: protocolVersions } : {}),
    },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL("https://worker.test/mcp"),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${env.MCP_AUTH_TOKEN ?? ""}` },
      },
      fetch: async (input, init) =>
        worker.fetch(
          new Request(input instanceof URL ? input.href : input, init),
          env,
        ),
    },
  );
  await client.connect(transport);
  return client;
}

export async function callTool(
  client: Client,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<CallToolResult> {
  const result = await client.callTool({ name, arguments: arguments_ });
  if (!isCallToolResult(result)) {
    throw new Error("Expected a completed MCP tool result.");
  }
  return result;
}
