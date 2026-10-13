import { z } from "zod";
import { IntegrationError } from "../errors.js";
import type { CredentialStore } from "../storage/index.js";
import { getBandAccessToken } from "./auth.js";

const apiOrigin = "https://openapi.band.us";
const maxResponseBytes = 1024 * 1024;
const envelopeSchema = z.object({
  result_code: z.number().int(),
  result_data: z.unknown().optional(),
});

type BandPath =
  | "/v2.1/bands"
  | "/v2/band/posts"
  | "/v2.1/band/post"
  | "/v2.2/band/post/create"
  | "/v2/band/post/remove"
  | "/v2/band/post/comments"
  | "/v2/band/post/comment/create"
  | "/v2/band/permissions"
  | "/v2/profile";

interface BandRequest {
  readonly method: "GET" | "POST";
  readonly path: BandPath;
  readonly parameters?: Readonly<Record<string, string>>;
}

function downstreamError(
  status: number,
  canRetry: boolean,
  resultCode?: number,
): IntegrationError {
  if (status === 401 || resultCode === 10401) {
    return new IntegrationError(
      "UNAUTHORIZED",
      "BAND authentication failed; the operator must reconnect the BAND account.",
      "authentication",
      false,
      resultCode,
    );
  }
  if (
    status === 403 ||
    (resultCode !== undefined &&
      [10403, 2142, 60102, 60103, 60106].includes(resultCode))
  ) {
    return new IntegrationError(
      "PERMISSION_DENIED",
      "BAND denied access to the requested operation.",
      "permission",
      false,
      resultCode,
    );
  }
  if (
    status === 429 ||
    (resultCode !== undefined && [1001, 1002, 1003].includes(resultCode))
  ) {
    return new IntegrationError(
      "RATE_LIMITED",
      "BAND's quota or rate limit prevented the operation.",
      "upstream",
      canRetry,
      resultCode,
    );
  }
  return new IntegrationError(
    "BAND_FAILURE",
    "BAND could not complete the requested operation.",
    "upstream",
    canRetry && (status >= 500 || resultCode === 2300),
    resultCode,
  );
}

export function invalidBandResponse(): IntegrationError {
  return new IntegrationError(
    "INVALID_BAND_RESPONSE",
    "BAND returned an unexpected response; no result can be confirmed.",
    "upstream",
  );
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) {
    throw invalidBandResponse();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      length += value.byteLength;
      if (length > maxResponseBytes) {
        await reader.cancel();
        throw invalidBandResponse();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch (error: unknown) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw invalidBandResponse();
    }
    throw error;
  }
}

function retryDelay(response: Response): number {
  const value = response.headers.get("Retry-After");
  if (value !== null && /^\d+$/.test(value)) {
    return Number(value) * 1000;
  }
  if (value !== null) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) {
      return Math.max(0, timestamp - Date.now());
    }
  }
  return 100;
}

export class BandClient {
  constructor(private readonly store: CredentialStore) {}

  async request<T>(
    request: BandRequest,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const token = await getBandAccessToken(this.store);
    const canRetry = request.method === "GET";
    for (let attempt = 0; ; attempt += 1) {
      const parameters = new URLSearchParams(request.parameters);
      parameters.set("access_token", token);
      const url = new URL(request.path, apiOrigin);
      if (request.method === "GET") {
        url.search = parameters.toString();
      }
      let response: Response | undefined;
      try {
        response = await fetch(url, {
          method: request.method,
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
          ...(request.method === "POST" ? { body: parameters } : {}),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw downstreamError(response.status, canRetry);
        }
        const parsed = envelopeSchema.safeParse(await readJson(response));
        if (!parsed.success) {
          throw invalidBandResponse();
        }
        if (parsed.data.result_code !== 1) {
          throw downstreamError(
            response.status,
            canRetry,
            parsed.data.result_code,
          );
        }
        const data = schema.safeParse(parsed.data.result_data);
        if (!data.success || JSON.stringify(data.data).includes(token)) {
          throw invalidBandResponse();
        }
        return data.data;
      } catch (error: unknown) {
        let failure: IntegrationError;
        if (error instanceof IntegrationError) {
          failure = error;
        } else if (
          error instanceof DOMException &&
          ["TimeoutError", "AbortError"].includes(error.name)
        ) {
          failure = new IntegrationError(
            "BAND_TIMEOUT",
            "The BAND request timed out; its result cannot be confirmed.",
            "upstream",
            canRetry,
          );
        } else if (error instanceof TypeError) {
          failure = new IntegrationError(
            "BAND_UNAVAILABLE",
            "The BAND service could not be reached.",
            "upstream",
            canRetry,
          );
        } else {
          throw error;
        }
        const delay = response ? retryDelay(response) : 100;
        if (!canRetry || !failure.retryable || attempt >= 1 || delay > 1000) {
          throw failure;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}
