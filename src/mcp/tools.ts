import type { McpServer } from "@modelcontextprotocol/server";
import { registerCheckPermissions } from "../tools/check-permissions.js";
import { registerCreateComment } from "../tools/create-comment.js";
import { registerCreatePost } from "../tools/create-post.js";
import { registerDeletePost } from "../tools/delete-post.js";
import { registerGetPost } from "../tools/get-post.js";
import { registerListBands } from "../tools/list-bands.js";
import { registerListComments } from "../tools/list-comments.js";
import { registerListPosts } from "../tools/list-posts.js";
import type { ToolContext } from "./result.js";

export function registerBandTools(
  server: McpServer,
  context: ToolContext,
): void {
  registerListBands(server, context);
  registerListPosts(server, context);
  registerGetPost(server, context);
  registerCreatePost(server, context);
  registerDeletePost(server, context);
  registerListComments(server, context);
  registerCreateComment(server, context);
  registerCheckPermissions(server, context);
}
