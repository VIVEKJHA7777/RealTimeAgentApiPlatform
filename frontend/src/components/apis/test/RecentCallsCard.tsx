import { ArrowRight, ChevronRight, History, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { logsApi } from '@/lib/api'
import type { Api, LogEntry, LogToken } from '@/lib/api-types'
import { formatRelativeTime } from '@/lib/format'
import { entryIds, entryResult, whoLabel } from '@/lib/logs'
import { durationLabel, fullTimeLabel, RECENT_CALLS_ID, RECENT_CALLS_POLL_MS, timeLabel } from '@/lib/recent-calls'
import { usePolling } from '@/lib/use-polling'
import { useRequest } from '@/lib/use-request'
import { cn } from '@/lib/utils'
import { SwitchBadges } from '../call-log/LogRow'
import { TONE_PILL, TONE_TEXT } from '../call-log/styles'

const SHOWN = 5

// Recent calls (task 4.8c; since 7.5 it reads the call log): the newest 5 calls to the live URL, by
// Jivox or anyone, failures included. Updates every 5 s while the browser tab is visible. A row opens
// that call in the Logs tab (everything that came in and went out, Copy as curl); Clear lives there.
export function RecentCallsCard({ brandSlug, api }: { brandSlug: string; api: Api }) {
  const list = useRequest(`recent-calls:${brandSlug}/${api.slug}`, () => logsApi.list(brandSlug, api.slug, { kind: 'call', limit: SHOWN }))
  const [refreshing, setRefreshing] = useState(false)
  const fresh = useFreshIds(list.data?.entries)

  usePolling(list.data !== undefined, RECENT_CALLS_POLL_MS, list.refresh)

  async function refreshNow() {
    setRefreshing(true)
    try {
      await list.refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const calls = list.data?.entries ?? []
  const url = `/v1/${brandSlug}/${api.slug}`
  const logsTab = `/brands/${brandSlug}/apis/${api.slug}/logs`

  return (
    <section id={RECENT_CALLS_ID} aria-labelledby="recent-heading" className="@container scroll-mt-20 rounded-2xl border bg-background">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-4">
        <div className="min-w-60 flex-1">
          <h2 id="recent-heading" tabIndex={-1} className="flex items-center gap-2 font-semibold outline-none">
            <History className="size-4 text-muted-foreground" aria-hidden="true" />
            Recent calls
            {list.data && (
              <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground" title={`Updates every ${RECENT_CALLS_POLL_MS / 1000} seconds`}>
                <span className="relative flex size-2" aria-hidden="true">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                live
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">The last {SHOWN} calls to your live URL (Jivox's or anyone's). Self-checks aren't listed.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void refreshNow()} disabled={refreshing || list.loading} aria-label="Refresh recent calls">
            <RefreshCw className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} />
            Refresh
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to={logsTab}>
              All calls
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>

      <div className="p-2 @lg:p-3">
        {list.loading && !list.data ? (
          <div className="grid gap-2 p-2" aria-label="Loading recent calls">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : list.error && !list.data ? (
          <div role="alert" className="flex flex-col items-start gap-2 p-3 text-sm">
            <p>{list.error.message}</p>
            <Button size="sm" variant="outline" onClick={list.reload}>
              Try again
            </Button>
          </div>
        ) : calls.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            <p>
              No calls yet. When Jivox (or curl) calls <span className="font-mono break-all text-foreground">{url}</span>, it shows here within a few seconds.
            </p>
            {api.status !== 'published' && <p className="mt-1">This API is a draft: calls get no data until you publish it (they are still listed here).</p>}
          </div>
        ) : (
          <>
            <div
              aria-hidden="true"
              className="hidden gap-x-4 px-3 pb-1.5 text-xs text-muted-foreground @2xl:grid @2xl:grid-cols-[4.5rem_3rem_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_3rem_1rem]"
            >
              <span>When</span>
              <span>Status</span>
              <span>Who</span>
              <span>Ids</span>
              <span>Result</span>
              <span className="text-right">Time</span>
              <span />
            </div>
            <ul className="grid gap-1" aria-label="Recent calls, newest first">
              {calls.map((call) => (
                <CallRow key={call.id} call={call} tokens={list.data?.tokens ?? {}} fresh={fresh.has(call.id)} to={`${logsTab}?open=${call.id}`} />
              ))}
            </ul>
            {(list.data?.total ?? 0) > SHOWN && (
              <p className="px-3 pt-2 text-xs text-muted-foreground">
                {list.data!.total} in the log.{' '}
                <Link to={logsTab} className="font-medium text-primary hover:underline">
                  See all, with filters
                </Link>
              </p>
            )}
          </>
        )}
        <p className="sr-only" aria-live="polite">
          {fresh.size > 0 ? `${fresh.size} new call${fresh.size === 1 ? '' : 's'}` : ''}
        </p>
      </div>
    </section>
  )
}

function CallRow({ call, tokens, fresh, to }: { call: LogEntry; tokens: Record<string, LogToken>; fresh: boolean; to: string }) {
  const result = entryResult(call)
  const who = whoLabel(call, tokens)
  const ids = entryIds(call)
  return (
    <li className={cn('rounded-lg transition-colors duration-700', fresh ? 'bg-primary/10' : 'hover:bg-muted/40')} data-call={call.id}>
      <Link
        to={to}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-lg px-3 py-2 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 @2xl:grid-cols-[4.5rem_3rem_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_3rem_1rem] @2xl:gap-x-4"
      >
        <span className="text-xs text-muted-foreground tabular-nums @2xl:text-sm @2xl:text-foreground" title={fullTimeLabel(call.at)}>
          <span className="sr-only">At </span>
          {timeLabel(call.at)}
          <span className="@2xl:hidden"> · {formatRelativeTime(call.at)}</span>
        </span>
        <span className="flex items-center justify-end gap-2 @2xl:justify-start">
          <span className={cn('rounded-full px-2 py-0.5 font-mono text-xs font-medium', TONE_PILL[result.tone])}>
            <span className="sr-only">Status </span>
            {call.status ?? '—'}
          </span>
          <ChevronRight className="size-4 text-muted-foreground @2xl:hidden" aria-hidden="true" />
        </span>
        <span className="col-span-2 flex min-w-0 items-baseline gap-3 @2xl:contents">
          <span className={cn('max-w-[60%] shrink-0 truncate @2xl:max-w-none @2xl:min-w-0', who.problem && 'text-destructive')} title={who.text}>
            <span className="sr-only">Who </span>
            {who.text}
          </span>
          <span className="min-w-0 truncate font-mono text-xs" title={call.ids.join(', ')}>
            {ids && <span className="sr-only">Ids </span>}
            {ids}
          </span>
        </span>
        <span className={cn('col-span-2 flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs font-medium @2xl:col-span-1 @2xl:text-sm', TONE_TEXT[result.tone])}>
          <span className="truncate" title={result.text}>
            <span className="sr-only">Result </span>
            {result.text}
          </span>
          <SwitchBadges entry={call} />
          <span className="font-normal text-muted-foreground @2xl:hidden">{call.durationMs !== null && `· ${durationLabel(call.durationMs)}`}</span>
        </span>
        <span className="hidden text-right text-xs text-muted-foreground tabular-nums @2xl:block">{call.durationMs !== null ? durationLabel(call.durationMs) : ''}</span>
        <ChevronRight className="hidden size-4 text-muted-foreground @2xl:block" aria-hidden="true" />
        <span className="sr-only">, open in the Logs tab</span>
      </Link>
    </li>
  )
}

// Ids that appeared since the last answer (highlighted for a few seconds and announced). The first
// load highlights nothing.
function useFreshIds(calls: LogEntry[] | undefined) {
  const known = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!calls) return
    const ids = calls.map((c) => c.id)
    const added = known.current ? ids.filter((id) => !known.current!.has(id)) : []
    known.current = new Set(ids)
    if (added.length > 0) setFresh(new Set(added))
  }, [calls])
  // Its own timer: the next poll (5 s) must not cancel the fade-out.
  useEffect(() => {
    if (fresh.size === 0) return
    const timer = setTimeout(() => setFresh(new Set()), 4000)
    return () => clearTimeout(timer)
  }, [fresh])
  return fresh
}
