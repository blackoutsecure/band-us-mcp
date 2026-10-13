import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { BandClient } from "../band/client.js";
import type { WorkerEnv } from "../env.js";
import { errorSchema, logFailure, normalizeError } from "../errors.js";

export interface ToolContext {
  readonly client: BandClient;
  readonly env: WorkerEnv;
  readonly correlationId: string;
}

export const readOnlyAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
export const createAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export function toolResultSchema<T extends z.ZodType>(
  data: T,
): z.ZodDiscriminatedUnion<
  [
    z.ZodObject<{ ok: z.ZodLiteral<true>; data: T }>,
    z.ZodObject<{ ok: z.ZodLiteral<false>; error: typeof errorSchema }>,
  ],
  "ok"
> {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: errorSchema }),
  ]);
}

export async function runTool<T extends object>(
  context: ToolContext,
  operation: string,
  execute: () => Promise<T>,
): Promise<CallToolResult> {
  try {
    const data = await execute();
    const result = { ok: true, data };
    console.info(
      JSON.stringify({
        event: "tool_completed",
        operation,
        correlation_id: context.correlationId,
      }),
    );
    return {
      resultType: "complete",
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      isError: false,
    };
  } catch (error: unknown) {
    const safe = normalizeError(error, context.correlationId);
    logFailure(safe, operation);
    const result = { ok: false, error: safe };
    return {
      resultType: "complete",
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      isError: true,
    };
  }
}
