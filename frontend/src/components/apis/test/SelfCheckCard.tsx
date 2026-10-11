import { AlertTriangle, CheckCircle2, Loader2, MinusCircle, ShieldCheck, XCircle } from 'lucide-react'
import { useRef, useState, type MouseEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { ApiError, testingApi } from '@/lib/api'
import type { Api, CheckStatus, SelfCheckResult } from '@/lib/api-types'
import { formatRelativeTime } from '@/lib/format'
import { RECENT_CALLS_ID } from '@/lib/recent-calls'
import { idsFromText, selfCheckVerdict } from '@/lib/testing'
import { cn } from '@/lib/utils'
import { JsonBlock, StatusPill } from './result-bits'

type State = { status: 'idle' } | { status: 'running'; previous?: SelfCheckResult } | { status: 'ok'; result: SelfCheckResult; at: string } | { status: 'error'; error: ApiError }

const ICON: Record<CheckStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  pass: { icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400', label: 'Passed' },
  fail: { icon: XCircle, className: 'text-destructive', label: 'Failed' },
  warn: { icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-400', label: 'Warning' },
  skip: { icon: MinusCircle, className: 'text-muted-foreground/60', label: 'Skipped' },
}

// Self-check (task 4.7, mockup 1): the checks Jivox's verification runs, each ✓ ✗ ⚠ or skipped
// with the reason. Run on demand (once published it makes real calls to the live URL).
// Uses the same ids as "Call it".
export function SelfCheckCard({ brandSlug, api, idsText }: { brandSlug: string; api: Api; idsText: string }) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const latest = useRef(0)
  const base = `/brands/${brandSlug}/apis/${api.slug}`

  async function run() {
    const parsed = idsFromText(idsText)
    const ids = 'ids' in parsed && parsed.ids.length ? parsed.ids : undefined
    const request = ++latest.current
    setState((s) => ({ status: 'running', previous: s.status === 'ok' ? s.result : undefined }))
    try {
      const result = await testingApi.selfCheck(brandSlug, api.slug, ids)
      if (request === latest.current) setState({ status: 'ok', result, at: new Date().toISOString() })
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (request === latest.current) setState({ status: 'error', error: err })
    }
  }

  const result = state.status === 'ok' ? state.result : state.status === 'running' ? state.previous : undefined
  const verdict = result && selfCheckVerdict(result)

  return (
    <section aria-labelledby="check-heading" className="rounded-2xl border bg-background">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-4">
        <div className="min-w-60 flex-1">
          <h2 id="check-heading" className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
            Self-check
          </h2>
          <p className="text-sm text-muted-foreground">The checks Jivox runs before it accepts your API.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void run()} disabled={state.status === 'running'}>
          {state.status === 'running' && <Loader2 className="animate-spin" />}
          {state.status === 'idle' ? 'Run self-check' : 'Run again'}
        </Button>
      </div>

      <div className="grid gap-4 p-5" aria-live="polite" aria-busy={state.status === 'running'}>
        {state.status === 'idle' && (
          <p className="text-sm text-muted-foreground">
            {api.status === 'published'
              ? 'Calls your live URL with one of your tokens (and once without), then checks the answer.'
              : 'Checks the answer inside the app. Once the API is published, it calls the live URL too.'}
          </p>
        )}
        {state.status === 'error' && (
          <div role="alert" className="flex flex-col items-start gap-2 rounded-lg bg-muted/50 p-4 text-sm">
            <p>{state.error.message}</p>
            {(state.error.code === 'NO_DESIGN' || state.error.code === 'DESIGN_INVALID') && (
              <Link to={`${base}/design`} className="font-medium text-primary hover:underline">
                Open the Design tab
              </Link>
            )}
          </div>
        )}
        {result && verdict && (
          <div className={cn('grid gap-4 transition-opacity', state.status === 'running' && 'opacity-60')}>
            <div
              className={cn(
                'flex gap-3 rounded-lg p-3 text-sm',
                verdict.tone === 'pass' && 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
                verdict.tone === 'warn' && 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
                verdict.tone === 'fail' && 'bg-destructive/10 text-destructive',
              )}
            >
              {verdict.tone === 'pass' ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ) : verdict.tone === 'warn' ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className="font-medium">{verdict.title}</p>
                <p className="opacity-90">{verdict.text}</p>
              </div>
            </div>

            <ul className="grid gap-2.5" aria-label="Checks">
              {result.checks.map((check) => {
                const { icon: Icon, className, label } = ICON[check.status]
                return (
                  <li key={check.id} className="flex gap-2.5 text-sm" data-check={check.id} data-status={check.status}>
                    <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-label={label} />
                    <div className="min-w-0">
                      <p className={cn(check.status === 'skip' && 'text-muted-foreground')}>{check.label}</p>
                      <p className="text-xs break-words text-muted-foreground">{check.detail}</p>
                    </div>
                  </li>
                )
              })}
            </ul>

            <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <span>{result.mode === 'live' ? 'Live call' : 'Inside the app'}</span>·
              <span className="min-w-0 font-mono break-all">{result.url}</span>·<span>ids {result.ids.join(', ')}</span>
              {result.durationMs !== null && <>· <span>{result.durationMs} ms</span></>}
              {state.status === 'ok' && <>· <span>{formatRelativeTime(state.at)}</span></>}
            </p>
            {result.mode === 'live' && (
              <p className="-mt-2 text-xs text-muted-foreground">
                Jivox's own calls aren't checked here:{' '}
                <a href={`#${RECENT_CALLS_ID}`} onClick={goToRecentCalls} className="font-medium text-primary hover:underline">
                  see Recent calls
                </a>
                .
              </p>
            )}

            {result.response && (
              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  The answer that was checked <StatusPill status={result.response.status} />
                </summary>
                <JsonBlock value={result.response.body} label="Checked answer" className="mt-2" />
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// The link scrolls to the Recent calls card and moves focus to its heading (keyboard users land there).
function goToRecentCalls(event: MouseEvent) {
  event.preventDefault()
  const card = document.getElementById(RECENT_CALLS_ID)
  card?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  card?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
}
