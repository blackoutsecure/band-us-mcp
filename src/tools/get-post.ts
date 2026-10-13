import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getPost } from "../band/posts.js";
import { keySchema, postResultSchema } from "../band/types.js";
import {
  readOnlyAnnotations,
  runTool,
  toolResultSchema,
  type ToolContext,
} from "../mcp/result.js";

export function registerGetPost(
  server: McpServer,
  context: ToolContext,
): void {
  server.registerTool(
    "band_get_post",
    {
      title: "Get a Band post",
      description:
        "Read a specific post when band_key and post_key are known. Both identifiers are required; does not modify the post.",
      inputSchema: z.object({ band_key: keySchema, post_key: keySchema }).strict(),
      outputSchema: toolResultSchema(postResultSchema),
      annotations: readOnlyAnnotations,
    },
    async (input) =>
      runTool(context, "band_get_post", () =>
        getPost(context.client, input.band_key, input.post_key),
      ),
  );
}
