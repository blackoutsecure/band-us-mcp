import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createComment } from "../band/comments.js";
import { createdCommentSchema, keySchema } from "../band/types.js";
import {
  createAnnotations,
  runTool,
  toolResultSchema,
  type ToolContext,
} from "../mcp/result.js";

export function registerCreateComment(
  server: McpServer,
  context: ToolContext,
): void {
  server.registerTool(
    "band_create_comment",
    {
      title: "Create a post comment",
      description:
        "Add a text comment as the configured BAND account. Requires band_key, post_key, nonblank body and confirm=true, operator write approval and BAND commenting permission. May notify members; not automatically retried. BAND does not return a comment ID.",
      inputSchema: z
        .object({
          band_key: keySchema,
          post_key: keySchema,
          body: z.string().min(1).max(10_000).refine((value) => value.trim().length > 0),
          confirm: z.literal(true),
        })
        .strict(),
      outputSchema: toolResultSchema(createdCommentSchema),
      annotations: createAnnotations,
    },
    async (input) =>
      runTool(context, "band_create_comment", () =>
        createComment(
          context.client,
          context.env,
          input.band_key,
          input.post_key,
          input.body,
        ),
      ),
  );
}
