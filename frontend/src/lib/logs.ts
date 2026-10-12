// Pure helpers for the Logs tab (task 7.5): how one call-log line reads, the filters in the page
// address, the switch lines, the request check. No React here (tested by
// docs/test-scripts/phase-07-task-7.5-logs-lib.test.ts).
import type { CheckItem, LogEntry, LogFilters, LogToken, SwitchEvent, SwitchKind } from './api-types'
import type { Tone } from './recent-calls'

export const LOGS_POLL_MS = 3_000
export const LOGS_PAGE = 50

// ── Filters ⇄ the page address (?status=failed&token=…&since=1h): Back, reload and links keep them ──
export const SINCE = { '15m': 15, '1h': 60, '24h': 24 * 60, all: null } as const
export type Since = keyof typeof SINCE
export type FilterState = {
  status: '' | 'ok' | 'failed'
  token: string // '' = all, 'none', or a token id
  check: '' | 'passed' | 'failed'
  switched: '' | 'yes' | 'no'
  id: string
  since: Since
}
export const NO_FILTERS: FilterState = { status: '', token: '', check: '', switched: '', id: '', since: 'all' }

export function filtersFromSearch(search: URLSearchParams): FilterState {
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = search.get(key) as T | null
    return value !== null && allowed.includes(value) ? value : fallback
  }
  return {
    status: pick('status', ['ok', 'failed'] as const, ''),
    token: (search.get('token') ?? '').slice(0, 64),
    check: pick('check', ['passed', 'failed'] as const, ''),
    switched: pick('switched', ['yes', 'no'] as const, ''),
    id: (search.get('id') ?? '').trim().slice(0, 100),
    since: pick('since', Object.keys(SINCE) as Since[], 'all'),
  }
}

// Only what differs from "no filter" goes in the address. `open` (the drawer) is kept as it is.
export function searchFromFilters(filters: FilterState, current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value !== '' && value !== 'all') next.set(key, value)
  const open = current.get('open')
  if (open) next.set('open', open)
  return next
}

// What the API is asked (the time window counts from `now`, each time the list loads).
export function apiFilters(filters: FilterState, now = new Date()): LogFilters {
  const minutes = SINCE[filters.since]
  return {
    ...(filters.status && { status: filters.status }),
    ...(filters.token && { token: filters.token }),
    ...(filters.check && { check: filters.check }),
    ...(filters.switched && { switched: filters.switched }),
    ...(filters.id && { id: filters.id }),
    ...(minutes !== null && { from: new Date(now.getTime() - minutes * 60_000).toISOString() }),
  }
}

export const filtersActive = (f: FilterState) => Object.entries(f).some(([k, v]) => (k === 'since' ? v !== 'all' : v !== ''))
// Switch lines only show without call filters (the server leaves them out otherwise).
export const showsSwitchLines = (f: FilterState) => !f.status && !f.token && !f.check && !f.switched && !f.id

// ── One call ──
// "Agent 2" (the agents using that token now) · the token's name · or what was wrong with it.
export function whoLabel(entry: LogEntry, tokens: Record<string, LogToken>): { text: string; detail: string | null; problem: boolean } {
  switch (entry.tokenKind) {
    case 'this_api': {
      const token = entry.tokenId ? tokens[entry.tokenId] : undefined
      const name = token?.name ?? entry.tokenName ?? 'a token of this API'
      const agents = token?.agents.map((a) => a.name) ?? []
      if (agents.length > 0) return { text: agents.join(', '), detail: `token "${name}"${token?.revoked ? ' (revoked since)' : ''}`, problem: false }
      return { text: name, detail: token?.revoked ? 'revoked since' : null, problem: false }
    }
    case 'other_api':
      return { text: "another API's token", detail: null, problem: true }
    case 'unknown':
      return { text: 'unknown token', detail: null, problem: true }
    case 'not_checked':
      return { text: 'token not checked', detail: null, problem: false }
    default:
      return { text: 'no token', detail: null, problem: true }
  }
}

// The "Result" column. 2xx: found / not found (from OUR data, before any switch); a switch that
// broke the envelope says so ("status failure", "not JSON"); failures: their code.
export function entryResult(entry: LogEntry): { text: string; tone: Tone } {
  if (entry.status === null) return { text: 'Caller left before the answer', tone: 'fail' }
  if (entry.status >= 200 && entry.status < 300) {
    if (entry.envelopeStatus === null) return { text: 'not JSON', tone: 'fail' }
    if (entry.envelopeStatus !== 'success') return { text: 'status "failure"', tone: 'fail' }
    const asked = entry.idCount ?? 0
    const found = entry.found ?? 0
    const missing = asked - found
    // A switch changed what was sent: never shown as a clean success (the badge says which).
    if (missing <= 0) return { text: `${found} found`, tone: entry.switches.length > 0 ? 'partial' : 'ok' }
    return { text: `${found} found · ${missing} not found`, tone: found === 0 ? 'fail' : 'partial' }
  }
  return { text: entry.errorCodes[0] ?? `HTTP ${entry.status}`, tone: 'fail' }
}

// "SKU-1, SKU-2, SKU-3 +9 more" · "" (failed before the ids were read)
export function entryIds(entry: LogEntry, shown = 3): string {
  if (entry.idCount === null) return ''
  if (entry.idCount === 0) return 'no ids'
  const first = entry.ids.slice(0, shown)
  const more = entry.idCount - first.length
  return `${first.join(', ')}${more > 0 ? ` +${more} more` : ''}`
}

// ── Switches ──
export const SWITCH_LABEL: Record<SwitchKind, string> = {
  no_store: 'No "no-store"',
  status_failure: 'Status "failure"',
  duplicate_id: 'Duplicate an id',
  drop_id: 'Drop an id',
  extra_id: 'Extra id',
  item_without_id: 'Item without id',
  wrong_type: 'Wrong type',
  slow: 'Slow answer',
  http_status: 'HTTP status',
  empty_data: 'Empty data',
  not_json: 'Not JSON',
  strict: 'Strict mode',
}
const ACTION = { on: 'turned on', changed: 'changed', off: 'turned off', ended: 'ended by itself' } as const

// "Slow answer (3 500 ms)" · "Wrong type (price)" · "HTTP status (503)"
export function switchName(kind: SwitchKind, options: Record<string, unknown> = {}): string {
  const extra = kind === 'slow' ? `${Number(options.ms ?? 3500).toLocaleString('en-US').replace(/,/g, ' ')} ms` : kind === 'wrong_type' ? String(options.field ?? '') : kind === 'http_status' ? String(options.status ?? 500) : ''
  return extra ? `${SWITCH_LABEL[kind]} (${extra})` : SWITCH_LABEL[kind]
}

// "Drop an id turned on for Agent 2's token, until 15:02, by vivek@jivox.com"
export function switchEventText(event: SwitchEvent, tokens: Record<string, LogToken>, timeOf: (iso: string) => string): string {
  const scope = event.scope
    ? (() => {
        const t = tokens[event.scope.tokenId]
        const agents = t?.agents.map((a) => a.name) ?? []
        return ` for ${agents.length > 0 ? agents.join(', ') : `"${t?.name ?? event.scope.tokenName ?? 'a token'}"`} only`
      })()
    : ' for every caller'
  const until = event.action === 'on' || event.action === 'changed' ? `, until ${timeOf(event.endsAt)}` : ''
  const own = (event.action === 'on' || event.action === 'changed') && event.applyToOwnChecks ? ', our own checks too' : ''
  const by = event.by ? `, by ${event.by}` : ''
  return `${switchName(event.switch, event.options)} ${ACTION[event.action]}${event.action === 'off' || event.action === 'ended' ? '' : scope}${until}${own}${by}`
}

// ── The request check, one line per item ──
export function checkLine(item: CheckItem): string {
  if (item.part === 'method') return `Method: expected ${item.expected}, got ${item.got}`
  if (item.part === 'ids') return `${item.name}: ${item.got ?? 0} id${item.got === '1' ? '' : 's'}`
  // "items[].cat (category): missing in 2 of 3 · SKU-1002, SKU-2049"
  if (item.missingFor) return `${item.name}: ${item.got} · ${item.missingFor.join(', ')}`
  if (item.got === undefined) return `${item.name}: missing${item.expected !== undefined ? ` (expected "${item.expected}")` : ''}`
  if (item.expected !== undefined) return item.ok ? `${item.name} = "${item.got}"` : `${item.name}: expected "${item.expected}", got "${item.got}"`
  return item.ok ? `${item.name} = "${item.got}"` : `${item.name}: empty`
}

// A body for display: pretty JSON when it parses (and wasn't cut), else as is.
export function prettyBody(text: string | null, cut: boolean): string | null {
  if (text === null) return null
  if (cut) return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

// Agent filter options: each token of the API, by its agents' names when it has some.
export function tokenOptions(
  tokens: { id: string; name: string; revokedAt: string | null }[],
  agents: { name: string; token: { id: string } | null }[],
): { value: string; label: string }[] {
  const byToken = new Map<string, string[]>()
  for (const a of agents) if (a.token) byToken.set(a.token.id, [...(byToken.get(a.token.id) ?? []), a.name])
  const active = tokens.filter((t) => !t.revokedAt)
  const revoked = tokens.filter((t) => t.revokedAt)
  return [
    ...[...active, ...revoked].map((t) => {
      const names = byToken.get(t.id)
      const base = names ? `${names.join(', ')} · ${t.name}` : t.name
      return { value: t.id, label: t.revokedAt ? `${base} (revoked)` : base }
    }),
    { value: 'none', label: 'No token of this API' },
  ]
}
