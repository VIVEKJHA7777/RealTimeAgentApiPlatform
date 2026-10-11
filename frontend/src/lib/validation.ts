// Quick checks BEFORE sending a form, so obvious mistakes don't need a server round trip.
// They mirror the backend's Zod rules, but the backend stays the final judge.

export function validateEmail(value: string): string | undefined {
  const email = value.trim()
  if (!email) return 'Email is required'
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address'
}

export function validateNewPassword(value: string): string | undefined {
  if (value.length < 8) return 'Password must be at least 8 characters'
  if (value.length > 128) return 'Password must be at most 128 characters'
}

// Keeps only the fields that actually have an error.
export function compactErrors(errors: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message)) as Record<string, string>
}
