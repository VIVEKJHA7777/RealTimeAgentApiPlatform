import { z } from 'zod';

// Slugs that would clash with our own URLs or look official.
// ("new" is used by the frontend page /brands/new.)
const RESERVED_SLUGS = new Set([
  'api', 'v1', 'v2', 'admin', 'app', 'www', 'auth', 'login', 'logout', 'signup',
  'health', 'docs', 'static', 'assets', 'new', 'settings', 'brands', 'organizations',
]);

// The user picks the START of the slug; the server adds "-" + 6 random characters.
// 30 + 1 + 6 = 37 characters at most for the final slug.
export const SLUG_BASE_MAX_LENGTH = 30;

// Clean first (trim + lower-case), THEN check the rules.
// Regex: starts with a letter; letters/digits; single hyphens between parts
// (so no "--", no hyphen at the end).
const slugBaseSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .min(3, 'Slug must be at least 3 characters')
      .max(SLUG_BASE_MAX_LENGTH, `Slug must be at most ${SLUG_BASE_MAX_LENGTH} characters`)
      .regex(
        /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
        'Use lowercase letters, numbers and single hyphens, starting with a letter',
      )
      .refine((slug) => !RESERVED_SLUGS.has(slug), 'This slug is reserved'),
  );

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  slug: slugBaseSchema,
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
