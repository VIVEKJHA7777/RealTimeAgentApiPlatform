import { Loader2 } from 'lucide-react'
import { useId, useState, type FormEvent, type RefObject } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { agentInput, formFromAgent, pickableFields, shouldReadAfterSave, validateAgentForm, type AgentForm } from '@/lib/agents'
import { agentsApi, ApiError, designApi, fieldErrorsOf, jivoxApi } from '@/lib/api'
import type { Agent, TokenInfo } from '@/lib/api-types'
import { useRequest } from '@/lib/use-request'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  brandSlug: string
  apiSlug: string
  feedType: string
  agent: Agent | null // null = add
  tokens: TokenInfo[]
  onSaved: (agent: Agent, readJivox: boolean) => void
  onGone: () => void // the agent was removed meanwhile (another tab)
  returnFocusTo?: RefObject<HTMLElement | null>
}

// Add / edit a Real Time Agent (task 5.5). The access key is write-only: an empty box keeps the
// saved one. With an MCP destination + key, the fields come from Jivox ("Read from Jivox" runs
// right after saving); without, they're picked from the fields this API's design answers.
export function AgentDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="max-h-[90svh] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          if (props.returnFocusTo?.current?.isConnected) {
            event.preventDefault()
            props.returnFocusTo.current.focus()
          }
        }}
      >
        {props.open && <AgentFormBody {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function AgentFormBody({ onOpenChange, brandSlug, apiSlug, feedType, agent, tokens, onSaved, onGone }: Props) {
  const id = useId()
  const [form, setForm] = useState<AgentForm>(() => formFromAgent(agent))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<AgentForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch) && !(k === 'sampleIds' && 'sampleIdsText' in patch))))
  }
  const fromJivox = Boolean(agent?.jivox)
  const usableTokens = tokens.filter((t) => t.state !== 'revoked')
  const willRead = Boolean(form.mcpUrl.trim() && (form.accessKey.trim() || (agent?.accessKey?.readable && !form.removeKey)))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const problems = validateAgentForm(form)
    setErrors(problems)
    if (Object.keys(problems).length > 0) return
    const input = agentInput(form, agent)
    if (agent && Object.keys(input).length === 0) return onOpenChange(false) // nothing changed
    setSaving(true)
    try {
      const { agent: saved } = agent
        ? await agentsApi.update(brandSlug, apiSlug, agent.id, input)
        : await agentsApi.create(brandSlug, apiSlug, { ...input, name: form.name.trim() })
      onOpenChange(false)
      onSaved(saved, agent ? shouldReadAfterSave(input, saved) : Boolean(saved.mcpUrl && saved.accessKey))
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      if (err.code === 'AGENT_NOT_FOUND' || err.code === 'API_NOT_FOUND') {
        toast.error('This agent was removed meanwhile (another tab?)')
        onOpenChange(false)
        return onGone()
      }
      const byField = fieldErrorsOf(err)
      const mapped: Record<string, string> = {}
      for (const [field, message] of Object.entries(byField)) {
        const key = field.startsWith('fields') ? 'fields' : field.startsWith('sampleIds') ? 'sampleIds' : field
        mapped[key] ??= message
      }
      if (err.code === 'AGENT_NAME_TAKEN') mapped.name = 'Another agent of this API has this name'
      if (Object.keys(mapped).length > 0) setErrors(mapped)
      else toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{agent ? `Edit ${agent.name}` : 'Add agent'}</DialogTitle>
        <DialogDescription>
          A Real Time Agent from Jivox Studio (Real-time data). Its contract lists only its own fields; every agent uses this API's address.
        </DialogDescription>
      </DialogHeader>

      <FormField id={`${id}-name`} label="Name" error={errors.name} hint="As you call it in Studio, e.g. “axas · Real Time Agent 1”.">
        {(p) => <Input {...p} value={form.name} maxLength={80} autoFocus={!agent} onChange={(e) => set({ name: e.target.value })} />}
      </FormField>
      <FormField id={`${id}-brandstore`} label="Brandstore (optional)" error={errors.brandstore}>
        {(p) => <Input {...p} value={form.brandstore} placeholder="axas-c63e9" onChange={(e) => set({ brandstore: e.target.value })} />}
      </FormField>
      <FormField id={`${id}-mcp`} label="MCP destination" error={errors.mcpUrl} hint="Studio → Real-time data → the agent → access keys.">
        {(p) => (
          <Input
            {...p}
            value={form.mcpUrl}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://brandstore-data-mcp.qa3.jivox.com/mcp"
            className="font-mono text-[13px]"
            onChange={(e) => set({ mcpUrl: e.target.value })}
          />
        )}
      </FormField>
      <FormField
        id={`${id}-key`}
        label="Access key"
        error={errors.accessKey}
        hint={
          agent?.accessKey && !form.removeKey
            ? `Saved (ends in ${agent.accessKey.hint})${agent.accessKey.readable ? '' : ", but it can't be read any more: paste it again"}. Paste a new one to replace it.`
            : 'Saved encrypted and never shown again.'
        }
      >
        {(p) => (
          <div className="flex gap-2">
            <Input
              {...p}
              type="password"
              value={form.accessKey}
              autoComplete="off"
              spellCheck={false}
              disabled={form.removeKey}
              placeholder={agent?.accessKey && !form.removeKey ? `••••••${agent.accessKey.hint}` : 'Paste the access key'}
              className="font-mono text-[13px]"
              onChange={(e) => set({ accessKey: e.target.value })}
            />
            {agent?.accessKey && (
              <Button type="button" variant="outline" onClick={() => set({ removeKey: !form.removeKey, accessKey: '' })} aria-pressed={form.removeKey}>
                {form.removeKey ? 'Keep' : 'Remove'}
              </Button>
            )}
          </div>
        )}
      </FormField>

      <FormField
        id={`${id}-token`}
        label="Token Jivox uses for this agent"
        error={errors.tokenId}
        hint={usableTokens.length ? 'The one you paste in Studio for this agent (Agent access token). One token per agent is best.' : undefined}
      >
        {(p) => (
          <>
            <select
              {...p}
              value={form.tokenId}
              onChange={(e) => set({ tokenId: e.target.value })}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30 dark:[color-scheme:dark]"
            >
              <option value="">No token yet</option>
              {usableTokens.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.hint}…){t.state === 'expired' ? ' · expired' : ''}
                </option>
              ))}
            </select>
            {usableTokens.length === 0 && (
              <p className="text-xs text-muted-foreground">
                This API has no tokens.{' '}
                <Link to={`/brands/${brandSlug}/apis/${apiSlug}/test`} className="font-medium text-primary hover:underline">
                  Make one on the Test tab
                </Link>
                .
              </p>
            )}
          </>
        )}
      </FormField>

      <FieldsPicker
        brandSlug={brandSlug}
        apiSlug={apiSlug}
        feedType={feedType}
        fromJivox={fromJivox}
        willRead={willRead}
        fields={form.fields}
        error={errors.fields}
        onChange={(fields) => set({ fields })}
      />

      <FormField id={`${id}-samples`} label="Sample ids (optional)" error={errors.sampleIds} hint="Real ids from your data, sent to verify the contract. Empty = the first 2 rows.">
        {(p) => <Input {...p} value={form.sampleIdsText} placeholder="SKU-1001, SKU-1002" spellCheck={false} className="font-mono text-[13px]" onChange={(e) => set({ sampleIdsText: e.target.value })} />}
      </FormField>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {willRead && (!agent || form.accessKey.trim() || form.mcpUrl.trim() !== (agent.mcpUrl ?? '')) ? 'Save and read from Jivox' : agent ? 'Save' : 'Add agent'}
        </Button>
      </DialogFooter>
    </form>
  )
}

// The agent's fields. From Jivox: shown, not edited (Studio decides). Otherwise: pick from the
// fields this API's design answers (never the id or a mandatory field: Jivox refuses those).
function FieldsPicker(props: {
  brandSlug: string
  apiSlug: string
  feedType: string
  fromJivox: boolean
  willRead: boolean
  fields: string[]
  error?: string
  onChange: (fields: string[]) => void
}) {
  const { brandSlug, apiSlug, feedType, fromJivox, willRead, fields, error, onChange } = props
  const design = useRequest(`design:${brandSlug}/${apiSlug}`, () => designApi.get(brandSlug, apiSlug))
  const schema = useRequest(`feed-schema:${feedType}`, () => jivoxApi.feedSchema(feedType))
  const groupId = useId()

  if (fromJivox) {
    return (
      <div className="grid gap-2">
        <span className="text-sm font-medium">Fields</span>
        <div className="flex flex-wrap gap-1.5">
          {fields.length ? fields.map((f) => <FieldChip key={f} name={f} />) : <span className="text-sm text-muted-foreground">None bound in Studio</span>}
        </div>
        <p className="text-xs text-muted-foreground">From Jivox (what you selected in Studio). Use “Read from Jivox” after changing them there.</p>
      </div>
    )
  }
  const mandatory = new Set((schema.data?.feedSchema.fields ?? []).filter((f) => f.tier === 'mandatory').map((f) => f.name))
  const idColumn = schema.data?.feedSchema.idColumn ?? 'item_id'
  const designColumns = design.data?.design.fields.map((f) => f.jivoxColumn) ?? []
  const options = pickableFields(designColumns, idColumn, mandatory, fields)
  const toggle = (name: string) => onChange(fields.includes(name) ? fields.filter((f) => f !== name) : [...fields, name])
  return (
    <fieldset className="grid gap-2" aria-describedby={`${groupId}-hint`}>
      <legend className="mb-2 text-sm font-medium">Fields</legend>
      {design.loading || schema.loading ? (
        <p className="text-sm text-muted-foreground">Loading the design…</p>
      ) : options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The design answers no field an agent can take yet.{' '}
          <Link to={`/brands/${brandSlug}/apis/${apiSlug}/design`} className="font-medium text-primary hover:underline">
            Open the Design tab
          </Link>
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map((name) => (
            <label
              key={name}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
            >
              <input type="checkbox" className="size-3.5 accent-primary" checked={fields.includes(name)} onChange={() => toggle(name)} />
              {name}
            </label>
          ))}
        </div>
      )}
      <p id={`${groupId}-hint`} className={error ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'}>
        {error ?? (willRead ? 'Jivox will replace these with the fields bound in Studio when it is read.' : 'Pick the ones you selected for this agent in Studio, or add the access key to read them from Jivox.')}
      </p>
    </fieldset>
  )
}

export function FieldChip({ name, muted }: { name: string; muted?: boolean }) {
  return <span className={muted ? 'rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground' : 'rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary'}>{name}</span>
}
