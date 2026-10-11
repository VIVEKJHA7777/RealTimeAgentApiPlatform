import { ChevronRight, History, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, testingApi } from '@/lib/api'
import type { Api, RecentCall } from '@/lib/api-types'
import { formatRelativeTime } from '@/lib/format'
import {
  bodyView,
  callResult,
  durationLabel,
  fullTimeLabel,
  headerLabel,
  idsLabel,
  RECENT_CALLS_ID,
  RECENT_CALLS_POLL_MS,
  timeLabel,
  tokenLabel,
  type Tone,
} from '@/lib/recent-calls'
import { usePolling } from '@/lib/use-polling'
import { useRequest } from '@/lib/use-request'
import { cn } from '@/lib/utils'
import { JsonBlock } from './result-bits'

const TONE: Record<Tone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  partial: 'text-amber-700 dark:text-amber-400',
  fail: 'text-destructive',
}

// Recent calls (task 4.8c, mockup approved after 4.8): the last 5 calls to the live URL, by Jivox
// or anyone, failures included (no token, expired…). Self-checks aren't listed. Updates every 5 s
// while the browser tab is visible; a row opens to show what was sent.
export function RecentCallsCard({ brandSlug, api }: { brandSlug: string; api: Api }) {
  const list = useRequest(`recent-calls:${brandSlug}/${api.slug}`, () => testingApi.recentCalls(brandSlug, api.slug))
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const fresh = useFreshIds(list.data?.calls)
  const refreshButton = useRef<HTMLButtonElement>(null)

  usePolling(list.data !== undefined, RECENT_CALLS_POLL_MS, list.refresh)

  async function refreshNow() {
    setRefreshing(true)
    try {
      await list.refresh()
    } finally {
      setRefreshing(false)
    }
  }

  async function clear() {
    setClearing(true)
    try {
      await testingApi.clearRecentCalls(brandSlug, api.slug)
      setOpen(new Set())
      await list.refresh()
      // Clear is now disabled (nothing to clear): keep keyboard focus in the card.
      refreshButton.current?.focus()
      toast.success('Recent calls cleared')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't clear the calls")
    } finally {
      setClearing(false)
    }
  }

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const calls = list.data?.calls ?? []
  const url = `/v1/${brandSlug}/${api.slug}`

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
          <p className="text-sm text-muted-foreground">
            The last {list.data?.kept ?? 5} calls to your live URL (Jivox's or anyone's). Self-checks aren't listed.
          </p>
        </div>
        <div className="flex gap-2">
          <Button ref={refreshButton} size="sm" variant="outline" onClick={() => void refreshNow()} disabled={refreshing || list.loading} aria-label="Refresh recent calls">
            <RefreshCw className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} />
            Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={() => void clear()} disabled={clearing || calls.length === 0} aria-label="Clear recent calls">
            {clearing ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Clear
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
              {list.data?.clearedAt ? `No calls since you cleared the list at ${timeLabel(list.data.clearedAt)}.` : 'No calls yet.'} When Jivox (or curl) calls{' '}
              <span className="font-mono break-all text-foreground">{url}</span>, it shows here within a few seconds.
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
              <span>Token</span>
              <span>Ids</span>
              <span>Result</span>
              <span className="text-right">Time</span>
              <span />
            </div>
            <ul className="grid gap-1" aria-label="Recent calls, newest first">
              {calls.map((call) => (
                <CallRow key={call.id} call={call} open={open.has(call.id)} fresh={fresh.has(call.id)} onToggle={() => toggle(call.id)} />
              ))}
            </ul>
          </>
        )}
        <p className="sr-only" aria-live="polite">
          {fresh.size > 0 ? `${fresh.size} new call${fresh.size === 1 ? '' : 's'}` : ''}
        </p>
      </div>
    </section>
  )
}

function CallRow({ call, open, fresh, onToggle }: { call: RecentCall; open: boolean; fresh: boolean; onToggle: () => void }) {
  const panelId = useId()
  const result = callResult(call)
  const token = tokenLabel(call)
  const ids = idsLabel(call)
  const status = call.status === null ? '—' : String(call.status)
  return (
    <li className={cn('rounded-lg transition-colors duration-700', fresh ? 'bg-primary/10' : open ? 'bg-muted/50' : 'hover:bg-muted/40')} data-call={call.id}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-lg @2xl:gap-x-4 px-3 py-2 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 @2xl:grid-cols-[4.5rem_3rem_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_3rem_1rem]"
      >
        {/* Phone: status + result on the first line, token · ids under; desktop: one row of columns */}
        <span className="text-xs text-muted-foreground tabular-nums @2xl:text-sm @2xl:text-foreground" title={fullTimeLabel(call.at)}>
          <span className="sr-only">At </span>
          {timeLabel(call.at)}
          <span className="@2xl:hidden"> · {formatRelativeTime(call.at)}</span>
        </span>
        <span className="row-span-1 flex items-center justify-end gap-2 @2xl:justify-start">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 font-mono text-xs font-medium',
              result.tone === 'ok' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : result.tone === 'partial' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-destructive/10 text-destructive',
            )}
          >
            <span className="sr-only">Status </span>
            {status}
          </span>
          <ChevronRight className={cn('size-4 text-muted-foreground transition-transform @2xl:hidden', open && 'rotate-90')} aria-hidden="true" />
        </span>
        {/* Phone: token and ids side by side on one line; desktop: two columns (display: contents) */}
        <span className="col-span-2 flex min-w-0 items-baseline gap-3 @2xl:contents">
          <span className={cn('max-w-[60%] shrink-0 truncate @2xl:max-w-none @2xl:min-w-0', token.problem && 'text-destructive')} title={token.text}>
            <span className="sr-only">Token </span>
            {token.text}
          </span>
          <span className="min-w-0 truncate font-mono text-xs" title={call.ids.join(', ')}>
            {ids && <span className="sr-only">Ids </span>}
            {ids}
          </span>
        </span>
        <span className={cn('col-span-2 min-w-0 truncate text-xs font-medium @2xl:col-span-1 @2xl:text-sm', TONE[result.tone])} title={result.text}>
          <span className="sr-only">Result </span>
          {result.text}
          <span className="font-normal text-muted-foreground @2xl:hidden"> · {durationLabel(call.durationMs)}</span>
        </span>
        <span className="hidden text-right text-xs text-muted-foreground tabular-nums @2xl:block">{durationLabel(call.durationMs)}</span>
        <ChevronRight className={cn('hidden size-4 text-muted-foreground transition-transform @2xl:block', open && 'rotate-90')} aria-hidden="true" />
      </button>
      {open && <CallDetails id={panelId} call={call} />}
    </li>
  )
}

function CallDetails({ id, call }: { id: string; call: RecentCall }) {
  const body = bodyView(call)
  const token = tokenLabel(call)
  const result = callResult(call)
  return (
    <div id={id} className="grid gap-3 px-3 pt-1 pb-3 text-sm">
      <p className="font-mono text-xs break-all">
        <span className="font-semibold">{call.method}</span> {call.path}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Answer</dt>
        <dd className={TONE[result.tone]}>
          {call.status === null ? 'none (the caller hung up)' : `HTTP ${call.status}`}
          {call.errorCode ? ` · ${call.errorCode}` : call.status !== null ? ` · ${result.text}` : ''} · {durationLabel(call.durationMs)}
        </dd>
        {call.errorMessage && (
          <>
            <dt className="text-muted-foreground">Message</dt>
            <dd className="break-words">{call.errorMessage}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Token</dt>
        <dd>
          {token.text} <span className="text-muted-foreground">· {headerLabel(call)}</span>
        </dd>
        {call.idCount !== null && call.idCount > 0 && (
          <>
            <dt className="text-muted-foreground">Ids ({call.idCount})</dt>
            <dd className="font-mono break-all">
              {call.ids.join(', ')}
              {call.idCount > call.ids.length && <span className="font-sans text-muted-foreground"> and {call.idCount - call.ids.length} more</span>}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">From</dt>
        <dd className="break-all">
          {call.ip ?? 'unknown'}
          {call.userAgent && <span className="text-muted-foreground"> · {call.userAgent}</span>}
        </dd>
        <dt className="text-muted-foreground">When</dt>
        <dd>
          {fullTimeLabel(call.at)} <span className="text-muted-foreground">({formatRelativeTime(call.at)})</span>
        </dd>
      </dl>
      {body &&
        (body.text ? (
          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">Body sent{body.note ? ` · ${body.note}` : ''}</p>
            <JsonBlock value={body.text} label="Body sent" className="max-h-64" />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{body.note}</p>
        ))}
    </div>
  )
}

// Ids that appeared since the last answer (highlighted for a few seconds and announced). The first
// load highlights nothing.
function useFreshIds(calls: RecentCall[] | undefined) {
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
