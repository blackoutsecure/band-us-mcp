import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { deletePost } from "../band/posts.js";
import { deletedPostSchema, keySchema } from "../band/types.js";
import {
  runTool,
  toolResultSchema,
  type ToolContext,
} from "../mcp/result.js";

export function registerDeletePost(
  server: McpServer,
  context: ToolContext,
): void {
  server.registerTool(
    "band_delete_post",
    {
      title: "Delete an owned Band post",
      description:
        "Permanently delete a post authored by the configured BAND account. Requires band_key, post_key, confirm=true, operator write approval and BAND contents_deletion permission. Destructive; never automatically retried.",
      inputSchema: z
        .object({
          band_key: keySchema,
          post_key: keySchema,
          confirm: z.literal(true),
        })
        .strict(),
      outputSchema: toolResultSchema(deletedPostSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) =>
      runTool(context, "band_delete_post", () =>
        deletePost(context.client, context.env, input.band_key, input.post_key),
      ),
  );
}
