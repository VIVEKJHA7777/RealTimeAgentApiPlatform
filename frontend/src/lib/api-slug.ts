// Slug helpers for APIs (the last part of /v1/<brand>/<api-slug>).
// Mirror backend/src/modules/apis/apis.schemas.ts (the backend has the final say).
import { suggestSlug } from './slug'

export const API_SLUG_MIN = 3
export const API_SLUG_MAX = 50
const RESERVED_API_SLUGS = new Set(['new']) // /brands/:slug/apis/new is the Create API page

// "Live prices (US)" → "live-prices-us"
export function suggestApiSlug(name: string): string {
  return suggestSlug(name.slice(0, 200)).slice(0, API_SLUG_MAX).replace(/-+$/, '')
}

export function validateApiSlug(value: string): string | undefined {
  const slug = value.trim().toLowerCase()
  if (slug.length < API_SLUG_MIN) return `Slug must be at least ${API_SLUG_MIN} characters`
  if (slug.length > API_SLUG_MAX) return `Slug must be at most ${API_SLUG_MAX} characters`
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(slug)) {
    return 'Use lowercase letters, numbers and single hyphens, starting with a letter'
  }
  if (RESERVED_API_SLUGS.has(slug)) return 'This slug is reserved'
}
