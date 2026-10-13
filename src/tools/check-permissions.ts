import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { checkPermissions } from "../band/permissions.js";
import { keySchema, permissionSchema, permissionsResultSchema } from "../band/types.js";
import {
  readOnlyAnnotations,
  runTool,
  toolResultSchema,
  type ToolContext,
} from "../mcp/result.js";

export function registerCheckPermissions(
  server: McpServer,
  context: ToolContext,
): void {
  server.registerTool(
    "band_check_permissions",
    {
      title: "Check Band permissions",
      description:
        "Check the configured BAND account's write/delete permissions for band_key. permissions defaults to posting, commenting, contents_deletion. Read-only; deletion permission does not establish post authorship or operator approval.",
      inputSchema: z
        .object({
          band_key: keySchema,
          permissions: z
            .array(permissionSchema)
            .min(1)
            .max(3)
            .refine((values) => new Set(values).size === values.length)
            .default(["posting", "commenting", "contents_deletion"]),
        })
        .strict(),
      outputSchema: toolResultSchema(permissionsResultSchema),
      annotations: readOnlyAnnotations,
    },
    async (input) =>
      runTool(context, "band_check_permissions", () =>
        checkPermissions(context.client, input.band_key, input.permissions),
      ),
  );
}
