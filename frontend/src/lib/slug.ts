// Slug helpers for the "Create brand" form.
// The rules mirror backend/src/modules/organizations/organizations.schemas.ts:
// if you change them there, change them here too. (The backend still has the final say.)

export const SLUG_BASE_MIN = 3
export const SLUG_BASE_MAX = 30
export const SLUG_SUFFIX_LENGTH = 6 // added by the server: "-" + 6 random characters

const RESERVED_SLUGS = new Set([
  'api', 'v1', 'v2', 'admin', 'app', 'www', 'auth', 'login', 'logout', 'signup',
  'health', 'docs', 'static', 'assets', 'new', 'settings', 'brands', 'organizations',
])

// "Café Ünïcode & Co." → "cafe-unicode-co"  ·  "3M Company" → "m-company"
export function suggestSlug(name: string): string {
  return name
    .normalize('NFKD') // split "é" into "e" + accent mark...
    .replace(/[̀-ͯ]/g, '') // ...and drop the accent marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // anything else becomes a hyphen
    .replace(/^[^a-z]+/, '') // must start with a letter
    .slice(0, SLUG_BASE_MAX)
    .replace(/-+$/, '') // no hyphen at the end
}

// While typing in the slug field: lower-case, spaces → hyphens.
export function normalizeSlugInput(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-')
}

export function validateSlugBase(value: string): string | undefined {
  const slug = value.trim().toLowerCase()
  if (slug.length < SLUG_BASE_MIN) return `Slug must be at least ${SLUG_BASE_MIN} characters`
  if (slug.length > SLUG_BASE_MAX) return `Slug must be at most ${SLUG_BASE_MAX} characters`
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(slug)) {
    return 'Use lowercase letters, numbers and single hyphens, starting with a letter'
  }
  if (RESERVED_SLUGS.has(slug)) return 'This slug is reserved'
}
