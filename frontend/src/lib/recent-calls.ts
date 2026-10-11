// Pure helpers for the Recent calls card (task 4.8c): how one recorded /v1 call reads.
// No React here (tested by docs/test-scripts/phase-04-task-4.8c-recent-calls-lib.test.ts).
import type { RecentCall } from './api-types'
import { formatBytes } from './format'

export const RECENT_CALLS_POLL_MS = 5_000
export const RECENT_CALLS_ID = 'recent-calls' // the card's element id (the self-check links to it)

export type Tone = 'ok' | 'partial' | 'fail'

// The "Result" column: what the caller got, in a few words.
//   200, all found → "2 found" (green) · some unknown → "1 found · 1 not found" (amber)
//   failure → its code, e.g. "TOKEN_EXPIRED" (red) · hung up → "no answer" (red)
export function callResult(call: RecentCall): { text: string; tone: Tone } {
  if (call.status === null) return { text: 'Caller left before the answer', tone: 'fail' }
  if (call.status >= 200 && call.status < 300) {
    const asked = call.idCount ?? 0
    const found = call.found ?? 0
    const missing = asked - found
    if (missing <= 0) return { text: `${found} found`, tone: 'ok' }
    return { text: `${found} found · ${missing} not found`, tone: found === 0 ? 'fail' : 'partial' }
  }
  return { text: call.errorCode ?? `HTTP ${call.status}`, tone: 'fail' }
}

// The "Token" part: by name, or what was wrong with it. Never the token itself (not stored).
export function tokenLabel(call: RecentCall): { text: string; problem: boolean } {
  switch (call.tokenKind) {
    case 'this_api':
      return { text: call.tokenName ?? 'a token of this API', problem: false }
    case 'other_api':
      return { text: "another API's token", problem: true }
    case 'unknown':
      return { text: 'unknown token', problem: true }
    case 'not_checked':
      return { text: 'token not checked', problem: false }
    default:
      return { text: 'no token', problem: true }
  }
}

// The header the token came in, as Jivox would write it.
export function headerLabel(call: RecentCall): string {
  if (call.header === 'x_api_key') return 'X-Api-Key'
  if (call.header === 'bearer') return 'Authorization: Bearer'
  return 'no token header'
}

// "7, 8" · "SKU-1, SKU-2, SKU-3 +9 more" (only the first 3 in the row; all 10 kept in details)
// "" = the call failed before its ids were read (the row then shows only the token)
export function idsLabel(call: RecentCall, shown = 3): string {
  if (call.idCount === null) return ''
  if (call.idCount === 0) return 'no ids'
  const first = call.ids.slice(0, shown)
  const more = call.idCount - first.length
  return `${first.join(', ')}${more > 0 ? ` +${more} more` : ''}`
}

// The body as sent: pretty JSON when the kept part parses, otherwise as is. Says when it was cut.
export function bodyView(call: RecentCall): { text: string; note: string | null } | null {
  if (call.body === null) {
    return call.bodyBytes > 0 ? { text: '', note: `Body of ${formatBytes(call.bodyBytes)} not kept (too large to read).` } : null
  }
  const cut = call.bodyBytes > new TextEncoder().encode(call.body).length
  let text = call.body
  if (!cut) {
    try {
      text = JSON.stringify(JSON.parse(call.body), null, 2)
    } catch {
      // not JSON (that's often why the call failed): show it exactly as sent
    }
  }
  return { text, note: cut ? `First 2 KB of ${formatBytes(call.bodyBytes)} shown.` : null }
}

// "12 ms" · "0.4 ms" · "1.2 s"
export function durationLabel(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`
  if (ms < 1) return `${ms.toFixed(1)} ms`
  return `${Math.round(ms)} ms`
}

// "12 Oct 2026, 14:02:31" (the details)
export function fullTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(iso))
}

// "14:02:31" today (seconds matter: several calls arrive within a minute) · "10 Oct, 14:02:31" before
export function timeLabel(iso: string, now = new Date()): string {
  const at = new Date(iso)
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(at)
  if (at.toDateString() === now.toDateString()) return time
  return `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(at)}, ${time}`
}
