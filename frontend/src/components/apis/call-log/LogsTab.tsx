import { FilterX, ListTree, Loader2, Pause, Play, Search, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useApiPage } from '@/components/apis/api-page/context'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { agentsApi, ApiError, logsApi } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import {
  filtersActive,
  filtersFromSearch,
  LOGS_POLL_MS,
  NO_FILTERS,
  searchFromFilters,
  showsSwitchLines,
  tokenOptions,
  type FilterState,
} from '@/lib/logs'
import { useCallLog } from '@/lib/use-call-log'
import { useRequest } from '@/lib/use-request'
import { useTokens } from '@/lib/use-tokens'
import { cn } from '@/lib/utils'
import { LogDetailSheet } from './LogDetailSheet'
import { LogRow, SwitchLine } from './LogRow'
import { LIST_COLUMNS } from './styles'

// The API page's Logs tab (task 7.5, mockup approved 2026-10-12): every call to the live URL, newest
// first, live (every 3 s; Pause), filters in the page address, one call in a side drawer
// (?open=<id>, also how Recent calls links here), Load older, Clear (asks first).
export function LogsTab() {
  const { organization, api } = useApiPage()
  const [search, setSearch] = useSearchParams()
  const filters = filtersFromSearch(search)
  const openId = search.get('open')
  const [userPaused, setUserPaused] = useState(false)
  const paused = userPaused || openId !== null // reading one call: the list holds still
  const log = useCallLog(organization.slug, api.slug, filters, paused)
  const tokens = useTokens(organization.slug, api.slug)
  const agents = useRequest(`agents:${organization.slug}/${api.slug}`, () => agentsApi.list(organization.slug, api.slug))
  const options = tokenOptions(
    (tokens.data?.tokens ?? []).map((t) => ({ id: t.id, name: t.name, revokedAt: t.revokedAt })),
    agents.data?.agents ?? [],
  )
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const clearButton = useRef<HTMLButtonElement>(null)
  const listTop = useRef<HTMLHeadingElement>(null)

  const setFilters = (next: Partial<FilterState>) => setSearch((current) => searchFromFilters({ ...filtersFromSearch(current), ...next }, current), { replace: true })
  const openEntry = (id: string | null) =>
    setSearch((current) => {
      const next = new URLSearchParams(current)
      if (id) next.set('open', id)
      else next.delete('open')
      return next
    })

  async function clear() {
    setClearing(true)
    try {
      const { cleared } = await logsApi.clear(organization.slug, api.slug)
      setClearOpen(false)
      await log.reload()
      toast.success(cleared === 1 ? '1 call cleared' : `${formatNumber(cleared)} calls cleared`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't clear the log")
    } finally {
      setClearing(false)
    }
  }

  const url = `/v1/${organization.slug}/${api.slug}`
  const active = filtersActive(filters)
  const shownCalls = log.entries.filter((e) => e.kind === 'call').length

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="log-heading" className="@container rounded-2xl border bg-background">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-4">
          <div className="min-w-60 flex-1">
            <h2 id="log-heading" ref={listTop} tabIndex={-1} className="flex items-center gap-2 font-semibold outline-none">
              <ListTree className="size-4 text-muted-foreground" aria-hidden="true" />
              Call log
              {!log.loading && !log.error && (
                <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground" title={paused ? 'New calls wait until you resume' : `Checks for new calls every ${LOGS_POLL_MS / 1000} seconds`}>
                  <span className="relative flex size-2" aria-hidden="true">
                    {!paused && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none" />}
                    <span className={cn('relative inline-flex size-2 rounded-full', paused ? 'bg-amber-500' : 'bg-emerald-500')} />
                  </span>
                  {paused ? (openId ? 'paused while a call is open' : 'paused') : 'live'}
                </span>
              )}
            </h2>
            <p className="text-sm text-muted-foreground">
              Every call to your live URL: what came in and what we sent back. Keeps the newest {log.kept}. Self-checks aren't listed.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setUserPaused((p) => !p)} aria-pressed={userPaused}>
              {userPaused ? <Play /> : <Pause />}
              {userPaused ? 'Resume' : 'Pause'}
            </Button>
            <Button ref={clearButton} size="sm" variant="outline" onClick={() => setClearOpen(true)} disabled={log.total === 0}>
              <Trash2 />
              Clear
            </Button>
          </div>
        </div>

        <Filters filters={filters} options={options} onChange={setFilters} />

        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-2 text-xs text-muted-foreground" aria-live="polite">
          <span>
            {log.loading && log.entries.length === 0
              ? 'Loading…'
              : active
                ? `${formatNumber(log.matching)} matching of ${formatNumber(log.total)} in the log`
                : `${formatNumber(log.total)} in the log`}
          </span>
          {active && (
            <Button size="xs" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
              <FilterX />
              Clear filters
            </Button>
          )}
        </div>

        <div className="p-2 @lg:p-3">
          {log.loading && log.entries.length === 0 ? (
            <div className="grid gap-2 p-2" aria-label="Loading the call log">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : log.error ? (
            <div role="alert" className="flex flex-col items-start gap-2 p-3 text-sm">
              <p>{log.error.message}</p>
              <Button size="sm" variant="outline" onClick={() => void log.reload()}>
                Try again
              </Button>
            </div>
          ) : log.entries.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">
              {active ? (
                <p>No calls match these filters.</p>
              ) : (
                <>
                  <p>
                    No calls yet. When Jivox (or curl) calls <span className="font-mono break-all text-foreground">{url}</span>, it shows here within a few seconds.
                  </p>
                  {api.status !== 'published' && <p className="mt-1">This API is a draft: calls get no data until you publish it (they are still listed here).</p>}
                </>
              )}
            </div>
          ) : (
            <>
              <div aria-hidden="true" className={cn('hidden gap-x-4 px-3 pb-1.5 text-xs text-muted-foreground @3xl:grid', LIST_COLUMNS)}>
                <span>When</span>
                <span>Status</span>
                <span>Who</span>
                <span>Ids</span>
                <span>Result</span>
                <span>Request</span>
                <span>Switches</span>
                <span className="text-right">Time</span>
              </div>
              <ul className={cn('grid gap-1 transition-opacity', log.loading && 'opacity-60')} aria-label="Calls, newest first" aria-busy={log.loading}>
                {log.entries.map((entry) =>
                  entry.kind === 'switch' ? (
                    <SwitchLine key={entry.id} entry={entry} tokens={log.tokens} fresh={log.fresh.has(entry.id)} />
                  ) : (
                    <LogRow key={entry.id} entry={entry} tokens={log.tokens} fresh={log.fresh.has(entry.id)} selected={openId === entry.id} onOpen={() => openEntry(entry.id)} />
                  ),
                )}
              </ul>
              {!showsSwitchLines(filters) && <p className="px-3 pt-2 text-xs text-muted-foreground">Switch changes are hidden while filtering calls.</p>}
              {log.next && (
                <div className="flex justify-center p-2">
                  <Button size="sm" variant="outline" disabled={log.loadingOlder} onClick={() => log.loadOlder().catch(() => toast.error("Couldn't load older calls"))}>
                    {log.loadingOlder && <Loader2 className="animate-spin" />}
                    Load older
                  </Button>
                </div>
              )}
            </>
          )}
          <p className="sr-only" aria-live="polite">
            {log.fresh.size > 0 ? `${log.fresh.size} new ${log.fresh.size === 1 ? 'line' : 'lines'} in the call log` : ''}
          </p>
          {shownCalls === 0 && log.entries.length > 0 && <span className="sr-only">Only switch changes so far.</span>}
        </div>
      </section>

      <LogDetailSheet
        brandSlug={organization.slug}
        apiSlug={api.slug}
        logId={openId}
        onClose={() => openEntry(null)}
        onFilterToken={(token) => {
          setFilters({ token })
          openEntry(null)
        }}
      />

      <AlertDialog open={clearOpen} onOpenChange={(next) => !clearing && setClearOpen(next)}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            ;(clearButton.current?.disabled ? listTop.current : clearButton.current)?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the call log?</AlertDialogTitle>
            <AlertDialogDescription>
              Every call in this API's log goes, for everyone who can see it. Switch changes (who turned what on or off) are kept. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={(event) => (event.preventDefault(), void clear())} disabled={clearing}>
              {clearing && <Loader2 className="animate-spin" />}
              {clearing ? 'Clearing…' : 'Clear the log'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const ALL = 'all' // a Select item can't have the value ""

function Filters({ filters, options, onChange }: { filters: FilterState; options: { value: string; label: string }[]; onChange: (next: Partial<FilterState>) => void }) {
  // The id box waits until typing stops (no request per key).
  const [idText, setIdText] = useState(filters.id)
  // The filter changed from outside (Clear filters, Back): show it. Adjusted during render, no effect.
  const [shownId, setShownId] = useState(filters.id)
  if (filters.id !== shownId) {
    setShownId(filters.id)
    setIdText(filters.id)
  }
  useEffect(() => {
    if (idText.trim() === filters.id) return
    const timer = setTimeout(() => onChange({ id: idText.trim() }), 400)
    return () => clearTimeout(timer)
  }, [idText, filters.id, onChange])

  // `width`: written out in full per filter (Tailwind needs whole class names); a phone gets two per line.
  const select = (label: string, value: string, items: [string, string][], set: (v: string) => void, width: string) => (
    <Select value={value === '' ? ALL : value} onValueChange={(v) => set(v === ALL ? '' : v)}>
      <SelectTrigger size="sm" aria-label={label} className={cn('w-full min-w-0 text-xs', width)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(([v, text]) => (
          <SelectItem key={v} value={v} className="text-xs">
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  // A token filter from a link that isn't in the list (e.g. a token of another API): still shown.
  const tokenItems: [string, string][] = [[ALL, 'Everyone'], ...options.map((o): [string, string] => [o.value, o.label])]
  if (filters.token && !options.some((o) => o.value === filters.token)) tokenItems.push([filters.token, 'A token no longer listed'])

  return (
    <div role="group" aria-label="Filters" className="grid grid-cols-2 items-center gap-2 border-b px-5 py-3 @2xl:flex @2xl:flex-wrap">
      {select('Result', filters.status, [[ALL, 'Any result'], ['ok', 'OK'], ['failed', 'Failed']], (v) => onChange({ status: v as FilterState['status'] }), '@2xl:w-32')}
      {select('Who called', filters.token, tokenItems, (v) => onChange({ token: v }), '@2xl:w-48')}
      {select('Request check', filters.check, [[ALL, 'Any request'], ['passed', 'Matches the request'], ['failed', 'Differs from it']], (v) => onChange({ check: v as FilterState['check'] }), '@2xl:w-44')}
      {select('Test switches', filters.switched, [[ALL, 'Switched or not'], ['yes', 'Changed by a switch'], ['no', 'Not switched']], (v) => onChange({ switched: v as FilterState['switched'] }), '@2xl:w-44')}
      {select('Time', filters.since, [['all', 'Any time'], ['15m', 'Last 15 min'], ['1h', 'Last hour'], ['24h', 'Last 24 h']], (v) => onChange({ since: (v === '' ? 'all' : v) as FilterState['since'] }), '@2xl:w-32')}
      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={idText} onChange={(e) => setIdText(e.target.value)} placeholder="Asked for id" aria-label="Calls that asked for this id" maxLength={100} className="h-8 w-full pl-7 text-xs @2xl:w-44" />
      </div>
    </div>
  )
}
