// Pure helpers for the test switches (task 7.6): the card's groups, how a switch that's on reads
// ("Agent 2 only · ends 23:42, in 42 min"), the banner's sentence, the form's choices. No React here
// (tested by docs/test-scripts/phase-07-task-7.6-switches-lib.test.ts).
import type { ActiveSwitch, SwitchKind } from './api-types'
import { switchName } from './logs'

export const SWITCHES_POLL_MS = 30_000
export const SWITCHES_CARD_ID = 'test-switches' // the Test tab's card (the banner's "Manage" goes there)
export const DURATIONS = [
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 h' },
  { minutes: 240, label: '4 h' },
] as const
export const DEFAULT_MINUTES = 60
export const HTTP_STATUSES = [400, 401, 403, 404, 429, 500, 502, 503] as const
export const SLOW_DEFAULT_MS = 3_500
export const SLOW_PRESETS = [3_500, 5_000, 10_000] as const

// The card's groups, in this order.
export const SWITCH_GROUPS: { title: string; kinds: SwitchKind[] }[] = [
  { title: 'The answer', kinds: ['http_status', 'status_failure', 'no_store', 'not_json'] },
  { title: 'Ids', kinds: ['drop_id', 'duplicate_id', 'extra_id', 'item_without_id', 'empty_data'] },
  { title: 'Fields', kinds: ['wrong_type'] },
  { title: 'Timing', kinds: ['slow'] },
  { title: 'The request', kinds: ['strict'] },
]

// The server's clock may differ from this computer's: count from the server's `now`.
export const clockOffset = (serverNow: string, localNow = Date.now()) => new Date(serverNow).getTime() - localNow

// "in less than a minute" · "in 42 min" · "in 1 h" · "in 3 h 5 min" · "now" (ended, not swept yet)
export function endsIn(endsAt: string, now: number): string {
  const ms = new Date(endsAt).getTime() - now
  if (ms <= 0) return 'now'
  const minutes = Math.ceil(ms / 60_000)
  if (minutes <= 1) return ms < 60_000 ? 'in less than a minute' : 'in 1 min'
  if (minutes < 60) return `in ${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `in ${h} h${m > 0 ? ` ${m} min` : ''}`
}

// When a switch ends, to the minute: "02:12" today, "13 Oct, 02:12" another day.
export function clockLabel(iso: string, now = Date.now()): string {
  const at = new Date(iso)
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(at)
  if (at.toDateString() === new Date(now).toDateString()) return time
  return `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(at)}, ${time}`
}

// "every caller" · "Agent 2 only" · "Agent 1, Agent 2 only" · "token "Spare" only" (+ revoked)
export function scopeLabel(sw: ActiveSwitch): string {
  if (!sw.scope) return 'every caller'
  const agents = sw.scope.agents.map((a) => a.name)
  const who = agents.length > 0 ? agents.join(', ') : `token "${sw.scope.tokenName}"`
  return `${who} only${sw.scope.revoked ? ' (token revoked: no calls match)' : ''}`
}

// The banner's one line per switch: "Drop an id (Agent 2 only, ends in 42 min)"
export function bannerItem(sw: ActiveSwitch, now: number): string {
  const own = sw.applyToOwnChecks ? ', our own checks too' : ''
  return `${switchName(sw.kind, sw.options)} (${scopeLabel(sw)}${own}, ends ${endsIn(sw.endsAt, now)})`
}

export function bannerTitle(count: number): string {
  return count === 1 ? '1 test switch on: this API answers wrongly on purpose.' : `${count} test switches on: this API answers wrongly on purpose.`
}

// When the banner must look again: the first switch to end (null = none on).
export function nextEnd(switches: ActiveSwitch[]): number | null {
  const ends = switches.map((s) => new Date(s.endsAt).getTime())
  return ends.length > 0 ? Math.min(...ends) : null
}

// Switches still running at `now` (the server ends them; the page hides them at once).
export const running = (switches: ActiveSwitch[], now: number) => switches.filter((s) => new Date(s.endsAt).getTime() > now)

// The switches that hit one agent: aimed at its token, or at every caller.
export function forToken(switches: ActiveSwitch[], tokenId: string | null): { mine: ActiveSwitch[]; everyone: ActiveSwitch[] } {
  return {
    mine: tokenId ? switches.filter((s) => s.scope?.tokenId === tokenId) : [],
    everyone: switches.filter((s) => s.scope === null),
  }
}

// What the form sends for a kind (only the options that kind takes).
export function optionsFor(kind: SwitchKind, form: { field: string; ms: number; status: number }): Record<string, unknown> {
  if (kind === 'wrong_type') return { field: form.field }
  if (kind === 'slow') return { ms: form.ms }
  if (kind === 'http_status') return { status: form.status }
  return {}
}

// A slow time typed by hand: a whole number 1..30 000, or the reason it isn't.
export function slowProblem(text: string): string | null {
  if (!/^\d+$/.test(text.trim())) return 'A whole number of milliseconds'
  const ms = Number(text)
  if (ms < 1) return 'At least 1 ms'
  if (ms > 30_000) return 'At most 30 000 ms'
  return null
}

// Scope choices: every caller, then each ACTIVE token (by its agents' names when it has some).
export function scopeChoices(
  tokens: { id: string; name: string; revokedAt: string | null }[],
  agents: { name: string; token: { id: string } | null }[],
): { value: string; label: string }[] {
  const byToken = new Map<string, string[]>()
  for (const a of agents) if (a.token) byToken.set(a.token.id, [...(byToken.get(a.token.id) ?? []), a.name])
  return [
    { value: 'all', label: 'Every caller' },
    ...tokens
      .filter((t) => !t.revokedAt)
      .map((t) => {
        const names = byToken.get(t.id)
        return { value: t.id, label: names ? `${names.join(', ')} (${t.name})` : `Token "${t.name}" (no agent)` }
      }),
  ]
}
