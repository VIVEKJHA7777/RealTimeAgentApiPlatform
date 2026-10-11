import { AlertTriangle, Info, Loader2, RefreshCw } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PreviewState } from '@/lib/use-design-checks'
import { problemPath } from '@/lib/design'
import { cn } from '@/lib/utils'

type Props = {
  state: PreviewState | null
  loading: boolean
  ids: string
  onIdsChange: (ids: string) => void
  onReload: () => void
  exampleIds: string[] // real ids of the data, for the placeholder
  className?: string
}

// "Preview": what Jivox would send and what the API would answer, for the design being edited
// (saved or not) and real rows. Refreshes by itself shortly after every change.
export function PreviewPanel({ state, loading, ids, onIdsChange, onReload, exampleIds, className }: Props) {
  return (
    <section aria-labelledby="preview-heading" aria-busy={loading} className={cn('flex min-w-0 flex-col gap-3 rounded-2xl border bg-background p-4 sm:p-5', className)}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 id="preview-heading" className="flex items-center gap-2 font-semibold">
            Preview
            {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Updating the preview" />}
          </h2>
          <p className="text-xs text-muted-foreground">Real rows · nothing is saved</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Refresh the preview" onClick={onReload}>
          <RefreshCw />
        </Button>
      </div>

      <div className="grid gap-1">
        <label htmlFor="preview-ids" className="text-xs text-muted-foreground">
          Ids to try (comma-separated; empty = the first 2 rows)
        </label>
        <Input id="preview-ids" value={ids} onChange={(e) => onIdsChange(e.target.value)} placeholder={exampleIds.length > 0 ? exampleIds.join(', ') : 'ID-1, ID-2'} className="font-mono text-[13px]" />
      </div>

      <div className={cn('flex min-w-0 flex-col gap-3 transition-opacity', loading && state && 'opacity-60')}>
        {state === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Building the preview…</p>
        ) : state.status === 'invalid' ? (
          <div className="rounded-xl border border-dashed p-4 text-sm">
            <p className="font-medium">
              Fix {state.problems.length} {state.problems.length === 1 ? 'problem' : 'problems'} to see the preview
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-xs text-destructive">
              {state.problems.slice(0, 6).map((p, i) => (
                <li key={i}>
                  <code className="mr-1 rounded bg-destructive/10 px-1">{problemPath(p)}</code>
                  {p.message}
                </li>
              ))}
              {state.problems.length > 6 && <li className="text-muted-foreground">and {state.problems.length - 6} more</li>}
            </ul>
          </div>
        ) : state.status === 'no-data' ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{state.message}</p>
        ) : state.status === 'error' ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="text-destructive">{state.message}</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onReload}>
              Try again
            </Button>
          </div>
        ) : (
          <PreviewResult preview={state.preview} />
        )}
      </div>
    </section>
  )
}

function PreviewResult({ preview }: { preview: Extract<PreviewState, { status: 'ok' }>['preview'] }) {
  const { request, response } = preview
  const responseText = JSON.stringify(response, null, 2)
  return (
    <>
      <CodeBlock title="Jivox sends" copy={request.method === 'GET' ? request.url : JSON.stringify(request.body, null, 2)}>
        <span className="font-medium text-primary">{request.method}</span>{' '}
        {request.method === 'GET' ? request.url : `${request.path}\n${JSON.stringify(request.body, null, 2)}`}
      </CodeBlock>
      <CodeBlock title={`Your API answers · ${response.data.length} ${response.data.length === 1 ? 'item' : 'items'}${response.errors.length ? ` · ${response.errors.length} unknown` : ''}`} copy={responseText}>
        {responseText}
      </CodeBlock>
      <p className="text-xs text-muted-foreground">
        Headers: {Object.entries(preview.responseHeaders).map(([k, v]) => `${k}: ${v}`).join(' · ')}
      </p>
      {preview.notes.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground" aria-label="Values that weren't sent as written">
          {preview.notes.slice(0, 8).map((note, i) => (
            <li key={i} className="flex gap-1.5">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-mono text-foreground">{note.id}</span> · {note.responseKey}:{' '}
                {note.value === null ? 'empty' : <span className="font-mono">"{note.value}"</span>} → {note.used}
              </span>
            </li>
          ))}
          {preview.notes.length > 8 && <li>and {preview.notes.length - 8} more</li>}
        </ul>
      )}
      {preview.warnings.map((warning, i) => (
        <p key={i} className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {warning}
        </p>
      ))}
    </>
  )
}

function CodeBlock({ title, copy, children }: { title: string; copy: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <CopyButton value={copy} label={`Copy: ${title}`} />
      </div>
      <pre className="max-h-96 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-5 break-all whitespace-pre-wrap">{children}</pre>
    </div>
  )
}
