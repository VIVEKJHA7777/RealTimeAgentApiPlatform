// Pure helpers for the Jivox tab (task 5.5): the agent form (validation, what to send), sample ids,
// the checklist's groups and fix links. No React here (tested by
// docs/test-scripts/phase-05-task-5.5-agents-lib.test.ts).
import type { Agent, AgentCheck, AgentInput, ContractCheck, FixPlace, ContractState } from './api-types'

export const AGENT_NAME_MAX = 60
export const MAX_SAMPLE_IDS = 10

// What the add / edit dialog holds. accessKey '' = keep the saved one (or none); removeKey = drop it.
export type AgentForm = {
  name: string
  brandstore: string
  mcpUrl: string
  accessKey: string
  removeKey: boolean
  tokenId: string // '' = none
  fields: string[]
  sampleIdsText: string
}

export function formFromAgent(agent: Agent | null): AgentForm {
  return {
    name: agent?.name ?? '',
    brandstore: agent?.brandstore ?? '',
    mcpUrl: agent?.mcpUrl ?? '',
    accessKey: '',
    removeKey: false,
    tokenId: agent?.token && agent.token.state !== 'revoked' ? agent.token.id : '',
    fields: agent?.fields ?? [],
    sampleIdsText: (agent?.sampleIds ?? []).join(', '),
  }
}

// "SKU-1, SKU-2" / one per line → ["SKU-1", "SKU-2"] (trimmed, empty dropped, each once).
export function parseSampleIds(text: string): { ids: string[] } | { error: string } {
  const ids = [...new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))]
  if (ids.length > MAX_SAMPLE_IDS) return { error: `At most ${MAX_SAMPLE_IDS} sample ids` }
  if (ids.some((id) => id.length > 500)) return { error: 'A sample id can be at most 500 characters' }
  return { ids }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
// Same rules as the server: https (http only for localhost), no user:password@.
export function mcpUrlProblem(url: string): string | null {
  if (!url.trim()) return null
  try {
    const u = new URL(url.trim())
    if (u.username || u.password) return 'Use the https:// MCP destination shown in Studio'
    if (u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname))) return null
  } catch {
    // fall through
  }
  return 'Use the https:// MCP destination shown in Studio'
}

export function validateAgentForm(form: AgentForm): Record<string, string> {
  const errors: Record<string, string> = {}
  const name = form.name.trim()
  if (!name) errors.name = 'Name is required'
  else if (name.length > AGENT_NAME_MAX) errors.name = `Name can be at most ${AGENT_NAME_MAX} characters`
  if (form.brandstore.trim().length > 100) errors.brandstore = 'Brandstore can be at most 100 characters'
  const urlProblem = mcpUrlProblem(form.mcpUrl)
  if (urlProblem) errors.mcpUrl = urlProblem
  const key = form.accessKey.trim()
  if (key && key.length < 8) errors.accessKey = 'That access key looks too short: copy it again from Studio'
  else if (key && /\s/.test(key)) errors.accessKey = 'An access key has no spaces'
  const ids = parseSampleIds(form.sampleIdsText)
  if ('error' in ids) errors.sampleIds = ids.error
  return errors
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

// What to send: everything for a new agent; for an edit ONLY what changed (so two people editing
// different things don't undo each other). The access key is sent only when typed or removed.
export function agentInput(form: AgentForm, original: Agent | null): AgentInput {
  const sampleIds = (parseSampleIds(form.sampleIdsText) as { ids: string[] }).ids ?? []
  const next = {
    name: form.name.trim(),
    brandstore: form.brandstore.trim() || null,
    mcpUrl: form.mcpUrl.trim() || null,
    tokenId: form.tokenId || null,
    fields: form.fields,
    sampleIds,
  }
  const key = form.accessKey.trim()
  if (!original) return { ...next, ...(key ? { accessKey: key } : {}) }
  const out: AgentInput = {}
  if (next.name !== original.name) out.name = next.name
  if (next.brandstore !== original.brandstore) out.brandstore = next.brandstore
  if (next.mcpUrl !== original.mcpUrl) out.mcpUrl = next.mcpUrl
  const originalToken = original.token && original.token.state !== 'revoked' ? original.token.id : null
  if (next.tokenId !== originalToken) out.tokenId = next.tokenId
  if (!sameList(next.fields, original.fields)) out.fields = next.fields
  if (!sameList(next.sampleIds, original.sampleIds)) out.sampleIds = next.sampleIds
  if (key) out.accessKey = key
  else if (form.removeKey && original.accessKey) out.accessKey = null
  return out
}

// A new MCP URL or key makes the server forget what Jivox told us: read again after saving.
export const shouldReadAfterSave = (input: AgentInput, saved: Agent) =>
  Boolean(saved.mcpUrl && saved.accessKey?.readable && (input.mcpUrl !== undefined || typeof input.accessKey === 'string'))

// ── Checklist ──
export const CHECK_GROUPS: { id: ContractCheck['group']; label: string }[] = [
  { id: 'agent', label: 'Jivox agent' },
  { id: 'contract', label: 'Contract' },
  { id: 'token', label: 'Token' },
  { id: 'live', label: 'Live call (like Jivox’s verification)' },
]

export function groupChecks(checks: ContractCheck[]) {
  return CHECK_GROUPS.map((g) => ({ ...g, checks: checks.filter((c) => c.group === g.id) })).filter((g) => g.checks.length > 0)
}

// The table's "Contract" cell: ready · N to fix · not checked yet.
export function checkSummary(result: AgentCheck | undefined): { text: string; tone: 'ok' | 'fail' | 'muted'; warnings: number } {
  if (!result) return { text: 'Not checked', tone: 'muted', warnings: 0 }
  const fails = result.checks.filter((c) => c.status === 'fail').length
  const warnings = result.checks.filter((c) => c.status === 'warn').length
  return fails === 0 ? { text: 'Ready', tone: 'ok', warnings } : { text: `${fails} to fix`, tone: 'fail', warnings }
}

// Where a fix happens: a tab of this API, the agent's own Edit dialog, or outside (text only).
export function fixTarget(place: FixPlace, apiBase: string): { to: string } | { action: 'edit' | 'read' } | null {
  switch (place) {
    case 'design':
      return { to: `${apiBase}/design` }
    case 'tokens':
      return { to: `${apiBase}/test` }
    case 'publish':
      return { to: apiBase }
    case 'data':
      return { to: `${apiBase}/data` }
    case 'agent':
      return { action: 'edit' }
    default:
      return null // studio / settings: done outside this app (the text says how)
  }
}

// "brandstore-data-mcp.qa3.jivox.com"
export function mcpHost(url: string | null) {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// Fields one can pick by hand: the Jivox fields the design answers, minus the id and mandatory ones
// (Jivox refuses both). Agent fields not in that list (e.g. from Jivox) stay visible too.
export function pickableFields(designColumns: string[], idColumn: string, mandatory: Set<string>, current: string[]) {
  const fromDesign = designColumns.filter((c) => c !== idColumn && !mandatory.has(c))
  return [...fromDesign, ...current.filter((c) => !fromDesign.includes(c))]
}

// ── 5.6: the contract last copied / downloaded vs today's ──
const HOW: Record<'copy' | 'download' | 'submit', string> = { copy: 'Copied', download: 'Downloaded', submit: 'Submitted' }

// The list's chip: only when it matters (out of date). Up to date / never taken → nothing.
export function contractMark(state: ContractState | undefined): { text: string; title: string } | null {
  if (!state?.last || state.outOfDate !== true) return null
  return { text: 'Out of date', title: `Changed since it was ${HOW[state.last.how].toLowerCase()}: ${state.changes.join('; ')}` }
}

// "Copied 5 min ago (design v5)"
export function lastTakenText(last: NonNullable<ContractState['last']>, relative: (iso: string) => string) {
  return `${HOW[last.how]} ${relative(last.at)} (design v${last.designVersion})`
}
