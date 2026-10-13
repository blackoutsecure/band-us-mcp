import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { listPosts } from "../band/posts.js";
import { cursorSchema, keySchema, postsResultSchema } from "../band/types.js";
import {
  readOnlyAnnotations,
  runTool,
  toolResultSchema,
  type ToolContext,
} from "../mcp/result.js";

export function registerListPosts(
  server: McpServer,
  context: ToolContext,
): void {
  server.registerTool(
    "band_list_posts",
    {
      title: "List Band posts",
      description:
        "Read one page of posts for band_key, ordered by last modification. locale defaults to en_US. Pass the returned next_cursor as cursor for another page; read-only.",
      inputSchema: z
        .object({
          band_key: keySchema,
          locale: z.string().regex(/^[a-z]{2}_[A-Z]{2}$/).default("en_US"),
          cursor: cursorSchema.optional(),
        })
        .strict(),
      outputSchema: toolResultSchema(postsResultSchema),
      annotations: readOnlyAnnotations,
    },
    async (input) =>
      runTool(context, "band_list_posts", () =>
        listPosts(
          context.client,
          input.band_key,
          input.locale,
          input.cursor,
        ),
      ),
  );
}
