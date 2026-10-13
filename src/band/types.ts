import { z } from "zod";
import { invalidBandResponse } from "./client.js";

export const keySchema = z.string().min(1).max(512).regex(/^\S+$/);
export const permissionSchema = z.enum([
  "posting",
  "commenting",
  "contents_deletion",
]);
export type BandPermission = z.infer<typeof permissionSchema>;

export const cursorSchema = z
  .object({
    after: keySchema,
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type PageCursor = z.infer<typeof cursorSchema>;

export const bandSchema = z.object({
  band_key: keySchema,
  name: z.string(),
  cover: z.string(),
  member_count: z.number().int().nonnegative(),
});
export const bandsResultSchema = z.object({
  bands: z.array(bandSchema).max(1000),
});
export type BandsResult = z.infer<typeof bandsResultSchema>;

export const authorSchema = z.object({
  name: z.string(),
  user_key: keySchema.optional(),
  description: z.string().optional(),
  role: z.string().optional(),
  profile_image_url: z.string().nullable().optional(),
});
const photoSchema = z.object({
  url: z.string(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});
export const postSchema = z.object({
  band_key: keySchema,
  post_key: keySchema,
  content: z.string(),
  author: authorSchema,
  created_at: z.number().int().nonnegative(),
  comment_count: z.number().int().nonnegative(),
  emotion_count: z.number().int().nonnegative(),
  post_read_count: z.number().int().nonnegative().optional(),
  photos: z.array(photoSchema).optional(),
  photo: z.record(z.string(), photoSchema).nullable().optional(),
});
export const postResultSchema = z.object({ post: postSchema });
export type PostResult = z.infer<typeof postResultSchema>;

export const commentSchema = z.object({
  comment_key: keySchema,
  content: z.string(),
  author: authorSchema,
  created_at: z.number().int().nonnegative(),
  emotion_count: z.number().int().nonnegative(),
  band_key: keySchema.optional(),
  post_key: keySchema.optional(),
  photo: photoSchema.nullable().optional(),
});

const nextParamsSchema = z.object({
  after: keySchema,
  limit: z
    .union([
      z.number(),
      z.string().regex(/^\d+$/).transform(Number),
    ])
    .pipe(z.number().int().min(1).max(100))
    .optional(),
  band_key: keySchema.optional(),
  post_key: keySchema.optional(),
});
export const pagingSchema = z.object({
  next_params: nextParamsSchema.nullable(),
});
export type BandPaging = z.infer<typeof pagingSchema>;
export const rawPostsResultSchema = z.object({
  items: z.array(postSchema).max(1000),
  paging: pagingSchema,
});
export const postsResultSchema = z.object({
  items: z.array(postSchema),
  next_cursor: cursorSchema.nullable(),
});
export type PostsResult = z.infer<typeof postsResultSchema>;
export const rawCommentsResultSchema = z.object({
  items: z.array(commentSchema).max(1000),
  paging: pagingSchema,
});
export const commentsResultSchema = z.object({
  items: z.array(commentSchema),
  next_cursor: cursorSchema.nullable(),
});
export type CommentsResult = z.infer<typeof commentsResultSchema>;

export const permissionsResultSchema = z.object({
  permissions: z.array(permissionSchema).max(3),
});
// The official table uses "permissions"; its example uses "permission".
export const rawPermissionsResultSchema = z
  .union([
    permissionsResultSchema.strict(),
    z.object({ permission: z.array(permissionSchema).max(3) }).strict(),
  ])
  .transform((value) => ({
    permissions:
      "permissions" in value ? value.permissions : value.permission,
  }));
export type PermissionsResult = z.infer<typeof permissionsResultSchema>;

export const createdPostSchema = z.object({
  band_key: keySchema,
  post_key: keySchema,
});
export type CreatedPost = z.infer<typeof createdPostSchema>;
export const messageSchema = z.object({ message: z.literal("success") });
export const deletedPostSchema = z.object({
  band_key: keySchema,
  post_key: keySchema,
  deleted: z.literal(true),
});
export type DeletedPost = z.infer<typeof deletedPostSchema>;
export const createdCommentSchema = z.object({
  band_key: keySchema,
  post_key: keySchema,
  created: z.literal(true),
});
export type CreatedComment = z.infer<typeof createdCommentSchema>;
export const profileSchema = z.object({ user_key: keySchema });

export function cursorParameters(
  cursor: PageCursor | undefined,
): Record<string, string> {
  return cursor
    ? {
        after: cursor.after,
        ...(cursor.limit === undefined ? {} : { limit: String(cursor.limit) }),
      }
    : {};
}

export function parseCursor(
  paging: BandPaging,
  bandKey: string,
  postKey?: string,
): PageCursor | null {
  const next = paging.next_params;
  if (next === null) {
    return null;
  }
  if (
    (next.band_key !== undefined && next.band_key !== bandKey) ||
    (next.post_key !== undefined && next.post_key !== postKey)
  ) {
    throw invalidBandResponse();
  }
  return {
    after: next.after,
    ...(next.limit === undefined ? {} : { limit: next.limit }),
  };
}
