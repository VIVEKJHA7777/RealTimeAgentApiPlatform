import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Loader2, RefreshCw, Rocket, Send, XCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { JsonBlock } from '@/components/apis/test/result-bits'
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
import { actionTitle, fixTarget, mcpHost, OUTCOME, type Tone } from '@/lib/agents'
import { agentsApi, ApiError } from '@/lib/api'
import type { Agent, AgentCheck, Api, JivoxAction, JivoxVersions } from '@/lib/api-types'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const TONE: Record<Tone, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  fail: 'border-destructive/30 bg-destructive/10 text-destructive',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  busy: 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300',
  muted: 'border-border bg-muted/40 text-muted-foreground',
}
const ICON: Record<Tone, typeof CheckCircle2> = { ok: CheckCircle2, fail: XCircle, warn: AlertTriangle, busy: Loader2, muted: CircleDashed }

type Confirm = { kind: 'submit'; failed: { id: string; label: string }[] } | { kind: 'activate'; version: number; active: number | null }

// The agent panel's Jivox part (Phase 6, task 6.5): Submit the contract (a confirmation that names the
// host), the result explained (Jivox's words + our link to fix it), the versions read live from Jivox
// with Activate, and our history of every submit / activate. Everything is recorded by the backend
// (6.3 / 6.4); this only shows it. One action per agent runs at a time (the server says "busy").
export function JivoxSection({
  brandSlug,
  api,
  agent,
  check,
  onChanged,
  onEdit,
}: {
  brandSlug: string
  api: Api
  agent: Agent
  check: AgentCheck | undefined
  onChanged: () => void // refresh the agents list (chip, out of date)
  onEdit: () => void
}) {
  const base = `/brands/${brandSlug}/apis/${api.slug}`
  const host = mcpHost(agent.mcpUrl)
  const connected = Boolean(agent.mcpUrl && agent.accessKey)
  const [versions, setVersions] = useState<{ loading: boolean; data?: JivoxVersions; error?: ApiError }>({ loading: false })
  const [history, setHistory] = useState<{ actions: JivoxAction[]; next: string | null; loading: boolean }>({ actions: [], next: null, loading: false })
  const [result, setResult] = useState<JivoxAction | null>(null)
  const [sending, setSending] = useState<null | 'submit' | number>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | null>(null) // focus goes back here when a dialog closes
  const latest = useRef(0)
  const ask = (c: Confirm) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setConfirm(c)
  }

  const loadVersions = useCallback(async () => {
    if (!connected) return
    const n = ++latest.current
    setVersions((v) => ({ ...v, loading: true }))
    try {
      const data = await agentsApi.versions(brandSlug, api.slug, agent.id)
      if (n === latest.current) setVersions({ loading: false, data })
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (n === latest.current) setVersions((v) => ({ loading: false, data: v.data, error: err }))
    }
  }, [brandSlug, api.slug, agent.id, connected])

  const loadHistory = useCallback(async (more = false) => {
    setHistory((h) => ({ ...h, loading: true }))
    try {
      const page = await agentsApi.actions(brandSlug, api.slug, agent.id, more ? history.next ?? undefined : undefined)
      setHistory((h) => ({ actions: more ? [...h.actions, ...page.actions] : page.actions, next: page.next, loading: false }))
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      setHistory((h) => ({ ...h, loading: false }))
    }
  }, [brandSlug, api.slug, agent.id, history.next])

  // Open: read the versions from Jivox and our history. Another agent: start fresh.
  useEffect(() => {
    setResult(null)
    setVersions({ loading: false })
    setHistory({ actions: [], next: null, loading: false })
    void loadVersions()
    void loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, connected])

  // Something runs for this agent that we didn't start here (another tab / person): follow it.
  const runningElsewhere = Boolean(agent.jivoxActions?.running) && sending === null
  useEffect(() => {
    if (!runningElsewhere) return
    const timer = setInterval(() => onChanged(), 3000)
    return () => clearInterval(timer)
  }, [runningElsewhere, onChanged])
  const wasRunning = useRef(runningElsewhere)
  useEffect(() => {
    if (wasRunning.current && !runningElsewhere) {
      void loadHistory()
      void loadVersions()
    }
    wasRunning.current = runningElsewhere
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningElsewhere])

  const failing = (check?.checks ?? []).filter((c) => c.status === 'fail').map((c) => ({ id: c.id, label: c.label }))

  // After an action: the result card takes the focus (the button that started it may be gone, e.g.
  // Activate once its version is active), so keyboard and screen-reader users land on what happened.
  const resultRef = useRef<HTMLDivElement>(null)
  const focusResult = useRef(false)
  useEffect(() => {
    // The card shows once the action is over (sending = null): focus it then.
    if (result && sending === null && focusResult.current) {
      focusResult.current = false
      resultRef.current?.focus()
    }
  }, [result, sending])

  async function after(action: JivoxAction) {
    focusResult.current = true
    setResult(action)
    onChanged()
    await Promise.all([loadVersions(), loadHistory()])
    const o = OUTCOME[action.outcome ?? 'unknown']
    const say = `${agent.name}: ${actionTitle(action)}`
    if (o.tone === 'ok') toast.success(say)
    else if (o.tone === 'fail') toast.error(say)
    else toast.warning(say)
  }

  async function submit(anyway: boolean) {
    setConfirm(null)
    setSending('submit')
    try {
      await after((await agentsApi.submit(brandSlug, api.slug, agent.id, anyway)).action)
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (err.code === 'CHECKLIST_FAILED') {
        // The checklist changed since it was shown: ask again with the server's list.
        setConfirm({ kind: 'submit', failed: (err.extra?.failed as { id: string; label: string }[] | undefined) ?? [] })
      } else {
        toast.error(err.message)
        if (err.code === 'JIVOX_BUSY') onChanged()
      }
    } finally {
      setSending(null)
    }
  }

  async function activate(version: number) {
    setConfirm(null)
    setSending(version)
    try {
      await after((await agentsApi.activate(brandSlug, api.slug, agent.id, version)).action)
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      toast.error(err.message)
      if (err.code === 'JIVOX_BUSY') onChanged()
    } finally {
      setSending(null)
    }
  }

  const busy = sending !== null || Boolean(agent.jivoxActions?.running)
  const activeVersion = versions.data?.activeVersion ?? null
  const askActivate = (version: number) => ask({ kind: 'activate', version, active: activeVersion })

  return (
    <section aria-label={`Jivox for ${agent.name}`} className="grid grid-cols-1 gap-3 rounded-xl border bg-background p-4" data-testid="jivox-section">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="min-w-[12rem] flex-1 font-medium">
          Jivox
          {host && <span className="block font-mono text-xs font-normal break-all text-muted-foreground">{host}</span>}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => { void loadVersions(); void loadHistory() }} disabled={!connected || versions.loading} aria-label="Refresh versions and history">
            {versions.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
          <Button ref={submitRef} size="sm" onClick={() => ask({ kind: 'submit', failed: failing })} disabled={!connected || busy || !check} title={!connected ? 'Add the MCP destination and access key first' : !check ? 'Wait for the checklist' : undefined}>
            {sending === 'submit' ? <Loader2 className="animate-spin" /> : <Send />}
            {sending === 'submit' ? 'Sending…' : 'Submit to Jivox'}
          </Button>
        </div>
      </div>

      {!connected ? (
        <p className="text-sm text-muted-foreground">
          To submit, add this agent's MCP destination and access key from Studio.{' '}
          <button type="button" onClick={onEdit} className="font-medium text-primary hover:underline">
            Edit the agent
          </button>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Jivox checks the contract and calls your live API once with the token in Studio. A verified contract becomes a new version; activate it to make it live.</p>
      )}

      {sending === 'submit' && <Banner tone="busy" title="Sending to Jivox…" text="Jivox is checking the contract and calling your API. This takes a few seconds (at most a minute)." />}
      {typeof sending === 'number' && <Banner tone="busy" title={`Activating v${sending}…`} text="Jivox re-checks the version and calls your API once more." />}
      {runningElsewhere && agent.jivoxActions?.running && (
        <Banner tone="busy" title={agent.jivoxActions.running.kind === 'submit' ? 'A submit is running' : `Activating v${agent.jivoxActions.running.version}`} text={`Started ${formatRelativeTime(agent.jivoxActions.running.startedAt)} (another tab or person). This updates by itself.`} />
      )}

      {result && sending === null && (
        <div ref={resultRef} tabIndex={-1} className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Last result">
          <ActionCard action={result} base={base} onEdit={onEdit} activeVersion={activeVersion} onActivate={busy ? undefined : askActivate} onDismiss={() => { setResult(null); submitRef.current?.focus() }} />
        </div>
      )}

      {connected && <Versions state={versions} busy={busy} sending={sending} onActivate={askActivate} />}

      <History brandSlug={brandSlug} apiSlug={api.slug} agentId={agent.id} base={base} onEdit={onEdit} history={history} onMore={() => void loadHistory(true)} />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            // Opened by state, so Radix has no trigger to return to: the button that opened it, else Submit.
            event.preventDefault()
            const back = opener.current?.isConnected && !(opener.current as HTMLButtonElement).disabled ? opener.current : submitRef.current
            back?.focus()
          }}
        >
          {confirm?.kind === 'submit' ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Submit to Jivox?</AlertDialogTitle>
                <AlertDialogDescription>
                  {agent.name}'s contract goes to <span className="font-mono break-all text-foreground">{host}</span>. Jivox checks it and calls your live API once. Every
                  submit is kept in Jivox, failed ones too.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {confirm.failed.length > 0 && (
                <div role="alert" className="grid gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-300">
                    {confirm.failed.length} check{confirm.failed.length === 1 ? '' : 's'} fail{confirm.failed.length === 1 ? 's' : ''}: Jivox will probably refuse it.
                  </p>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {confirm.failed.map((f) => (
                      <li key={f.id}>{f.label}</li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground">Submit anyway to see how Jivox answers (useful for testing).</p>
                </div>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void submit(confirm.failed.length > 0)}>
                  {confirm.failed.length > 0 ? 'Submit anyway' : 'Submit'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : confirm?.kind === 'activate' ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Activate version {confirm.version}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Version {confirm.version} becomes {agent.name}'s live contract on <span className="font-mono break-all text-foreground">{host}</span>.
                  {confirm.active ? ` Version ${confirm.active} is retired: that can't be undone (to go back, submit its contract again).` : ''} Jivox re-checks it and calls your API once
                  first.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void activate(confirm.version)}>Activate v{confirm.version}</AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function Banner({ tone, title, text }: { tone: Tone; title: string; text?: string }) {
  const Icon = ICON[tone]
  return (
    <div role="status" className={cn('flex gap-2 rounded-lg border p-3 text-sm', TONE[tone])}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone === 'busy' && 'animate-spin')} aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {text && <p className="text-muted-foreground">{text}</p>}
      </div>
    </div>
  )
}

// One submit / activate explained: Jivox's words first, then OUR link to the place to fix it.
function ActionCard({
  action,
  base,
  onEdit,
  activeVersion,
  onActivate,
  onDismiss,
}: {
  action: JivoxAction
  base: string
  onEdit: () => void
  activeVersion: number | null
  onActivate?: (version: number) => void
  onDismiss?: () => void
}) {
  const o = OUTCOME[action.state === 'running' ? 'running' : (action.outcome ?? 'unknown')]
  const Icon = ICON[o.tone]
  const canActivate = action.kind === 'submit' && action.outcome === 'verified' && action.version !== null && action.version !== activeVersion && onActivate
  return (
    <div className={cn('grid gap-2 rounded-lg border p-3 text-sm', TONE[o.tone])} data-testid="jivox-result">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <p className="flex min-w-0 flex-1 items-start gap-2 font-medium">
          <Icon className={cn('mt-0.5 size-4 shrink-0', o.tone === 'busy' && 'animate-spin')} aria-hidden="true" />
          <span className="min-w-0">
            {actionTitle(action)}
            <span className="block text-xs font-normal text-muted-foreground">
              {formatDateTime(action.startedAt)}
              {action.designVersion !== null && ` · design v${action.designVersion}`}
              {action.startedBy && ` · ${action.startedBy}`}
              {action.failedChecks.length > 0 && ` · sent anyway with ✗ ${action.failedChecks.join(', ')}`}
            </span>
          </span>
        </p>
        <div className="flex gap-2">
          {canActivate && (
            <Button size="sm" onClick={() => onActivate!(action.version!)}>
              <Rocket />
              Activate v{action.version}
            </Button>
          )}
          {onDismiss && (
            <Button size="sm" variant="ghost" onClick={onDismiss} aria-label="Hide this result">
              Hide
            </Button>
          )}
        </div>
      </div>
      {action.outcome === 'activated' && <p className="text-foreground">Version {action.version} is live for this agent{action.retired ? `; version ${action.retired} is retired` : ''}.</p>}
      {action.errorMessage && <p className="text-foreground">{action.errorMessage}</p>}
      {action.message && <p className="text-foreground">Jivox: “{action.message}”</p>}
      {action.outcome === 'unknown' && (
        <p className="text-foreground">Jivox answered “{action.jivoxStatus ?? 'something'}”, which this app doesn't know yet. Its whole answer is below; check the versions.</p>
      )}
      {(action.problems?.length ?? 0) > 0 && (
        <ul className="grid gap-1.5 text-foreground" aria-label="What Jivox found">
          {action.problems!.map((p, i) => (
            <li key={i} className="grid gap-0.5 rounded-md bg-background/70 px-2.5 py-1.5">
              <span className="break-words">
                {p.code && <span className="mr-1.5 font-mono text-xs text-muted-foreground">{p.code}</span>}
                {p.message}
              </span>
              {p.fix && <span className="text-xs text-muted-foreground">Jivox's fix: {p.fix}</span>}
            </li>
          ))}
        </ul>
      )}
      {(action.hints?.length ?? 0) > 0 && (
        <ul className="grid gap-1" aria-label="Where to fix it">
          {action.hints!.map((h) => {
            const target = fixTarget(h.place, base)
            return (
              <li key={h.place} className="text-foreground">
                → {h.text}{' '}
                {target && 'to' in target ? (
                  <Link to={target.to} className="font-medium text-primary hover:underline">
                    Open
                  </Link>
                ) : target && 'action' in target ? (
                  <button type="button" onClick={onEdit} className="font-medium text-primary hover:underline">
                    Edit the agent
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {action.evidence != null && (
        <details className="text-foreground">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Jivox's evidence (the call it made, our answer)</summary>
          <JsonBlock value={action.evidence} label="Jivox's evidence" className="mt-2 max-h-72 bg-background" />
        </details>
      )}
      {action.answer !== undefined && action.answer !== null && (
        // Jivox's answer exactly as it came (secrets removed): open when we couldn't read it.
        <details open={action.outcome === 'unknown'} className="text-foreground">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Jivox's answer (raw)</summary>
          <JsonBlock value={action.answer} label="Jivox's answer" className="mt-2 max-h-72 bg-background" />
        </details>
      )}
    </div>
  )
}

function Versions({ state, busy, sending, onActivate }: { state: { loading: boolean; data?: JivoxVersions; error?: ApiError }; busy: boolean; sending: null | 'submit' | number; onActivate: (v: number) => void }) {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">Versions in Jivox (verified and active; retired and failed ones aren't listed by Jivox)</p>
      {state.error && !state.data ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error.message}
        </p>
      ) : !state.data ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          Reading from Jivox…
        </p>
      ) : state.data.versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No verified versions yet.</p>
      ) : (
        <ul className="grid gap-1.5" aria-label="Versions">
          {[...state.data.versions].reverse().map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm">
              <span className="font-medium">v{v.version}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', v.active ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>
                {v.active ? 'Active' : (v.status ?? 'verified')}
              </span>
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {v.submittedHere
                  ? `design v${v.submittedHere.designVersion ?? '?'} · ${formatRelativeTime(v.submittedHere.at)}${v.submittedHere.by ? ` · ${v.submittedHere.by}` : ''}`
                  : v.createdAt
                    ? `${formatRelativeTime(v.createdAt)} · not submitted from this app`
                    : 'not submitted from this app'}
              </span>
              {!v.active && (
                <Button size="sm" variant="outline" onClick={() => onActivate(v.version)} disabled={busy}>
                  {sending === v.version ? <Loader2 className="animate-spin" /> : <Rocket />}
                  Activate
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {state.error && state.data && <p className="text-xs text-destructive">Couldn't refresh: {state.error.message}</p>}
    </div>
  )
}

function History({
  brandSlug,
  apiSlug,
  agentId,
  base,
  onEdit,
  history,
  onMore,
}: {
  brandSlug: string
  apiSlug: string
  agentId: string
  base: string
  onEdit: () => void
  history: { actions: JivoxAction[]; next: string | null; loading: boolean }
  onMore: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, JivoxAction | 'loading' | 'error'>>({})
  async function toggle(id: string) {
    const next = open === id ? null : id
    setOpen(next)
    if (next && !details[next]) {
      setDetails((d) => ({ ...d, [next]: 'loading' }))
      try {
        const { action } = await agentsApi.action(brandSlug, apiSlug, agentId, next)
        setDetails((d) => ({ ...d, [next]: action }))
      } catch {
        setDetails((d) => ({ ...d, [next]: 'error' }))
      }
    }
  }
  if (history.actions.length === 0) return history.loading ? null : <p className="text-sm text-muted-foreground">Nothing submitted from this app yet.</p>
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">History (from this app)</p>
      <ul className="grid gap-1" aria-label="History">
        {history.actions.map((a) => {
          const o = OUTCOME[a.state === 'running' ? 'running' : (a.outcome ?? 'unknown')]
          const Icon = ICON[o.tone]
          const d = details[a.id]
          return (
            <li key={a.id} className="rounded-lg border">
              <button type="button" onClick={() => void toggle(a.id)} aria-expanded={open === a.id} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40">
                <Icon className={cn('size-4 shrink-0', o.tone === 'ok' && 'text-emerald-600 dark:text-emerald-400', o.tone === 'fail' && 'text-destructive', o.tone === 'warn' && 'text-amber-600 dark:text-amber-400', o.tone === 'busy' && 'animate-spin text-sky-600')} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{actionTitle(a)}</span>
                <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(a.startedAt)}>
                  {formatRelativeTime(a.startedAt)}
                </span>
                {open === a.id ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              </button>
              {open === a.id && (
                <div className="grid gap-2 border-t p-3">
                  {d === 'loading' || !d ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : d === 'error' ? (
                    <p className="text-sm text-destructive">Couldn't load this one.</p>
                  ) : (
                    <>
                      <ActionCard action={d} base={base} onEdit={onEdit} activeVersion={null} />
                      {d.document != null && (
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">The contract that was sent</summary>
                          <JsonBlock value={d.document} label="Contract sent" className="mt-2 max-h-72" />
                        </details>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {history.next && (
        <Button size="sm" variant="outline" className="justify-self-start" onClick={onMore} disabled={history.loading}>
          {history.loading && <Loader2 className="animate-spin" />}
          Load more
        </Button>
      )}
    </div>
  )
}
