import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  bandsResultSchema,
  commentsResultSchema,
  createdCommentSchema,
  createdPostSchema,
  deletedPostSchema,
  permissionsResultSchema,
  postResultSchema,
  postsResultSchema,
} from "../src/band/types.js";
import { errorSchema } from "../src/errors.js";
import { toolResultSchema } from "../src/mcp/result.js";
import {
  bandSuccess,
  callTool,
  connectWorker,
  mockBandApi,
  postFixture,
  testEnv,
} from "./helpers.js";

interface ToolCase {
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly invalid: Record<string, unknown>;
  readonly path: string;
  readonly resultSchema: z.ZodType;
  readonly writes: boolean;
}

const cases: readonly ToolCase[] = [
  {
    name: "band_list_bands", input: {}, invalid: { access_token: "forbidden" },
    path: "/v2.1/bands", resultSchema: bandsResultSchema, writes: false,
  },
  {
    name: "band_list_posts", input: { band_key: "band-test" }, invalid: {},
    path: "/v2/band/posts", resultSchema: postsResultSchema, writes: false,
  },
  {
    name: "band_get_post",
    input: { band_key: "band-test", post_key: "post-test" },
    invalid: { band_key: "band-test", post_key: "" },
    path: "/v2.1/band/post", resultSchema: postResultSchema, writes: false,
  },
  {
    name: "band_create_post",
    input: { band_key: "band-test", content: "Synthetic post", confirm: true },
    invalid: { band_key: "band-test", content: "Synthetic post" },
    path: "/v2.2/band/post/create", resultSchema: createdPostSchema, writes: true,
  },
  {
    name: "band_delete_post",
    input: { band_key: "band-test", post_key: "post-test", confirm: true },
    invalid: { band_key: "band-test", post_key: "post-test", confirm: false },
    path: "/v2/band/post/remove", resultSchema: deletedPostSchema, writes: true,
  },
  {
    name: "band_list_comments",
    input: { band_key: "band-test", post_key: "post-test" }, invalid: {},
    path: "/v2/band/post/comments", resultSchema: commentsResultSchema, writes: false,
  },
  {
    name: "band_create_comment",
    input: { band_key: "band-test", post_key: "post-test", body: "Synthetic comment", confirm: true },
    invalid: { band_key: "band-test", post_key: "post-test", body: " ", confirm: true },
    path: "/v2/band/post/comment/create", resultSchema: createdCommentSchema, writes: true,
  },
  {
    name: "band_check_permissions",
    input: { band_key: "band-test" },
    invalid: { band_key: "band-test", permissions: ["invented-permission"] },
    path: "/v2/band/permissions", resultSchema: permissionsResultSchema, writes: false,
  },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
    new Error("Real network requests are disabled in tests."),
  ));
  vi.stubGlobal("console", { ...console, info: vi.fn(), error: vi.fn() });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(cases)("$name", (testCase) => {
  it("returns a validated structured result for valid input", async () => {
    const requests = mockBandApi();
    const client = await connectWorker();
    try {
      const result = await callTool(client, testCase.name, testCase.input);
      expect(result.isError).toBe(false);
      const output = toolResultSchema(testCase.resultSchema).parse(result.structuredContent);
      expect(output.ok).toBe(true);
      expect(requests.some((request) => request.path === testCase.path)).toBe(true);
      expect(JSON.stringify(result)).not.toContain(testEnv.BAND_ACCESS_TOKEN);
      expect(requests.every((request) => request.redirect === "manual")).toBe(true);
      expect(requests.every((request) => request.parameters.get("access_token") === testEnv.BAND_ACCESS_TOKEN)).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("rejects invalid input without calling BAND", async () => {
    const requests = mockBandApi();
    const client = await connectWorker();
    try {
      const result = await callTool(client, testCase.name, testCase.invalid);
      expect(result.isError).toBe(true);
      expect(requests).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it.each([
    [10401, "authentication"],
    [10403, "permission"],
    [3000, "upstream"],
  ])("normalizes BAND result_code %s (%s)", async (code, category) => {
    mockBandApi((request) =>
      request.path === testCase.path
        ? Response.json({ result_code: code, result_data: { message: `private ${testEnv.BAND_ACCESS_TOKEN}` } })
        : undefined,
    );
    const client = await connectWorker();
    try {
      const result = await callTool(client, testCase.name, testCase.input);
      expect(result.isError).toBe(true);
      const envelope = z.object({ ok: z.literal(false), error: errorSchema }).parse(result.structuredContent);
      expect(envelope.error.category).toBe(category);
      expect(envelope.error.result_code).toBe(code);
      expect(envelope.error.retryable).toBe(false);
      expect(JSON.stringify(result)).not.toContain(testEnv.BAND_ACCESS_TOKEN);
    } finally {
      await client.close();
    }
  });

  it("rejects an unexpected successful BAND response", async () => {
    mockBandApi((request) =>
      request.path === testCase.path ? bandSuccess({ unexpected: true }) : undefined,
    );
    const client = await connectWorker();
    try {
      const result = await callTool(client, testCase.name, testCase.input);
      expect(result.isError).toBe(true);
      const envelope = z.object({ error: errorSchema }).parse(result.structuredContent);
      expect(envelope.error.code).toBe("INVALID_BAND_RESPONSE");
    } finally {
      await client.close();
    }
  });

  it("reports missing BAND credentials rather than empty success", async () => {
    const requests = mockBandApi();
    const client = await connectWorker({ ...testEnv, BAND_ACCESS_TOKEN: "" });
    try {
      const result = await callTool(client, testCase.name, testCase.input);
      expect(result.isError).toBe(true);
      const envelope = z.object({ error: errorSchema }).parse(result.structuredContent);
      expect(envelope.error.code).toBe("NOT_CONFIGURED");
      expect(requests).toHaveLength(0);
    } finally {
      await client.close();
    }
  });
});

describe("tool contracts and authorization", () => {
  it("exposes exactly the eight specified tools with side-effect annotations", async () => {
    mockBandApi();
    const client = await connectWorker();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(cases.map((testCase) => testCase.name).sort());
      for (const tool of tools) {
        const testCase = cases.find((value) => value.name === tool.name);
        expect(tool.annotations?.readOnlyHint).toBe(!testCase?.writes);
        expect(tool.annotations?.destructiveHint).toBe(tool.name === "band_delete_post");
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.outputSchema?.type).toBe("object");
      }
    } finally {
      await client.close();
    }
  });

  it.each(cases.filter((testCase) => testCase.writes))("gates $name on operator write enablement", async (testCase) => {
    const requests = mockBandApi();
    const client = await connectWorker({ ...testEnv, BAND_ENABLE_WRITES: "false" });
    try {
      const result = await callTool(client, testCase.name, testCase.input);
      expect(result.isError).toBe(true);
      expect(requests).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it.each(cases.filter((testCase) => testCase.writes))("rejects $name outside the approved Band list", async (testCase) => {
    const requests = mockBandApi();
    const client = await connectWorker({ ...testEnv, BAND_WRITE_BAND_KEYS: "other-band" });
    try {
      const result = await callTool(client, testCase.name, testCase.input);
      expect(result.isError).toBe(true);
      expect(requests).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it("reports invalid write configuration instead of silently choosing a policy", async () => {
    const requests = mockBandApi();
    const client = await connectWorker({ ...testEnv, BAND_ENABLE_WRITES: "yes" });
    try {
      const result = await callTool(client, "band_create_post", {
        band_key: "band-test", content: "Synthetic post", confirm: true,
      });
      const envelope = z.object({ error: errorSchema }).parse(result.structuredContent);
      expect(envelope.error.code).toBe("NOT_CONFIGURED");
      expect(result.isError).toBe(true);
      expect(requests).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it.each(cases.filter((testCase) => testCase.writes))("checks BAND permission before $name", async (testCase) => {
    const requests = mockBandApi((request) =>
      request.path === "/v2/band/permissions" ? bandSuccess({ permissions: [] }) : undefined,
    );
    const client = await connectWorker();
    try {
      const result = await callTool(client, testCase.name, testCase.input);
      expect(result.isError).toBe(true);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.path).toBe("/v2/band/permissions");
      expect(requests.some((request) => request.method === "POST")).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("checks authorship before deleting a post", async () => {
    const requests = mockBandApi((request) =>
      request.path === "/v2.1/band/post"
        ? bandSuccess({ post: { ...postFixture, author: { name: "Other author", user_key: "other-user" } } })
        : undefined,
    );
    const client = await connectWorker();
    try {
      const result = await callTool(client, "band_delete_post", {
        band_key: "band-test", post_key: "post-test", confirm: true,
      });
      expect(result.isError).toBe(true);
      expect(requests.some((request) => request.path === "/v2/band/post/remove")).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("uses the documented POST mutation endpoints and does not push by default", async () => {
    const requests = mockBandApi();
    const client = await connectWorker();
    try {
      await callTool(client, "band_create_post", { band_key: "band-test", content: "Synthetic post", confirm: true });
      await callTool(client, "band_delete_post", { band_key: "band-test", post_key: "post-test", confirm: true });
      await callTool(client, "band_create_comment", { band_key: "band-test", post_key: "post-test", body: "Synthetic comment", confirm: true });
      const mutations = requests.filter((request) => request.method === "POST");
      expect(mutations.map((request) => request.path)).toEqual([
        "/v2.2/band/post/create", "/v2/band/post/remove", "/v2/band/post/comment/create",
      ]);
      expect(mutations[0]?.parameters.get("do_push")).toBe("false");
    } finally {
      await client.close();
    }
  });

  it("never logs tokens or private content", async () => {
    mockBandApi();
    const client = await connectWorker();
    try {
      await callTool(client, "band_list_posts", { band_key: "band-test" });
      const logs = JSON.stringify([
        ...vi.mocked(console.info).mock.calls,
        ...vi.mocked(console.error).mock.calls,
      ]);
      expect(logs).not.toContain(testEnv.BAND_ACCESS_TOKEN);
      expect(logs).not.toContain(testEnv.MCP_AUTH_TOKEN);
      expect(logs).not.toContain(postFixture.content);
      expect(logs).toContain("correlation_id");
    } finally {
      await client.close();
    }
  });
});
