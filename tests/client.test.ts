import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BandClient } from "../src/band/client.js";
import { listComments } from "../src/band/comments.js";
import { checkPermissions } from "../src/band/permissions.js";
import { createPost, getPost, listPosts } from "../src/band/posts.js";
import { bandsResultSchema } from "../src/band/types.js";
import { createSecretCredentialStore } from "../src/storage/index.js";
import { bandSuccess, commentFixture, mockBandApi, postFixture, testEnv } from "./helpers.js";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Real network is disabled.")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function client(): BandClient {
  return new BandClient(createSecretCredentialStore(testEnv));
}

describe("BAND client reliability", () => {
  it("supports the fetch options in the actual Workers runtime", () => {
    expect(() => new Request("https://openapi.band.us/v2.1/bands", {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    })).not.toThrow();
  });

  it("retries a transient read once", async () => {
    let failures = 0;
    const requests = mockBandApi(() =>
      failures++ === 0 ? new Response("", { status: 503 }) : undefined,
    );
    const result = await client().request({ method: "GET", path: "/v2.1/bands" }, bandsResultSchema);
    expect(result.bands).toHaveLength(1);
    expect(requests).toHaveLength(2);
  });

  it("rejects redirects without forwarding credentials", async () => {
    const requests = mockBandApi(() => new Response("", {
      status: 302,
      headers: { Location: "https://untrusted.example.com/" },
    }));
    await expect(client().request({ method: "GET", path: "/v2.1/bands" }, bandsResultSchema)).rejects.toMatchObject({
      code: "BAND_FAILURE", retryable: false,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.redirect).toBe("manual");
  });

  it("does not retry a write after an ambiguous HTTP failure", async () => {
    const requests = mockBandApi((request) =>
      request.method === "POST" ? new Response("", { status: 503 }) : undefined,
    );
    await expect(createPost(client(), testEnv, "band-test", "Synthetic post", false)).rejects.toMatchObject({
      code: "BAND_FAILURE", retryable: false,
    });
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
  });

  it("preserves UTF-8 content and reserved form characters", async () => {
    const requests = mockBandApi();
    const content = `Text + & ${String.fromCodePoint(0xd55c, 0xae00)}`;
    await createPost(client(), testEnv, "band-test", content, false);
    const mutation = requests.find((request) => request.method === "POST");
    expect(mutation?.parameters.get("content")).toBe(content);
  });

  it("respects a Retry-After longer than the bounded retry budget", async () => {
    const requests = mockBandApi(() =>
      new Response("", { status: 429, headers: { "Retry-After": "60" } }),
    );
    await expect(client().request({ method: "GET", path: "/v2.1/bands" }, bandsResultSchema)).rejects.toMatchObject({
      code: "RATE_LIMITED", retryable: true,
    });
    expect(requests).toHaveLength(1);
  });

  it.each([401, 403])("normalizes HTTP %s without retries", async (status) => {
    const requests = mockBandApi(() => new Response("", { status }));
    await expect(client().request({ method: "GET", path: "/v2.1/bands" }, bandsResultSchema)).rejects.toMatchObject({
      category: status === 401 ? "authentication" : "permission",
    });
    expect(requests).toHaveLength(1);
  });

  it("normalizes timeout errors without exposing request details", async () => {
    vi.mocked(fetch).mockRejectedValue(new DOMException("private token details", "TimeoutError"));
    await expect(client().request({ method: "GET", path: "/v2.1/bands" }, bandsResultSchema)).rejects.toMatchObject({
      code: "BAND_TIMEOUT", message: "The BAND request timed out; its result cannot be confirmed.",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed JSON", async () => {
    mockBandApi(() => new Response("not JSON", { headers: { "Content-Type": "application/json" } }));
    await expect(client().request({ method: "GET", path: "/v2.1/bands" }, bandsResultSchema)).rejects.toMatchObject({
      code: "INVALID_BAND_RESPONSE",
    });
  });

  it("rejects oversized responses", async () => {
    mockBandApi(() => new Response("x".repeat(1024 * 1024 + 1)));
    await expect(client().request({ method: "GET", path: "/v2.1/bands" }, bandsResultSchema)).rejects.toMatchObject({
      code: "INVALID_BAND_RESPONSE",
    });
  });

  it("rejects credential strings embedded in otherwise valid results", async () => {
    mockBandApi(() =>
      bandSuccess({ bands: [{ band_key: "band-test", name: testEnv.BAND_ACCESS_TOKEN, cover: "", member_count: 1 }] }),
    );
    await expect(client().request({ method: "GET", path: "/v2.1/bands" }, bandsResultSchema)).rejects.toMatchObject({
      code: "INVALID_BAND_RESPONSE",
    });
  });

  it.each(["permissions", "permission"])("supports the officially documented %s spelling", async (field) => {
    mockBandApi(() => bandSuccess({ [field]: ["posting"] }));
    expect(await checkPermissions(client(), "band-test", ["posting"])).toEqual({ permissions: ["posting"] });
  });
});

describe("resource and pagination boundaries", () => {
  it("returns a sanitized post cursor and retains the original Band and locale", async () => {
    const requests = mockBandApi(() =>
      bandSuccess({
        items: [postFixture],
        paging: {
          next_params: {
            after: "next-page", limit: "20", band_key: "band-test",
            access_token: testEnv.BAND_ACCESS_TOKEN,
            url: "https://untrusted.example.com/",
          },
        },
      }),
    );
    const page = await listPosts(client(), "band-test", "en_US");
    expect(page.next_cursor).toEqual({ after: "next-page", limit: 20 });
    expect(JSON.stringify(page)).not.toContain(testEnv.BAND_ACCESS_TOKEN);
    if (!page.next_cursor) {
      throw new Error("Expected a test cursor.");
    }
    await listPosts(client(), "band-test", "en_US", page.next_cursor);
    expect(requests[1]?.parameters.get("after")).toBe("next-page");
    expect(requests[1]?.parameters.get("locale")).toBe("en_US");
    expect(requests[1]?.parameters.get("band_key")).toBe("band-test");
  });

  it("supports a comment cursor without an invented limit or locale", async () => {
    const requests = mockBandApi(() =>
      bandSuccess({
        items: [commentFixture],
        paging: { next_params: { after: "next-comment", band_key: "band-test", post_key: "post-test", access_token: "ignored-provider-token" } },
      }),
    );
    const page = await listComments(client(), "band-test", "post-test", "+created_at");
    expect(page.next_cursor).toEqual({ after: "next-comment" });
    expect(requests[0]?.parameters.get("sort")).toBe("+created_at");
    expect(requests[0]?.parameters.has("locale")).toBe(false);
  });

  it("rejects pagination for another Band", async () => {
    mockBandApi(() =>
      bandSuccess({ items: [postFixture], paging: { next_params: { after: "cursor", band_key: "other-band" } } }),
    );
    await expect(listPosts(client(), "band-test", "en_US")).rejects.toMatchObject({ code: "INVALID_BAND_RESPONSE" });
  });

  it("rejects a different post instead of silently substituting it", async () => {
    mockBandApi(() => bandSuccess({ post: { ...postFixture, post_key: "other-post" } }));
    await expect(getPost(client(), "band-test", "post-test")).rejects.toMatchObject({ code: "INVALID_BAND_RESPONSE" });
  });
});
