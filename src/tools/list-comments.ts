import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { listComments } from "../band/comments.js";
import { commentsResultSchema, cursorSchema, keySchema } from "../band/types.js";
import {
  readOnlyAnnotations,
  runTool,
  toolResultSchema,
  type ToolContext,
} from "../mcp/result.js";

export function registerListComments(
  server: McpServer,
  context: ToolContext,
): void {
  server.registerTool(
    "band_list_comments",
    {
      title: "List post comments",
      description:
        "Read one page of comments for band_key and post_key. sort defaults to +created_at; cursor accepts a returned next_cursor. Read-only.",
      inputSchema: z
        .object({
          band_key: keySchema,
          post_key: keySchema,
          sort: z.enum(["+created_at", "-created_at"]).default("+created_at"),
          cursor: cursorSchema.optional(),
        })
        .strict(),
      outputSchema: toolResultSchema(commentsResultSchema),
      annotations: readOnlyAnnotations,
    },
    async (input) =>
      runTool(context, "band_list_comments", () =>
        listComments(
          context.client,
          input.band_key,
          input.post_key,
          input.sort,
          input.cursor,
        ),
      ),
  );
}
