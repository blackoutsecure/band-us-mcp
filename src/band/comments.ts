import type { WorkerEnv } from "../env.js";
import { invalidBandResponse, type BandClient } from "./client.js";
import { requireWritePermission } from "./permissions.js";
import {
  cursorParameters,
  messageSchema,
  parseCursor,
  rawCommentsResultSchema,
  type CommentsResult,
  type CreatedComment,
  type PageCursor,
} from "./types.js";

export async function listComments(
  client: BandClient,
  bandKey: string,
  postKey: string,
  sort: "+created_at" | "-created_at",
  cursor?: PageCursor,
): Promise<CommentsResult> {
  const result = await client.request(
    {
      method: "GET",
      path: "/v2/band/post/comments",
      parameters: {
        band_key: bandKey,
        post_key: postKey,
        sort,
        ...cursorParameters(cursor),
      },
    },
    rawCommentsResultSchema,
  );
  if (
    result.items.some(
      (comment) =>
        (comment.band_key !== undefined && comment.band_key !== bandKey) ||
        (comment.post_key !== undefined && comment.post_key !== postKey),
    )
  ) {
    throw invalidBandResponse();
  }
  return {
    items: result.items,
    next_cursor: parseCursor(result.paging, bandKey, postKey),
  };
}

export async function createComment(
  client: BandClient,
  env: WorkerEnv,
  bandKey: string,
  postKey: string,
  body: string,
): Promise<CreatedComment> {
  await requireWritePermission(client, env, bandKey, "commenting");
  await client.request(
    {
      method: "POST",
      path: "/v2/band/post/comment/create",
      parameters: { band_key: bandKey, post_key: postKey, body },
    },
    messageSchema,
  );
  return { band_key: bandKey, post_key: postKey, created: true };
}
