import { AlertTriangle, CheckCircle2, Check, Copy, Download, KeyRound, Loader2, MinusCircle, Pencil, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { JsonBlock } from '@/components/apis/test/result-bits'
import { Button } from '@/components/ui/button'
import { fixTarget, groupChecks, lastTakenText } from '@/lib/agents'
import { agentsApi, ApiError, tokensApi } from '@/lib/api'
import type { Agent, AgentCheck, Api, CheckStatus, ContractCheck } from '@/lib/api-types'
import { copyToClipboard } from '@/lib/clipboard'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FieldChip } from './AgentDialog'

export type CheckState = { status: 'loading'; previous?: AgentCheck } | { status: 'ok'; result: AgentCheck } | { status: 'error'; error: ApiError }

const ICON: Record<CheckStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  pass: { icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400', label: 'Passed' },
  fail: { icon: XCircle, className: 'text-destructive', label: 'To fix' },
  warn: { icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-400', label: 'Warning' },
  skip: { icon: MinusCircle, className: 'text-muted-foreground/60', label: 'Skipped' },
}

// One agent, opened from the list (task 5.5): what Jivox says about it, the token to paste in
// Studio, the checklist (with where to fix each ✗ / ⚠) and the generated contract.
export function AgentPanel({
  brandSlug,
  api,
  agent,
  check,
  reading,
  onRunCheck,
  onRead,
  onEdit,
  onRemove,
  onTaken,
}: {
  brandSlug: string
  api: Api
  agent: Agent
  check: CheckState | undefined
  reading: boolean
  onRunCheck: () => void
  onRead: () => void
  onEdit: () => void
  onRemove: () => void
  onTaken: () => void // a contract was copied / downloaded and remembered (5.6): refresh the list
}) {
  const base = `/brands/${brandSlug}/apis/${api.slug}`
  const result = check?.status === 'ok' ? check.result : check?.status === 'loading' ? check.previous : undefined
  const j = agent.jivox
  const canRead = Boolean(agent.mcpUrl && agent.accessKey)

  return (
    <div className="grid gap-4 border-t bg-muted/20 px-4 py-4 @2xl:px-5" data-testid="agent-panel">
      {/* Phone: the facts, then the buttons below; wide: side by side */}
      <div className="flex flex-col gap-2 @xl:flex-row @xl:items-start @xl:justify-between @xl:gap-x-4">
        <p className="min-w-0 text-sm text-muted-foreground @xl:flex-1">
          {j ? (
            <>
              Jivox: <span className="text-foreground">{j.feedType}</span> · id <span className="font-mono">{j.idColumn}</span> · bound{' '}
              {j.boundFields.length ? (
                <span className="inline-flex flex-wrap gap-1 align-middle">
                  {j.boundFields.map((f) => (
                    <FieldChip key={f} name={f} />
                  ))}
                </span>
              ) : (
                'nothing'
              )}{' '}
              ·{' '}
              {j.serviceTokenRegistered ? 'token registered in Studio' : j.serviceTokenRegistered === false ? <span className="text-destructive">no token in Studio</span> : 'token unknown'} ·{' '}
              {j.contracts.activeVersion ? `contract v${j.contracts.activeVersion} active` : j.contracts.versions.length ? `${j.contracts.versions.length} verified, none active` : 'no contract in Jivox yet'} ·{' '}
              <span title={new Date(j.readAt).toLocaleString()}>read {formatRelativeTime(j.readAt)}</span>
            </>
          ) : canRead ? (
            'Not read from Jivox yet: “Read from Jivox” fills the fields you selected in Studio.'
          ) : (
            'Fields picked by hand. Add the MCP destination and access key (Edit) to read them from Jivox.'
          )}
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onRead} disabled={!canRead || reading} title={canRead ? undefined : 'Add the MCP destination and access key first'}>
            {reading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Read from Jivox
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil />
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={onRemove} aria-label={`Remove ${agent.name}`}>
            <Trash2 />
          </Button>
        </div>
      </div>

      {agent.lastError && (
        <p role="alert" className="flex gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {agent.lastError}
        </p>
      )}

      <StudioToken brandSlug={brandSlug} apiSlug={api.slug} agent={agent} onEdit={onEdit} />

      <div className="grid gap-4 @3xl:grid-cols-2">
        <section aria-label={`Checklist of ${agent.name}`} className="grid content-start gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-medium">
              Checklist
              {result && (
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', result.ready ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-destructive/10 text-destructive')}>
                  {result.ready ? 'Ready for Jivox' : `${result.checks.filter((c) => c.status === 'fail').length} to fix`}
                </span>
              )}
            </h3>
            <Button size="sm" variant="outline" onClick={onRunCheck} disabled={check?.status === 'loading'}>
              {check?.status === 'loading' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {result ? 'Run again' : 'Run checks'}
            </Button>
          </div>
          {check?.status === 'error' ? (
            <div role="alert" className="flex flex-col items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm">
              <p>{check.error.message}</p>
              {(check.error.code === 'NO_DESIGN' || check.error.code === 'DESIGN_INVALID') && (
                <Link to={`${base}/design`} className="font-medium text-primary hover:underline">
                  Open the Design tab
                </Link>
              )}
            </div>
          ) : !result ? (
            <p className="text-sm text-muted-foreground" aria-busy="true">
              Checking…
            </p>
          ) : (
            <div className={cn('grid gap-3 transition-opacity', check?.status === 'loading' && 'opacity-60')} aria-live="polite">
              {groupChecks(result.checks).map((g) => (
                <div key={g.id}>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{g.label}</p>
                  <ul className="grid gap-1.5" aria-label={g.label}>
                    {g.checks.map((c) => (
                      <CheckRow key={c.id} check={c} base={base} onEdit={onEdit} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <ContractBox brandSlug={brandSlug} api={api} agent={agent} result={result} onTaken={onTaken} />
      </div>
    </div>
  )
}

function CheckRow({ check, base, onEdit }: { check: ContractCheck; base: string; onEdit: () => void }) {
  const { icon: Icon, className, label } = ICON[check.status]
  const target = check.fix && check.status !== 'pass' ? fixTarget(check.fix.place, base) : null
  return (
    <li className="flex gap-2 text-sm" data-check={check.id} data-status={check.status}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-label={label} />
      <div className="min-w-0">
        <p className={cn(check.status === 'skip' && 'text-muted-foreground')}>{check.label}</p>
        <p className="text-xs break-words text-muted-foreground">
          {check.detail}
          {check.fix && check.status !== 'pass' && (
            <>
              {' '}
              {target && 'to' in target ? (
                <Link to={target.to} className="font-medium text-primary hover:underline">
                  {check.fix.text}
                </Link>
              ) : target && 'action' in target ? (
                <button type="button" onClick={onEdit} className="font-medium text-primary hover:underline">
                  {check.fix.text}
                </button>
              ) : (
                <span className="font-medium text-foreground">Fix: {check.fix.text}</span>
              )}
            </>
          )}
        </p>
      </div>
    </li>
  )
}

// The token to paste in Studio for this agent (Real-time data → access keys → Agent access token).
function StudioToken({ brandSlug, apiSlug, agent, onEdit }: { brandSlug: string; apiSlug: string; agent: Agent; onEdit: () => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  const t = agent.token
  if (!t || t.state === 'revoked') {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
        <KeyRound className="size-4 shrink-0" aria-hidden="true" />
        {t ? `Its token "${t.name}" was revoked.` : 'No token linked.'} Link the token you paste in Studio for this agent.
        <button type="button" onClick={onEdit} className="font-medium underline underline-offset-2 hover:no-underline">
          Link a token
        </button>
      </p>
    )
  }
  async function copy() {
    const text = tokensApi
      .reveal(brandSlug, apiSlug, t!.id)
      .then((r) => r.token)
      .catch((err: unknown) => {
        toast.error(err instanceof ApiError ? err.message : "Couldn't read the token")
        return null
      })
    try {
      if (await copyToClipboard(text)) {
        setCopied(true)
        toast.success(`"${t!.name}" copied: paste it in Studio`)
      }
    } catch {
      toast.error("Couldn't copy. Show the token on the Test tab and copy it by hand.")
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-primary/5 p-3 text-sm">
      <KeyRound className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        Token for Studio: <span className="font-medium">{t.name}</span> <span className="font-mono text-xs text-muted-foreground">{t.hint}••••</span>
        {t.state === 'expired' && <span className="text-destructive"> · expired</span>}
        <span className="block text-xs text-muted-foreground">Studio → Real-time data → this agent → access keys → “Agent access token” → paste → Save token.</span>
      </span>
      <Button size="sm" variant="outline" onClick={() => void copy()} aria-label={`Copy token ${t.name}`}>
        {copied ? <Check className="text-emerald-600 dark:text-emerald-400" /> : <Copy />}
        Copy token
      </Button>
    </div>
  )
}

function ContractBox({ brandSlug, api, agent, result, onTaken }: { brandSlug: string; api: Api; agent: Agent; result: AgentCheck | undefined; onTaken: () => void }) {
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  const text = result ? JSON.stringify(result.document, null, 2) : ''

  // 5.6: remember what was taken out (exactly this document), so the tab can say "out of date" later.
  async function remember(how: 'copy' | 'download', document: AgentCheck['document'], designVersion: number) {
    try {
      await agentsApi.taken(brandSlug, api.slug, agent.id, { how, designVersion, document })
      onTaken()
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      toast.warning(`${how === 'copy' ? 'Copied' : 'Downloaded'}, but it couldn't be remembered (${err.message}). The "out of date" mark may be wrong until you take it again.`)
    }
  }
  async function copy() {
    if (!result) return
    try {
      if (await copyToClipboard(text)) {
        setCopied(true)
        toast.success('Contract copied')
        void remember('copy', result.document, result.designVersion)
      }
    } catch {
      toast.error("Couldn't copy. Use Download instead.")
    }
  }
  // The file as the server makes it; the same text is what gets remembered.
  async function download() {
    if (!result || downloading) return
    setDownloading(true)
    try {
      const file = await agentsApi.download(brandSlug, api.slug, agent.id)
      const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }))
      const link = Object.assign(document.createElement('a'), { href: url, download: file.fileName })
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      void remember('download', JSON.parse(file.text) as AgentCheck['document'], result.designVersion)
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      toast.error(err.message)
    } finally {
      setDownloading(false)
    }
  }
  const state = agent.contract
  return (
    <section aria-label={`Contract of ${agent.name}`} className="grid min-w-0 content-start gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Contract</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void copy()} disabled={!result} aria-label="Copy contract JSON">
            {copied ? <Check className="text-emerald-600 dark:text-emerald-400" /> : <Copy />}
            Copy
          </Button>
          <Button size="sm" variant="outline" onClick={() => void download()} disabled={!result || downloading} aria-label="Download contract JSON">
            {downloading ? <Loader2 className="animate-spin" /> : <Download />}
            Download
          </Button>
        </div>
      </div>
      {state.last && state.outOfDate === true && (
        <div role="status" className="grid gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm" data-testid="contract-out-of-date">
          <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            Out of date
          </p>
          <p className="text-muted-foreground">
            The contract changed since it was {lastTakenText(state.last, formatRelativeTime).replace(/^\w/, (c) => c.toLowerCase())}:
          </p>
          <ul className="grid list-disc gap-0.5 pl-5 break-words">
            {state.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">Copy or download it again and give Jivox the new one.</p>
        </div>
      )}
      {result ? (
        <>
          <JsonBlock value={text} label={`Contract JSON of ${agent.name}`} className="max-h-[28rem]" />
          <p className="text-xs text-muted-foreground">
            Generated from design v{result.designVersion} and {agent.fields.length} agent field{agent.fields.length === 1 ? '' : 's'}; it changes when they do. Sample ids:{' '}
            <span className="font-mono">{result.sample.ids.join(', ')}</span>.{' '}
            {!state.last
              ? 'Not copied or downloaded yet: once you do, this tab tells you when it changes.'
              : state.outOfDate === false
                ? `Same as the one ${lastTakenText(state.last, formatRelativeTime).replace(/^\w/, (c) => c.toLowerCase())}.`
                : ''}
          </p>
        </>
      ) : (
        <div className="h-40 animate-pulse rounded-lg bg-muted/60" />
      )}
    </section>
  )
}
