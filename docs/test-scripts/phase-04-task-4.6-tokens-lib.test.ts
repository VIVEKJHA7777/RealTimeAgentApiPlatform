// Task 4.6: checks of the Tokens card's pure helpers (frontend/src/lib/tokens.ts): expiry choices →
// dates (presets from now, "pick a date" = end of that day in the user's time zone), limits, and how
// expiry / state are shown. No browser, no backend.
//   cd frontend && npx tsx ../docs/test-scripts/phase-04-task-4.6-tokens-lib.test.ts
// Runs in the machine's time zone; also run with TZ=America/Los_Angeles / TZ=Asia/Kolkata.
import { countsTowardLimit, dateInputBounds, expiryLook, expiryToIso, headerExample, maskedToken } from '../../frontend/src/lib/tokens.ts'
let pass = 0, fail = 0
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`) }
const DAY = 864e5
const now = new Date(2026, 9, 11, 15, 30) // 11 Oct 2026 15:30 local
const iso = (r: ReturnType<typeof expiryToIso>) => ('iso' in r ? r.iso : `ERR ${r.error}`)

// presets
eq('Never → null', iso(expiryToIso({ kind: 'never' }, now)), null)
eq('30 days = now + 30 × 24 h exactly', new Date(iso(expiryToIso({ kind: 'days', days: 30 }, now))!).getTime() - now.getTime(), 30 * DAY)
eq('1 year preset = 365 days', new Date(iso(expiryToIso({ kind: 'days', days: 365 }, now))!).getTime() - now.getTime(), 365 * DAY)
// pick a date: END of that day, local time
const end = new Date(iso(expiryToIso({ kind: 'date', date: '2026-12-01' }, now))!)
eq('"2026-12-01" → 1 Dec 23:59:59.999 local', [end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()], [2026, 11, 1, 23, 59, 59, 999])
eq('today → still allowed (works until tonight)', 'iso' in expiryToIso({ kind: 'date', date: '2026-10-11' }, now), true)
eq('yesterday → "in the future" error', iso(expiryToIso({ kind: 'date', date: '2026-10-10' }, now)), 'ERR Pick a date in the future')
eq('empty / malformed / impossible date', ['', '2026-1-5', '2026-02-30'].map((d) => iso(expiryToIso({ kind: 'date', date: d }, now))), ['ERR Pick a date', 'ERR Pick a date', 'ERR Pick a real date'])
eq('> 10 years → error, says choose Never', iso(expiryToIso({ kind: 'date', date: '2037-01-01' }, now)), 'ERR At most 10 years away (choose Never instead)')
eq('9 years → ok', 'iso' in expiryToIso({ kind: 'date', date: '2035-10-11' }, now), true)
eq('date input bounds: today … 10 years − 1 day (local)', dateInputBounds(now), { min: '2026-10-11', max: '2036-10-10' })
eq('every bound date is accepted', [dateInputBounds(now).min, dateInputBounds(now).max].map((d) => 'iso' in expiryToIso({ kind: 'date', date: d }, now)), [true, true])

// how expiry reads
const t = (o: object) => ({ state: 'active', expiresAt: null, revokedAt: null, ...o }) as never
const inDays = (d: number) => new Date(now.getTime() + d * DAY).toISOString()
eq('never → "Never" (muted)', expiryLook(t({}), now), { text: 'Never', tone: 'muted' })
eq('in 30 days → its date (normal)', [expiryLook(t({ expiresAt: inDays(30) }), now).text, expiryLook(t({ expiresAt: inDays(30) }), now).tone], ['10 Nov', 'normal'])
eq('next year → date with the year', expiryLook(t({ expiresAt: inDays(120) }), now).text, '8 Feb 2027')
eq('in 5 days → "Expires in 5 days" (soon)', [expiryLook(t({ expiresAt: inDays(5.2) }), now).text, expiryLook(t({ expiresAt: inDays(5.2) }), now).tone], ['Expires in 5 days', 'soon'])
eq('exactly 7 days → soon; 7 days + 1 min → normal', [expiryLook(t({ expiresAt: inDays(7) }), now).tone, expiryLook(t({ expiresAt: new Date(now.getTime() + 7 * DAY + 60000).toISOString() }), now).tone], ['soon', 'normal'])
eq('in 3 h / 20 min / 30 s', [3 / 24, 20 / 1440, 30 / 86400].map((d) => expiryLook(t({ expiresAt: inDays(d) }), now).text), ['Expires in 3 hours', 'Expires in 20 minutes', 'Expires in under a minute'])
eq('1 day 23 h → "in 2 days" (rounded); 1 day 2 h → "in 1 day"', [1 + 23 / 24 - 0.001, 1 + 2 / 24].map((d) => expiryLook(t({ expiresAt: inDays(d) }), now).text), ['Expires in 2 days', 'Expires in 1 day'])
eq('1 hour / 1 day singular', [1 / 24, 1].map((d) => expiryLook(t({ expiresAt: inDays(d) }), now).text), ['Expires in 1 hour', 'Expires in 1 day'])
eq('past → "Expired 1 Oct" (expired)', [expiryLook(t({ state: 'expired', expiresAt: new Date(2026, 9, 1, 12).toISOString() }), now).text, expiryLook(t({ state: 'expired', expiresAt: new Date(2026, 9, 1, 12).toISOString() }), now).tone], ['Expired 1 Oct', 'expired'])
eq('server still says active but the time passed → expired (no waiting for a reload)', expiryLook(t({ state: 'active', expiresAt: inDays(-0.01) }), now).tone, 'expired')
eq('revoked wins → "Revoked 2 Oct"', expiryLook(t({ state: 'revoked', expiresAt: inDays(-3), revokedAt: new Date(2026, 9, 2, 9).toISOString() }), now).text, 'Revoked 2 Oct')

// small helpers
eq('masked token', maskedToken('rtk_8Hf2'), 'rtk_8Hf2••••••••')
eq('header examples', [headerExample('x-api-key'), headerExample('bearer', 'T')], ['X-Api-Key: rtk_…', 'Authorization: Bearer T'])
eq('limit counts active + expired, not revoked', countsTowardLimit([{ state: 'active' }, { state: 'expired' }, { state: 'revoked' }] as never), 2)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
