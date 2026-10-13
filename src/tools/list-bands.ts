import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { listBands } from "../band/bands.js";
import { bandsResultSchema } from "../band/types.js";
import {
  readOnlyAnnotations,
  runTool,
  toolResultSchema,
  type ToolContext,
} from "../mcp/result.js";

export function registerListBands(
  server: McpServer,
  context: ToolContext,
): void {
  server.registerTool(
    "band_list_bands",
    {
      title: "List joined Bands",
      description:
        "List Bands joined by the configured BAND account. Use to discover band_key values. No arguments; read-only.",
      inputSchema: z.object({}).strict(),
      outputSchema: toolResultSchema(bandsResultSchema),
      annotations: readOnlyAnnotations,
    },
    async () =>
      runTool(context, "band_list_bands", () => listBands(context.client)),
  );
}
