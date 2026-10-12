import { Check, Copy, Filter } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { logsApi } from '@/lib/api'
import type { LogDetail } from '@/lib/api-types'
import { formatBytes, formatRelativeTime } from '@/lib/format'
import { checkLine, entryResult, prettyBody, SWITCH_LABEL, whoLabel } from '@/lib/logs'
import { durationLabel, fullTimeLabel } from '@/lib/recent-calls'
import { useRequest } from '@/lib/use-request'
import { cn } from '@/lib/utils'
import { JsonBlock } from '../test/result-bits'
import { CheckMark } from './LogRow'
import { TONE_TEXT } from './styles'

// One call of the log in full (task 7.5): the request check, what came in, what we sent back
// (Cache-Control: no-store marked), the caller, and Copy as curl. Opened by ?open=<id>: Back closes
// it, a link opens it (Recent calls on the Test tab links here). Focus returns to the row.
export function LogDetailSheet({
  brandSlug,
  apiSlug,
  logId,
  onClose,
  onFilterToken,
}: {
  brandSlug: string
  apiSlug: string
  logId: string | null
  onClose: () => void
  onFilterToken: (tokenId: string) => void
}) {
  const detail = useRequest(`log:${brandSlug}/${apiSlug}/${logId ?? ''}`, () => (logId ? logsApi.get(brandSlug, apiSlug, logId) : Promise.resolve(null)))
  const opener = useRef<HTMLElement | null>(null)
  return (
    <Sheet open={logId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        onOpenAutoFocus={() => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        }}
        onCloseAutoFocus={(event) => {
          // Back to the row it was opened from (it may have moved down as new calls came in).
          const row = logId ? document.querySelector<HTMLElement>(`[data-log="${CSS.escape(logId)}"] button`) : null
          const target = row ?? (opener.current?.isConnected ? opener.current : null)
          if (target) {
            event.preventDefault()
            target.focus()
          }
        }}
      >
        {detail.loading || (!detail.data && !detail.error) ? (
          <div className="grid gap-3 p-4" aria-label="Loading the call">
            <SheetTitle className="sr-only">Loading the call</SheetTitle>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : detail.error || !detail.data ? (
          <div className="grid gap-3 p-4" role="alert">
            <SheetTitle>This call isn't in the log any more</SheetTitle>
            <SheetDescription>{detail.error?.code === 'LOG_NOT_FOUND' ? 'The log keeps the newest 500 calls, or it was cleared.' : (detail.error?.message ?? 'Something went wrong.')}</SheetDescription>
            <Button variant="outline" size="sm" className="w-fit" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <Detail data={detail.data} onFilterToken={onFilterToken} />
        )}
      </SheetContent>
    </Sheet>
  )
}

function Detail({ data, onFilterToken }: { data: LogDetail; onFilterToken: (tokenId: string) => void }) {
  const { entry } = data
  const result = entryResult(entry)
  const who = whoLabel(entry, data.tokens)
  const check = entry.requestCheck
  const sentHeaders = entry.responseHeaders ?? {}
  const noStore = (sentHeaders['cache-control'] ?? '').includes('no-store')
  const message = errorMessage(entry.responseBody)
  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="flex flex-wrap items-center gap-x-2 text-base">
          <span className="font-mono">{entry.method}</span>
          <span className={TONE_TEXT[result.tone]}>{entry.status ?? 'no answer'}</span>
          <span className="font-normal text-muted-foreground">·</span>
          <span className="truncate">{who.text}</span>
        </SheetTitle>
        <SheetDescription>
          {fullTimeLabel(entry.at)} ({formatRelativeTime(entry.at)}){entry.durationMs !== null && ` · answered in ${durationLabel(entry.durationMs)}`}
        </SheetDescription>
        <p className="font-mono text-xs break-all text-muted-foreground">{entry.path}</p>
      </SheetHeader>

      <div className="grid gap-5 p-4 text-sm">
        {entry.switches.length > 0 && (
          <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            Changed on purpose by test switch{entry.switches.length > 1 ? 'es' : ''}: <span className="font-medium">{entry.switches.map((k) => SWITCH_LABEL[k]).join(', ')}</span>. Jivox saw this answer, not the normal one.
          </p>
        )}

        <Section title="Result">
          <p className={cn('font-medium', TONE_TEXT[result.tone])}>{result.text}</p>
          {entry.switches.length > 0 && sentItems(entry.responseBody) !== null && (
            <p className="text-xs text-amber-800 dark:text-amber-300">Sent {sentItems(entry.responseBody)} item{sentItems(entry.responseBody) === 1 ? '' : 's'} after the switch (found counts our data before it).</p>
          )}
          {message && <p className="text-xs break-words text-muted-foreground">{message}</p>}
        </Section>

        <Section title="Request check" aside={<CheckMark ok={check?.ok ?? null} />}>
          {check ? (
            <ul className="grid gap-1 text-xs">
              {check.items.map((item, i) => (
                <li key={i} className="flex gap-2">
                  <CheckMark ok={item.ok} />
                  <span className="min-w-0 break-words">{checkLine(item)}</span>
                </li>
              ))}
              {check.extra.length > 0 && <li className="text-muted-foreground">Not in the request design (ignored): {check.extra.join(', ')}</li>}
              {check.cutShort && <li className="text-muted-foreground">Shortened to fit the log.</li>}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Not checked: the call failed before the API's request design was read (token, address or body).</p>
          )}
          {entry.meta && (
            <p className="mt-1 text-xs text-muted-foreground">
              Chat context: {Object.entries(entry.meta).map(([k, v]) => `${k} = "${v}"`).join(' · ')}
            </p>
          )}
        </Section>

        <Section title="What came in">
          <Pairs
            rows={[
              ['Token', `${who.text}${who.detail ? ` (${who.detail})` : ''} · ${entry.header === 'bearer' ? 'Authorization: Bearer' : entry.header === 'x_api_key' ? 'X-Api-Key' : 'no token header'}`],
              ...(entry.idCount !== null ? [[`Ids (${entry.idCount})`, entry.ids.join(', ') + (entry.idCount > entry.ids.length ? ` and ${entry.idCount - entry.ids.length} more` : '')] as [string, string]] : []),
              ['From', `${entry.ip ?? 'unknown'}${entry.userAgent ? ` · ${entry.userAgent}` : ''}`],
            ]}
          />
          {entry.query && Object.keys(entry.query).length > 0 && <HeaderTable title="Query" rows={entry.query} />}
          {entry.requestHeaders && <HeaderTable title="Headers (the token and cookies are never kept)" rows={entry.requestHeaders} />}
          {entry.body !== null ? (
            <div className="grid gap-1">
              <p className="text-xs text-muted-foreground">Body{entry.bodyCut ? ` · first 4 KB of ${formatBytes(entry.bodyBytes)}` : ''}</p>
              <JsonBlock value={prettyBody(entry.body, entry.bodyCut) ?? ''} label="Body sent" className="max-h-64" />
            </div>
          ) : entry.bodyBytes > 0 ? (
            <p className="text-xs text-muted-foreground">Body of {formatBytes(entry.bodyBytes)} not kept.</p>
          ) : null}
        </Section>

        <Section title="What we sent back">
          {entry.responseHeaders ? (
            <>
              <p className={cn('text-xs font-medium', noStore ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')}>
                {noStore ? '✓ Cache-Control: no-store was sent' : '✗ No Cache-Control: no-store in this answer'}
              </p>
              <HeaderTable title="Headers as sent" rows={entry.responseHeaders} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Nothing: the caller hung up before the answer.</p>
          )}
          {entry.responseBody !== null && (
            <div className="grid gap-1">
              <p className="text-xs text-muted-foreground">Body{entry.responseCut ? ' · first 4 KB' : ''}</p>
              <JsonBlock value={prettyBody(entry.responseBody, entry.responseCut) ?? ''} label="Body we sent" className="max-h-72" />
            </div>
          )}
        </Section>

        {data.curl && (
          <Section title="Repeat it" aside={<CopyCurl curl={data.curl} />}>
            <JsonBlock value={data.curl} label="curl command" className="max-h-48" />
            <p className="text-xs text-muted-foreground">Replace &lt;your token&gt; with the token, then run it in a terminal.</p>
            {data.curlNotes.map((note) => (
              <p key={note} className="text-xs text-amber-800 dark:text-amber-300">
                {note}
              </p>
            ))}
          </Section>
        )}

        {entry.tokenId && (
          <Button variant="outline" size="sm" className="w-fit" onClick={() => onFilterToken(entry.tokenId!)}>
            <Filter />
            Only calls from {who.text}
          </Button>
        )}
      </div>
    </>
  )
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      {/* The aside (a mark, a button) sits next to the heading, not in it: the heading's name stays its title. */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Pairs({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function HeaderTable({ title, rows }: { title: string; rows: Record<string, string | string[]> }) {
  return (
    <details className="group rounded-lg border">
      <summary className="cursor-pointer rounded-lg px-3 py-1.5 text-xs text-muted-foreground outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {title} ({Object.keys(rows).length})
      </summary>
      <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1 border-t px-3 py-2 font-mono text-[11px]">
        {Object.entries(rows).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="truncate text-muted-foreground" title={k}>
              {k}
            </dt>
            <dd className="break-all">{Array.isArray(v) ? v.join(', ') : v}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

function CopyCurl({ curl }: { curl: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={() =>
        navigator.clipboard.writeText(curl).then(
          () => setCopied(true),
          () => toast.error("Couldn't copy. Select the text and copy it manually."),
        )
      }
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : 'Copy as curl'}
    </Button>
  )
}

// How many items the answer we sent really had (a switch may have added / removed some).
function sentItems(body: string | null): number | null {
  try {
    const data = (JSON.parse(body ?? '') as { data?: unknown }).data
    return Array.isArray(data) ? data.length : null
  } catch {
    return null // not JSON, or cut at 4 KB
  }
}

// The failure envelope's message, if the answer was one.
function errorMessage(body: string | null): string | null {
  if (!body) return null
  try {
    const parsed = JSON.parse(body) as { errors?: { error_message?: string; error_id?: string }[] }
    const first = parsed.errors?.find((e) => !e.error_id)
    return first?.error_message ?? null
  } catch {
    return null
  }
}

