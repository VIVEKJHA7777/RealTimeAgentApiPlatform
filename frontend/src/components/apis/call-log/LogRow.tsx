import { ChevronRight, ToggleRight } from 'lucide-react'
import type { LogEntry, LogToken } from '@/lib/api-types'
import { formatRelativeTime } from '@/lib/format'
import { entryIds, entryResult, SWITCH_LABEL, switchEventText, whoLabel } from '@/lib/logs'
import { durationLabel, fullTimeLabel, timeLabel } from '@/lib/recent-calls'
import { cn } from '@/lib/utils'
import { LIST_COLUMNS, TONE_PILL, TONE_TEXT } from './styles'

// `cell`: in the list's grid an empty cell must still be there (or the next column moves left).
export function SwitchBadges({ entry, className, cell = false }: { entry: LogEntry; className?: string; cell?: boolean }) {
  if (entry.switches.length === 0) return cell ? <span className={cn('hidden @3xl:block', className)} /> : null
  return (
    <span className={cn('flex min-w-0 flex-wrap gap-1', className)}>
      {entry.switches.map((kind) => (
        <span key={kind} className="truncate rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300" title={`Changed by the test switch "${SWITCH_LABEL[kind]}"`}>
          {SWITCH_LABEL[kind]}
        </span>
      ))}
    </span>
  )
}

export function CheckMark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-muted-foreground" title="Not checked: the call failed before the API was known">–<span className="sr-only">request not checked</span></span>
  return ok ? (
    <span className="text-emerald-700 dark:text-emerald-400" title="Matches the API's request">✓<span className="sr-only">request matches</span></span>
  ) : (
    <span className="font-medium text-destructive" title="Differs from the API's request">✗<span className="sr-only">request differs</span></span>
  )
}

export function LogRow({ entry, tokens, fresh, selected, onOpen }: { entry: LogEntry; tokens: Record<string, LogToken>; fresh: boolean; selected: boolean; onOpen: () => void }) {
  const result = entryResult(entry)
  const who = whoLabel(entry, tokens)
  const ids = entryIds(entry)
  return (
    <li className={cn('rounded-lg transition-colors duration-700', fresh ? 'bg-primary/10' : selected ? 'bg-muted' : 'hover:bg-muted/40')} data-log={entry.id}>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className={cn(
          'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-lg px-3 py-2 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 @3xl:gap-x-4',
          LIST_COLUMNS,
        )}
      >
        <span className="text-xs text-muted-foreground tabular-nums @3xl:text-sm @3xl:text-foreground" title={fullTimeLabel(entry.at)}>
          <span className="sr-only">At </span>
          {timeLabel(entry.at)}
          <span className="@3xl:hidden"> · {formatRelativeTime(entry.at)}</span>
        </span>
        <span className="flex items-center justify-end gap-2 @3xl:justify-start">
          <span className={cn('rounded-full px-2 py-0.5 font-mono text-xs font-medium', TONE_PILL[result.tone])}>
            <span className="sr-only">Status </span>
            {entry.status ?? '—'}
          </span>
          <ChevronRight className="size-4 text-muted-foreground @3xl:hidden" aria-hidden="true" />
        </span>
        {/* Phone: who · ids on one line; desktop: two columns */}
        <span className="col-span-2 flex min-w-0 items-baseline gap-3 @3xl:contents">
          <span className={cn('max-w-[55%] shrink-0 truncate @3xl:max-w-none @3xl:min-w-0', who.problem && 'text-destructive')} title={who.detail ? `${who.text} (${who.detail})` : who.text}>
            <span className="sr-only">Who </span>
            {who.text}
          </span>
          <span className="min-w-0 truncate font-mono text-xs" title={entry.ids.join(', ')}>
            {ids && <span className="sr-only">Ids </span>}
            {ids}
          </span>
        </span>
        <span className={cn('col-span-2 flex min-w-0 items-baseline gap-2 text-xs font-medium @3xl:col-span-1 @3xl:text-sm', TONE_TEXT[result.tone])}>
          <span className="truncate" title={result.text}>
            <span className="sr-only">Result </span>
            {result.text}
          </span>
          <span className="shrink-0 font-normal text-muted-foreground @3xl:hidden">
            · request <CheckMark ok={entry.checkOk} />
            {entry.durationMs !== null && ` · ${durationLabel(entry.durationMs)}`}
          </span>
        </span>
        <span className="hidden @3xl:block">
          <CheckMark ok={entry.checkOk} />
        </span>
        <SwitchBadges entry={entry} cell className="col-span-2 @3xl:col-span-1" />
        <span className="hidden text-right text-xs text-muted-foreground tabular-nums @3xl:block">{entry.durationMs !== null ? durationLabel(entry.durationMs) : ''}</span>
      </button>
    </li>
  )
}

// A test switch turned on / changed / off / ended (task 7.4's audit), between the calls.
export function SwitchLine({ entry, tokens, fresh }: { entry: LogEntry; tokens: Record<string, LogToken>; fresh: boolean }) {
  if (!entry.event) return null
  return (
    <li className={cn('flex items-start gap-2 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors duration-700', fresh && 'bg-primary/10')} data-log={entry.id}>
      <ToggleRight className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <span>
        <span className="tabular-nums" title={fullTimeLabel(entry.at)}>
          {timeLabel(entry.at)}
        </span>{' '}
        · <span className="sr-only">Test switch: </span>
        <span className="text-foreground">{switchEventText(entry.event, tokens, (iso) => timeLabel(iso))}</span>
      </span>
    </li>
  )
}
