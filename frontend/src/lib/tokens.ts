// Pure helpers for the Tokens card (task 4.6): expiry choices → dates, and how a token's expiry
// and state are shown. No React here (tested by docs/test-scripts/phase-04-task-4.6-tokens-lib.test.ts).
import type { AuthHeaderStyle, TokenInfo } from './api-types'

const DAY = 24 * 60 * 60 * 1000
export const SOON_DAYS = 7 // "Expires in N days" turns amber at 7 days or fewer
export const MAX_EXPIRY_YEARS = 10 // same limit as the server

// The expiry choices in the dialogs. Presets count from NOW; "date" = the END of that day in the
// user's own time zone (P4-16).
export type ExpiryChoice = { kind: 'never' } | { kind: 'days'; days: number } | { kind: 'date'; date: string } // date = "YYYY-MM-DD"
export const EXPIRY_PRESETS: { label: string; choice: ExpiryChoice }[] = [
  { label: 'Never', choice: { kind: 'never' } },
  { label: '30 days', choice: { kind: 'days', days: 30 } },
  { label: '90 days', choice: { kind: 'days', days: 90 } },
  { label: '1 year', choice: { kind: 'days', days: 365 } },
]

// What the server gets: an ISO date-time (with zone) or null for never.
// A "date" choice that is empty, malformed, today-or-earlier or > 10 years away → an error text.
export function expiryToIso(choice: ExpiryChoice, now = new Date()): { iso: string | null } | { error: string } {
  if (choice.kind === 'never') return { iso: null }
  if (choice.kind === 'days') return { iso: new Date(now.getTime() + choice.days * DAY).toISOString() }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(choice.date)
  if (!match) return { error: 'Pick a date' }
  const end = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999)
  if (Number.isNaN(end.getTime()) || end.getDate() !== Number(match[3])) return { error: 'Pick a real date' }
  if (end.getTime() <= now.getTime()) return { error: 'Pick a date in the future' }
  if (end.getTime() > now.getTime() + MAX_EXPIRY_YEARS * 366 * DAY) {
    return { error: `At most ${MAX_EXPIRY_YEARS} years away (choose Never instead)` }
  }
  return { iso: end.toISOString() }
}

// The <input type="date"> limits: today … 10 years from now (local dates).
export function dateInputBounds(now = new Date()) {
  const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const max = new Date(now)
  max.setFullYear(max.getFullYear() + MAX_EXPIRY_YEARS)
  max.setDate(max.getDate() - 1)
  return { min: local(now), max: local(max) }
}

// "until 10 Nov 2026" (for "Works again until …" / "Expires …" hints)
export function expiryHint(iso: string | null): string {
  if (iso === null) return 'Never expires'
  return `Until ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))}`
}

export type ExpiryLook = { text: string; tone: 'muted' | 'normal' | 'soon' | 'expired' | 'revoked'; title?: string }

// How the expiry cell reads.
//   never → "Never" · far away → "15 Nov 2026" · ≤ 7 days → "Expires in 5 days" (amber)
//   past → "Expired 1 Oct" (red) · revoked → "Revoked 2 Oct"
export function expiryLook(token: Pick<TokenInfo, 'state' | 'expiresAt' | 'revokedAt'>, now = new Date()): ExpiryLook {
  const day = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...(new Date(iso).getFullYear() !== now.getFullYear() && { year: 'numeric' }) }).format(new Date(iso))
  const full = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  if (token.state === 'revoked' && token.revokedAt) return { text: `Revoked ${day(token.revokedAt)}`, tone: 'revoked', title: full(token.revokedAt) }
  if (!token.expiresAt) return { text: 'Never', tone: 'muted' }
  const left = new Date(token.expiresAt).getTime() - now.getTime()
  if (token.state === 'expired' || left <= 0) return { text: `Expired ${day(token.expiresAt)}`, tone: 'expired', title: full(token.expiresAt) }
  if (left <= SOON_DAYS * DAY) return { text: `Expires ${inWords(left)}`, tone: 'soon', title: full(token.expiresAt) }
  return { text: day(token.expiresAt), tone: 'normal', title: `Expires ${full(token.expiresAt)}` }
}

// 5 days → "in 5 days" · 3 h → "in 3 hours" · 20 min → "in 20 minutes" · < 1 min → "in under a minute"
function inWords(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'in under a minute'
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24) // 1 day 23 h → "in 2 days" (nearer the truth than "1 day")
  return `in ${days} day${days === 1 ? '' : 's'}`
}

// "rtk_8Hf2••••••••" (what the list shows while a token is hidden)
export const maskedToken = (hint: string) => `${hint}${'•'.repeat(8)}`

// The header Jivox sends, as shown next to the style choice and in the created dialog.
export function headerExample(style: AuthHeaderStyle, token = 'rtk_…') {
  return style === 'bearer' ? `Authorization: Bearer ${token}` : `X-Api-Key: ${token}`
}

// Not-revoked tokens count toward the limit of 20 (expired ones too: Extend can revive them).
export const countsTowardLimit = (tokens: TokenInfo[]) => tokens.filter((t) => t.state !== 'revoked').length
