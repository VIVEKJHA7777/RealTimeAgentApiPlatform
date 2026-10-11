import { ChevronDown, ChevronLeft, ChevronRight, KeyRound, Loader2, Search, SearchX, X } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { ErrorState } from '@/components/PageStates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { dataSourcesApi } from '@/lib/api'
import type { DataSource, RecordsPage } from '@/lib/api-types'
import { formatNumber } from '@/lib/format'
import { useRequest } from '@/lib/use-request'
import { cn } from '@/lib/utils'
import { RowDetailsSheet } from './RowDetailsSheet'

const PAGE_SIZES = [25, 50, 100]
const DEFAULT_SIZE = 50
const SEARCH_DELAY_MS = 300 // wait until typing pauses, then search (not one request per key)

type Row = RecordsPage['records'][number]

// The rows of the live version: pages in file order, or a search by id prefix.
// Where you are lives in the address bar (?page=3&size=50&q=SKU-12): reload, Back and links
// keep it. Pages use keyset paging on the backend, so page 10 000 is as fast as page 1.
export function RecordsView({ brandSlug, dataSource }: { brandSlug: string; dataSource: DataSource }) {
  const [params, setParams] = useSearchParams()
  const size = PAGE_SIZES.includes(Number(params.get('size'))) ? Number(params.get('size')) : DEFAULT_SIZE
  const query = (params.get('q') ?? '').trim()
  const totalPages = Math.max(1, Math.ceil(dataSource.rowCount / size))
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(params.get('page')) || 1)))

  // Search pages go forward with "after this id"; we remember the ids to go back. They belong to
  // one search + page size: when either changes (typing, Back button…), start again at page 1.
  const searchKey = `${query}|${size}`
  const [search, setSearch] = useState({ key: searchKey, cursors: [] as string[] })
  if (search.key !== searchKey) setSearch({ key: searchKey, cursors: [] }) // adjusting state while rendering (React docs)
  const cursors = search.key === searchKey ? search.cursors : []
  const searchIndex = cursors.length
  const afterId = cursors.at(-1)
  const setCursors = (next: (current: string[]) => string[]) =>
    setSearch((current) => ({ key: searchKey, cursors: next(current.key === searchKey ? current.cursors : []) }))

  // The search box. If the search in the address changes from outside (Back button, a link),
  // the box follows it.
  const [input, setInput] = useState(query)
  const [inputFor, setInputFor] = useState(query)
  if (inputFor !== query) {
    setInputFor(query)
    if (input.trim() !== query) setInput(query)
  }
  const [details, setDetails] = useState<Row | null>(null)

  // A new version of the data (lastImportAt changes) reloads the current page.
  const version = dataSource.lastImportAt ?? ''
  const records = useRequest(
    `records:${dataSource.id}:${version}:${size}:${query ? `q=${query}:${afterId ?? ''}` : `p=${page}`}`,
    () =>
      dataSourcesApi.records(
        brandSlug,
        dataSource.id,
        query ? { limit: size, search: query, afterId } : { limit: size, afterPosition: (page - 1) * size },
      ),
    { keepPreviousData: true },
  )

  const update = useCallback(
    (changes: Record<string, string | null>, replace = false) =>
      setParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key)
          else next.set(key, value)
        }
        return next
      },
      { replace },
    ),
    [setParams],
  )

  // Typing in the search box: search once typing pauses. STARTING a search adds one history
  // entry (Back returns to the page you were on); refining or clearing it replaces that entry
  // (no Back step per letter).
  useEffect(() => {
    const trimmed = input.trim()
    if (trimmed === query) return
    const timer = setTimeout(() => update({ q: trimmed || null, page: null }, query !== ''), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [input, query, update])

  const data = records.data
  const pending = records.loading // true while a NEW page loads (the old one stays visible)
  const searching = query !== ''
  const first = data?.records[0]?.position
  const last = data?.records.at(-1)?.position

  function goToPage(target: number) {
    update({ page: target === 1 ? null : String(Math.min(totalPages, Math.max(1, target))) })
  }

  return (
    <section aria-labelledby="rows-heading" className="flex min-w-0 flex-col gap-3">
      <h2 id="rows-heading" className="sr-only">
        Rows
      </h2>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form role="search" onSubmit={(event: FormEvent) => event.preventDefault()} className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={`Search by ${dataSource.idColumn} (starts with)…`}
            aria-label={`Search rows by ${dataSource.idColumn}`}
            className="pr-9 pl-9"
            maxLength={200}
            spellCheck={false}
          />
          {input && (
            <button
              type="button"
              onClick={() => setInput('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 rounded-md p-1 text-muted-foreground -translate-y-1/2 hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </form>
        <p className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {/* While a new page loads the old rows stay visible, but this label would already
              describe the new request: say "Loading…" instead of a range that doesn't match. */}
          {pending && data
            ? 'Loading…'
            : data && data.records.length > 0
            ? searching
              ? `Matches ${formatNumber(searchIndex * size + 1)}–${formatNumber(searchIndex * size + data.records.length)} · sorted by ${dataSource.idColumn}`
              : `Rows ${formatNumber(first!)}–${formatNumber(last!)} of ${formatNumber(dataSource.rowCount)}`
            : null}
        </p>
      </div>

      {records.error && !data ? (
        <ErrorState message={records.error.message} onRetry={records.reload} />
      ) : !data ? (
        <TableSkeleton />
      ) : data.records.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed bg-background px-6 py-12 text-center">
          <SearchX className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">
            {searching ? `No ${dataSource.idColumn} starts with "${query}"` : 'No rows on this page'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {searching ? 'The search matches the start of the id, upper and lower case exactly.' : 'Go back to the first page.'}
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => (searching ? setInput('') : goToPage(1))}>
            {searching ? 'Clear search' : 'First page'}
          </Button>
        </div>
      ) : (
        <RecordsTable page={data} pending={pending} onOpen={setDetails} />
      )}

      {data && data.records.length > 0 && (
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Rows per page
            <span className="relative">
              <select
                value={size}
                onChange={(event) => {
                  update({ size: event.target.value === String(DEFAULT_SIZE) ? null : event.target.value, page: null })
                }}
                className="h-8 cursor-pointer appearance-none rounded-lg border bg-background py-1 pr-8 pl-3 text-sm text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring/20 dark:[color-scheme:dark]"
              >
                {PAGE_SIZES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2" aria-hidden="true" />
            </span>
          </label>

          {searching ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={searchIndex === 0 || pending} onClick={() => setCursors((c) => c.slice(0, -1))}>
                <ChevronLeft />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!data.next || pending}
                onClick={() => {
                  const next = data.next
                  if (next && 'afterId' in next) setCursors((c) => [...c, next.afterId])
                }}
              >
                Next
                <ChevronRight />
              </Button>
            </div>
          ) : (
            <Pager page={page} totalPages={totalPages} disabled={pending} onGo={goToPage} />
          )}
        </div>
      )}

      <RowDetailsSheet
        row={details}
        columns={data?.columns ?? dataSource.columns}
        idColumn={data?.idColumn ?? dataSource.idColumn}
        onClose={() => setDetails(null)}
      />
    </section>
  )
}

// Row number + id stay visible while the other columns scroll sideways (sticky).
// Clicking a row (or Enter on its id button) opens all its columns in the side panel.
function RecordsTable({ page, pending, onOpen }: { page: RecordsPage; pending: boolean; onOpen: (row: Row) => void }) {
  const idIndex = page.columns.indexOf(page.idColumn)
  const others = page.columns.map((column, index) => ({ column, index })).filter(({ index }) => index !== idIndex)
  return (
    <div className={cn('overflow-hidden rounded-2xl border bg-background transition-opacity', pending && 'opacity-60')}>
      <div className="max-h-[60svh] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Rows of the data. Select a row's id to see all its values.</caption>
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted">
              <th scope="col" className="sticky left-0 z-10 w-16 min-w-16 border-b bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                #
              </th>
              <th scope="col" className="sticky left-16 z-10 border-r border-b bg-muted px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-primary">
                <span className="flex items-center gap-1">
                  <KeyRound className="size-3" aria-label="id column" />
                  {page.idColumn}
                </span>
              </th>
              {others.map(({ column }) => (
                <th key={column} scope="col" className="max-w-60 border-b px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">
                  <span className="block truncate" title={column}>
                    {column}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.records.map((row) => (
              <tr key={row.position} onClick={() => onOpen(row)} className="group cursor-pointer">
                <td className="sticky left-0 border-b bg-background px-3 py-2 font-mono text-xs text-muted-foreground tabular-nums group-hover:bg-muted">
                  {formatNumber(row.position)}
                </td>
                <td className="sticky left-16 max-w-56 border-r border-b bg-background px-3 py-2 group-hover:bg-muted">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpen(row)
                    }}
                    className="block max-w-full truncate rounded font-mono text-xs font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    title={`${row.id}: see all values`}
                  >
                    {row.id}
                  </button>
                </td>
                {others.map(({ column, index }) => {
                  const value = row.values[index]
                  return (
                    <td key={column} className="max-w-60 truncate border-b px-3 py-2 whitespace-nowrap group-hover:bg-muted/60" title={value ?? undefined}>
                      {value ?? <span className="text-muted-foreground/60 italic">empty</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ‹ Page [ 3 ] of 10,000 ›: type a page number and press Enter to jump there.
function Pager({ page, totalPages, disabled, onGo }: { page: number; totalPages: number; disabled: boolean; onGo: (page: number) => void }) {
  const [typed, setTyped] = useState(String(page))
  const [shownFor, setShownFor] = useState(page)
  if (shownFor !== page) {
    // the page changed (buttons, Back): show it in the box
    setShownFor(page)
    setTyped(String(page))
  }
  function jump(event: FormEvent) {
    event.preventDefault()
    const target = Math.min(totalPages, Math.floor(Number(typed)))
    // Not a page, or the page we're on (e.g. 99999 → the last page, which is this one): just
    // show the current page again (no request, no extra Back-button step).
    if (!Number.isFinite(target) || target < 1 || target === page) return setTyped(String(page))
    onGo(target)
  }
  return (
    <form onSubmit={jump} className="flex items-center gap-2 text-sm text-muted-foreground" aria-label="Pages">
      <Button type="button" variant="outline" size="icon-sm" disabled={page <= 1 || disabled} onClick={() => onGo(page - 1)} aria-label="Previous page">
        <ChevronLeft />
      </Button>
      <span>Page</span>
      <Input
        value={typed}
        onChange={(event) => setTyped(event.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => setTyped(String(page))}
        inputMode="numeric"
        aria-label={`Page number, 1 to ${totalPages}`}
        className="h-8 w-20 text-center tabular-nums"
      />
      <span className="whitespace-nowrap">of {formatNumber(totalPages)}</span>
      <Button type="button" variant="outline" size="icon-sm" disabled={page >= totalPages || disabled} onClick={() => onGo(page + 1)} aria-label="Next page">
        <ChevronRight />
      </Button>
    </form>
  )
}

function TableSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-2xl border bg-background p-3" role="status" aria-label="Loading rows">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  )
}
