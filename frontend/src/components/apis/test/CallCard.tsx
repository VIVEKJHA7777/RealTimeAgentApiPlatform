import { AlertTriangle, Check, Copy, Loader2, Play, TerminalSquare } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ApiError, testingApi, tokensApi } from '@/lib/api'
import type { Api, TokenInfo, TryResult } from '@/lib/api-types'
import { copyToClipboard } from '@/lib/clipboard'
import { idsFromText, TOKEN_PLACEHOLDER } from '@/lib/testing'
import { maskedToken } from '@/lib/tokens'
import { cn } from '@/lib/utils'
import { JsonBlock, StatusPill } from './result-bits'

type State = { status: 'loading' } | { status: 'ok'; result: TryResult } | { status: 'error'; error: ApiError }

// "Call it" (task 4.7, mockup 1): the curl command Jivox-style (copy it with a placeholder or one
// of your tokens), an ids box, and "Try it": what /v1 would answer, run inside the app with the
// SAVED design (works on drafts, no token needed).
export function CallCard({
  brandSlug,
  api,
  tokens,
  idsText,
  onIdsTextChange,
}: {
  brandSlug: string
  api: Api
  tokens: TokenInfo[]
  idsText: string
  onIdsTextChange: (text: string) => void
}) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [tokenId, setTokenId] = useState('') // '' = the placeholder
  const [idsError, setIdsError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [running, setRunning] = useState(false)
  const latest = useRef(0)
  const id = useId()
  const base = `/brands/${brandSlug}/apis/${api.slug}`

  // Only tokens that work and can be read are offered (the copy puts the real one in).
  const usable = tokens.filter((t) => t.state === 'active' && t.canShow)
  const chosen = usable.find((t) => t.id === tokenId)

  async function run(text: string) {
    const parsed = idsFromText(text)
    if ('error' in parsed) return setIdsError(parsed.error)
    setIdsError(undefined)
    const request = ++latest.current
    setState((s) => (s.status === 'ok' ? s : { status: 'loading' })) // keep the last answer while a new one loads
    setRunning(true)
    try {
      const result = await testingApi.tryIt(brandSlug, api.slug, parsed.ids.length ? parsed.ids : undefined)
      if (request === latest.current) setState({ status: 'ok', result })
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (request === latest.current) setState({ status: 'error', error: err })
    } finally {
      if (request === latest.current) setRunning(false)
    }
  }

  // First answer on opening, and again when what the answer depends on changes.
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })
  useEffect(() => {
    void runRef.current(idsText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandSlug, api.slug, api.designVersion, api.authHeader, api.status])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const result = state.status === 'ok' ? state.result : null
  const curl = result?.curl ?? ''
  const shownCurl = chosen ? curl.replaceAll(TOKEN_PLACEHOLDER, maskedToken(chosen.hint)) : curl

  async function copyCurl() {
    if (!curl) return
    const text = chosen
      ? tokensApi
          .reveal(brandSlug, api.slug, chosen.id)
          .then((r) => curl.replaceAll(TOKEN_PLACEHOLDER, r.token))
          .catch((err: unknown) => {
            toast.error(err instanceof ApiError ? err.message : "Couldn't read the token")
            return null
          })
      : curl
    try {
      if (await copyToClipboard(text)) {
        setCopied(true)
        toast.success(chosen ? `curl copied with "${chosen.name}"` : 'curl copied (put your token in)')
      }
    } catch {
      toast.error("Couldn't copy. Select the command and copy it by hand.")
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void run(idsText)
  }

  return (
    <section aria-labelledby="call-heading" className="@container rounded-2xl border bg-background">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-4">
        <div className="min-w-60 flex-1">
          <h2 id="call-heading" className="flex items-center gap-2 font-semibold">
            <TerminalSquare className="size-4 text-muted-foreground" aria-hidden="true" />
            Call it
          </h2>
          <p className="text-sm text-muted-foreground">What Jivox sends, and what your API answers (saved design).</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground" htmlFor={`${id}-token`}>
          Token in curl
          <select
            id={`${id}-token`}
            value={chosen ? chosen.id : ''}
            onChange={(e) => setTokenId(e.target.value)}
            className="h-8 max-w-48 truncate rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:[color-scheme:dark]"
          >
            <option value="">{TOKEN_PLACEHOLDER}</option>
            {usable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 p-5">
        {state.status === 'error' ? (
          <NotReady error={state.error} base={base} onRetry={() => void run(idsText)} />
        ) : (
          <>
            <div className="relative">
              <pre
                className={cn('min-h-16 overflow-x-auto rounded-lg bg-muted/60 p-3 pr-11 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all', !curl && 'animate-pulse')}
                aria-label="curl command"
                data-testid="curl"
              >
                {shownCurl}
              </pre>
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-2 right-2"
                aria-label={copied ? 'Copied' : chosen ? `Copy curl with token ${chosen.name}` : 'Copy curl'}
                title={copied ? 'Copied' : 'Copy curl'}
                onClick={() => void copyCurl()}
                disabled={!curl}
              >
                {copied ? <Check className="text-emerald-600 dark:text-emerald-400" /> : <Copy />}
              </Button>
            </div>
            {!chosen && usable.length === 0 && (
              <p className="-mt-2 text-xs text-muted-foreground">Create a token above to copy a ready-to-run command.</p>
            )}

            <form onSubmit={submit} noValidate className="flex flex-col gap-2 @lg:flex-row @lg:items-start">
              <div className="grid min-w-0 flex-1 gap-1">
                <label htmlFor={`${id}-ids`} className="sr-only">
                  Ids to ask for
                </label>
                <Input
                  id={`${id}-ids`}
                  value={idsText}
                  onChange={(e) => {
                    onIdsTextChange(e.target.value)
                    setIdsError(undefined)
                  }}
                  placeholder={result && !idsText.trim() ? `${result.ids.join(', ')} (first rows)` : 'Ids, separated by commas'}
                  aria-invalid={Boolean(idsError)}
                  aria-describedby={`${id}-ids-hint`}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
                <p id={`${id}-ids-hint`} className={cn('text-xs', idsError ? 'text-destructive' : 'text-muted-foreground')}>
                  {idsError ?? 'Leave empty for the first rows of your data. Separate ids with commas.'}
                </p>
              </div>
              <Button type="submit" disabled={running} className="@lg:w-28">
                {running ? <Loader2 className="animate-spin" /> : <Play />}
                Try it
              </Button>
            </form>

            {result && <Answer result={result} stale={running} />}
          </>
        )}
      </div>
    </section>
  )
}

function Answer({ result, stale }: { result: TryResult; stale: boolean }) {
  const { response, request } = result
  return (
    <div className={cn('grid gap-3 transition-opacity', stale && 'opacity-60')} aria-live="polite" aria-busy={stale}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <StatusPill status={response.status} />
        <span>{result.durationMs} ms</span>
        {response.headers['Cache-Control'] && <span className="font-mono">Cache-Control: {response.headers['Cache-Control']}</span>}
        {result.status === 'draft' && (
          <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            Draft: answered inside the app. The live URL answers 404 until you publish.
          </span>
        )}
      </div>
      {request.method === 'POST' && (
        <details className="group text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Request body Jivox sends</summary>
          <JsonBlock value={request.body} label="Request body" className="mt-2" />
        </details>
      )}
      <JsonBlock value={response.body} label="Response body" />
    </div>
  )
}

function NotReady({ error, base, onRetry }: { error: ApiError; base: string; onRetry: () => void }) {
  const link =
    error.code === 'NO_DESIGN' || error.code === 'DESIGN_INVALID'
      ? { to: `${base}/design`, text: 'Open the Design tab' }
      : error.code === 'NO_DATA'
        ? { to: `${base}/data`, text: 'Open the Data tab' }
        : null
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-lg bg-muted/50 p-4 text-sm">
      <p>{error.message}</p>
      {link ? (
        <Link to={link.to} className="font-medium text-primary hover:underline">
          {link.text}
        </Link>
      ) : (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
