import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createPost } from "../band/posts.js";
import { createdPostSchema, keySchema } from "../band/types.js";
import {
  createAnnotations,
  runTool,
  toolResultSchema,
  type ToolContext,
} from "../mcp/result.js";

export function registerCreatePost(
  server: McpServer,
  context: ToolContext,
): void {
  server.registerTool(
    "band_create_post",
    {
      title: "Create a Band post",
      description:
        "Publish a text post as the configured BAND account. Requires band_key, nonblank content, and confirm=true, plus operator write approval and BAND posting permission. do_push defaults to false; true may notify members. Not automatically retried.",
      inputSchema: z
        .object({
          band_key: keySchema,
          content: z.string().min(1).max(10_000).refine((value) => value.trim().length > 0),
          confirm: z.literal(true),
          do_push: z.boolean().default(false),
        })
        .strict(),
      outputSchema: toolResultSchema(createdPostSchema),
      annotations: createAnnotations,
    },
    async (input) =>
      runTool(context, "band_create_post", () =>
        createPost(
          context.client,
          context.env,
          input.band_key,
          input.content,
          input.do_push,
        ),
      ),
  );
}
