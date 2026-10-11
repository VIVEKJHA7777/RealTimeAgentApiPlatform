import { Bot, ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useApiPage } from '@/components/apis/api-page/context'
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
import { Skeleton } from '@/components/ui/skeleton'
import { checkSummary, contractMark, mcpHost } from '@/lib/agents'
import { agentsApi, ApiError } from '@/lib/api'
import type { Agent } from '@/lib/api-types'
import { formatRelativeTime } from '@/lib/format'
import { useRequest } from '@/lib/use-request'
import { useTokens } from '@/lib/use-tokens'
import { cn } from '@/lib/utils'
import { AgentDialog, FieldChip } from './AgentDialog'
import { AgentPanel, type CheckState } from './AgentPanel'

const COLS = '@2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_1rem]'

// The API page's Jivox tab (Phase 5, task 5.5): the Real Time Agents this API serves (many per API),
// each with its own contract (only its fields) and checklist. Opening an agent runs its checks;
// they run again when the API changes under them (design saved, published, header style).
export function JivoxTab() {
  const { organization, api, dataSource } = useApiPage()
  const brandSlug = organization.slug
  const list = useRequest(`agents:${brandSlug}/${api.slug}`, () => agentsApi.list(brandSlug, api.slug), { refetchOnFocus: true })
  const tokens = useTokens(brandSlug, api.slug)
  const [openId, setOpenId] = useState<string | null>(null)
  const [checks, setChecks] = useState<Record<string, CheckState>>({})
  const [reading, setReading] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ open: boolean; agent: Agent | null }>({ open: false, agent: null })
  const [removing, setRemoving] = useState<Agent | null>(null)
  const latest = useRef<Record<string, number>>({})
  const addButton = useRef<HTMLButtonElement>(null)
  // The button that opened the dialog (Add, Edit, a fix link): focus goes back there when it closes.
  const opener = useRef<HTMLElement | null>(null)
  const openDialog = (agent: Agent | null) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDialog({ open: true, agent })
  }
  const agents = list.data?.agents ?? []
  const max = list.data?.limits.maxAgents ?? 20

  async function runCheck(agentId: string) {
    const n = (latest.current[agentId] = (latest.current[agentId] ?? 0) + 1)
    setChecks((c) => ({ ...c, [agentId]: { status: 'loading', previous: c[agentId]?.status === 'ok' ? c[agentId].result : c[agentId]?.status === 'loading' ? c[agentId].previous : undefined } }))
    try {
      const result = await agentsApi.check(brandSlug, api.slug, agentId)
      if (latest.current[agentId] === n) setChecks((c) => ({ ...c, [agentId]: { status: 'ok', result } }))
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (latest.current[agentId] !== n) return
      if (err.code === 'AGENT_NOT_FOUND') {
        toast.error('This agent was removed meanwhile (another tab?)')
        void list.refresh()
        return setOpenId(null)
      }
      setChecks((c) => ({ ...c, [agentId]: { status: 'error', error: err } }))
    }
  }

  // The API changed (design saved, published / unpublished, header style, data): every result is
  // out of date. Re-check the open agent now; the others when opened. The list too: its "out of
  // date" marks compare each agent's contract with the one last copied (5.6).
  const apiKey = `${api.designVersion}|${api.status}|${api.authHeader}|${dataSource.lastImportAt}`
  const lastApiKey = useRef(apiKey)
  useEffect(() => {
    if (lastApiKey.current === apiKey) return
    lastApiKey.current = apiKey
    setChecks({})
    void list.refresh()
    if (openId) void runCheck(openId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  function toggle(agentId: string) {
    const next = openId === agentId ? null : agentId
    setOpenId(next)
    if (next && checks[next]?.status !== 'ok' && checks[next]?.status !== 'loading') void runCheck(next)
  }

  async function read(agent: Agent, quietIfOk = false) {
    setReading(agent.id)
    try {
      const r = await agentsApi.readJivox(brandSlug, api.slug, agent.id)
      await list.refresh()
      if (!r.feedTypeMatches) toast.error(r.agent.lastError ?? 'Jivox says this agent serves another feed type')
      else if (!quietIfOk) toast.success(`Read from Jivox: ${r.agent.fields.length ? r.agent.fields.join(', ') : 'no fields bound in Studio'}`)
      else toast.success(`${agent.name}: fields from Jivox: ${r.agent.fields.join(', ') || 'none bound'}`)
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      toast.error(err.message)
      await list.refresh() // the error is kept on the agent (lastError)
    } finally {
      setReading(null)
      if (openId === agent.id || quietIfOk) void runCheck(agent.id)
    }
  }

  async function saved(agent: Agent, readJivox: boolean) {
    await list.refresh()
    void tokens.refresh()
    setOpenId(agent.id)
    if (readJivox) await read(agent, true)
    else void runCheck(agent.id)
  }

  async function remove(agent: Agent) {
    try {
      await agentsApi.remove(brandSlug, api.slug, agent.id)
      toast.success(`"${agent.name}" removed`)
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (err.code !== 'AGENT_NOT_FOUND') return toast.error(err.message)
    }
    setRemoving(null)
    if (openId === agent.id) setOpenId(null)
    setChecks(({ [agent.id]: _gone, ...rest }) => rest)
    await list.refresh()
    addButton.current?.focus()
  }

  return (
    <section aria-labelledby="agents-heading" className="@container rounded-2xl border bg-background">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-4">
        <div className="min-w-60 flex-1">
          <h2 id="agents-heading" className="flex items-center gap-2 font-semibold">
            <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
            Real Time Agents
            {list.data && (
              <span className="text-sm font-normal text-muted-foreground">
                {agents.length} of {max}
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">Each Jivox agent gets its own contract with only its fields. They all call this API's address.</p>
        </div>
        <Button ref={addButton} size="sm" onClick={() => openDialog(null)} disabled={!list.data || agents.length >= max} title={agents.length >= max ? `At most ${max} agents per API` : undefined}>
          <Plus />
          Add agent
        </Button>
      </div>

      {list.loading && !list.data ? (
        <div className="grid gap-2 p-4" aria-label="Loading agents">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : list.error && !list.data ? (
        <div role="alert" className="flex flex-col items-start gap-2 p-5 text-sm">
          <p>{list.error.message}</p>
          <Button size="sm" variant="outline" onClick={list.reload}>
            Try again
          </Button>
        </div>
      ) : agents.length === 0 ? (
        <div className="grid gap-1 p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Add the agents you created in Jivox Studio</p>
          <p>In Studio, open Real-time data, add a Real Time Agent and select its fields. Its access keys give the MCP destination and access key to paste here.</p>
        </div>
      ) : (
        <div>
          <div aria-hidden="true" className={cn('hidden gap-3 px-5 pt-3 pb-1 text-xs text-muted-foreground @2xl:grid', COLS)}>
            <span>Agent</span>
            <span>Fields</span>
            <span>Token</span>
            <span>Contract</span>
            <span />
          </div>
          <ul aria-label="Agents">
            {agents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} open={openId === agent.id} check={checks[agent.id]} reading={reading === agent.id} onToggle={() => toggle(agent.id)}>
                {openId === agent.id && (
                  <AgentPanel
                    brandSlug={brandSlug}
                    api={api}
                    agent={agent}
                    check={checks[agent.id]}
                    reading={reading === agent.id}
                    onRunCheck={() => void runCheck(agent.id)}
                    onRead={() => void read(agent)}
                    onEdit={() => openDialog(agent)}
                    onRemove={() => setRemoving(agent)}
                    onTaken={() => void list.refresh()}
                  />
                )}
              </AgentRow>
            ))}
          </ul>
        </div>
      )}

      <AgentDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        brandSlug={brandSlug}
        apiSlug={api.slug}
        feedType={api.feedType}
        agent={dialog.agent}
        tokens={tokens.data?.tokens ?? []}
        onSaved={(agent, readJivox) => void saved(agent, readJivox)}
        onGone={() => {
          setOpenId(null)
          void list.refresh()
        }}
        returnFocusTo={opener}
      />

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{removing?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Its access key is deleted here. Nothing changes in Jivox: the agent and any contract there stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                if (removing) void remove(removing)
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function AgentRow({ agent, open, check, reading, onToggle, children }: { agent: Agent; open: boolean; check: CheckState | undefined; reading: boolean; onToggle: () => void; children: React.ReactNode }) {
  const summary = checkSummary(check?.status === 'ok' ? check.result : undefined)
  const mark = contractMark(agent.contract)
  const sub = [
    agent.brandstore,
    agent.accessKey ? `key ••${agent.accessKey.hint}` : 'no key',
    agent.jivox ? `read ${formatRelativeTime(agent.jivox.readAt)}` : agent.accessKey ? 'not read yet' : 'fields by hand',
  ].filter(Boolean)
  const shown = agent.fields.slice(0, 4)
  return (
    <li className={cn('border-t first:border-t-0', open && 'bg-muted/10')} data-agent={agent.id}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-5 py-3 text-left text-sm outline-none hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset @2xl:gap-y-0', COLS)}
      >
        <span className="col-start-1 row-start-1 min-w-0">
          <span className="block truncate font-medium">{agent.name}</span>
          <span className="block truncate text-xs text-muted-foreground" title={agent.mcpUrl ?? undefined}>
            {sub.join(' · ')}
            {agent.mcpUrl && <span className="hidden @5xl:inline"> · {mcpHost(agent.mcpUrl)}</span>}
          </span>
        </span>
        <span className="col-start-2 row-start-1 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 @2xl:col-start-4 @2xl:justify-start">
          {check?.status === 'loading' || reading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Checking" />
          ) : (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                summary.tone === 'ok' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
                summary.tone === 'fail' && 'bg-destructive/10 text-destructive',
                summary.tone === 'muted' && 'bg-muted text-muted-foreground',
              )}
            >
              {summary.text}
            </span>
          )}
          {mark && <OutOfDate mark={mark} className="hidden @2xl:inline" />}
          {open ? <ChevronDown className="size-4 text-muted-foreground @2xl:hidden" aria-hidden="true" /> : <ChevronRight className="size-4 text-muted-foreground @2xl:hidden" aria-hidden="true" />}
        </span>
        <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-1 @2xl:col-span-1 @2xl:col-start-2 @2xl:row-start-1">
          {/* Phone: on the fields line, so the name keeps its room */}
          {mark && <OutOfDate mark={mark} className="mr-1 @2xl:hidden" />}
          {shown.length ? shown.map((f) => <FieldChip key={f} name={f} />) : <span className="text-xs text-muted-foreground">No fields yet</span>}
          {agent.fields.length > shown.length && <span className="text-xs text-muted-foreground">+{agent.fields.length - shown.length}</span>}
        </span>
        <span className={cn('col-span-2 truncate text-xs @2xl:col-span-1 @2xl:col-start-3 @2xl:row-start-1 @2xl:text-sm', (!agent.token || agent.token.state !== 'active') && 'text-destructive')}>
          <span className="@2xl:hidden text-muted-foreground">Token: </span>
          {agent.token ? `${agent.token.name}${agent.token.state !== 'active' ? ` (${agent.token.state})` : ''}` : 'no token'}
        </span>
        <span className="hidden @2xl:col-start-5 @2xl:row-start-1 @2xl:block">
          {open ? <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />}
        </span>
      </button>
      {children}
    </li>
  )
}

// "Out of date" (5.6): the contract changed since it was last copied / downloaded; the reasons on hover.
function OutOfDate({ mark, className }: { mark: { text: string; title: string }; className?: string }) {
  return (
    <span className={cn('rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800 dark:text-amber-300', className)} title={mark.title} data-testid="out-of-date-chip">
      {mark.text}
    </span>
  )
}
