import type { WorkerEnv } from "../env.js";
import { IntegrationError } from "../errors.js";
import { invalidBandResponse, type BandClient } from "./client.js";
import { requireWritePermission } from "./permissions.js";
import {
  createdPostSchema,
  cursorParameters,
  messageSchema,
  parseCursor,
  postResultSchema,
  profileSchema,
  rawPostsResultSchema,
  type CreatedPost,
  type DeletedPost,
  type PageCursor,
  type PostResult,
  type PostsResult,
} from "./types.js";

export async function listPosts(
  client: BandClient,
  bandKey: string,
  locale: string,
  cursor?: PageCursor,
): Promise<PostsResult> {
  const result = await client.request(
    {
      method: "GET",
      path: "/v2/band/posts",
      parameters: {
        band_key: bandKey,
        locale,
        ...cursorParameters(cursor),
      },
    },
    rawPostsResultSchema,
  );
  if (result.items.some((post) => post.band_key !== bandKey)) {
    throw invalidBandResponse();
  }
  return {
    items: result.items,
    next_cursor: parseCursor(result.paging, bandKey),
  };
}

export async function getPost(
  client: BandClient,
  bandKey: string,
  postKey: string,
): Promise<PostResult> {
  const result = await client.request(
    {
      method: "GET",
      path: "/v2.1/band/post",
      parameters: { band_key: bandKey, post_key: postKey },
    },
    postResultSchema,
  );
  if (
    result.post.band_key !== bandKey ||
    result.post.post_key !== postKey
  ) {
    throw invalidBandResponse();
  }
  return result;
}

export async function createPost(
  client: BandClient,
  env: WorkerEnv,
  bandKey: string,
  content: string,
  doPush: boolean,
): Promise<CreatedPost> {
  await requireWritePermission(client, env, bandKey, "posting");
  const result = await client.request(
    {
      method: "POST",
      path: "/v2.2/band/post/create",
      parameters: {
        band_key: bandKey,
        content,
        do_push: String(doPush),
      },
    },
    createdPostSchema,
  );
  if (result.band_key !== bandKey) {
    throw invalidBandResponse();
  }
  return result;
}

export async function deletePost(
  client: BandClient,
  env: WorkerEnv,
  bandKey: string,
  postKey: string,
): Promise<DeletedPost> {
  await requireWritePermission(client, env, bandKey, "contents_deletion");
  const { post } = await getPost(client, bandKey, postKey);
  const profile = await client.request(
    {
      method: "GET",
      path: "/v2/profile",
      parameters: { band_key: bandKey },
    },
    profileSchema,
  );
  if (post.author.user_key === undefined) {
    throw invalidBandResponse();
  }
  if (post.author.user_key !== profile.user_key) {
    throw new IntegrationError(
      "PERMISSION_DENIED",
      "This server only deletes posts authored by its configured BAND account.",
      "permission",
    );
  }
  await client.request(
    {
      method: "POST",
      path: "/v2/band/post/remove",
      parameters: { band_key: bandKey, post_key: postKey },
    },
    messageSchema,
  );
  return { band_key: bandKey, post_key: postKey, deleted: true };
}
