import { z } from 'zod';
import { FeedType } from '../../generated/prisma/client.js';

// The API's part of the public URL: /v1/<brand-slug>/<api-slug>, e.g. "live-prices".
// Unique within the brand (not worldwide: the brand slug is already unique), so no random
// suffix like brand slugs. Same character rules as brand slugs. Can be changed later (decided
// 2026-10-11): the URL changes at once, and a published API must get a new contract.
// Clean first (trim + lower-case), THEN check the rules.
// "new" is the frontend's Create API page (/brands/:slug/apis/new), so no API may be called that.
const RESERVED_API_SLUGS = new Set(['new']);
const apiSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .min(3, 'Slug must be at least 3 characters')
      .max(50, 'Slug must be at most 50 characters')
      .regex(
        /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
        'Use lowercase letters, numbers and single hyphens, starting with a letter',
      )
      .refine((slug) => !RESERVED_API_SLUGS.has(slug), 'This slug is reserved'),
  );

const name = z.string().trim().min(1, 'Name is required').max(100);
// contract/1 feed_type: product | review | store | content
const feedType = z.enum(FeedType);
const dataSourceId = z.string().trim().min(1, 'Choose the data this API answers from').max(100);

export const createApiSchema = z.object({
  name,
  slug: apiSlugSchema,
  feedType: feedType.default('product'),
  dataSourceId,
});

// Send only what changes. Unknown fields (e.g. "status") are ignored: publishing has its own
// endpoint later (Phase 4), so a body with nothing we know is a 400.
export const updateApiSchema = z
  .object({
    name: name.optional(),
    slug: apiSlugSchema.optional(),
    feedType: feedType.optional(),
    dataSourceId: dataSourceId.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Send at least one of: name, slug, feedType, dataSourceId',
  });

export type CreateApiInput = z.infer<typeof createApiSchema>;
export type UpdateApiInput = z.infer<typeof updateApiSchema>;
