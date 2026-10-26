// Helpers for the Design tab (task 3.7). Pure functions, no React: suggestions (keys, columns,
// types) and the request form ⇄ request JSON conversion.
import type {
  ColumnInfo,
  DesignField,
  DesignInput,
  DesignState,
  ErrorDetail,
  FieldType,
  JsonValue,
  Literal,
  RequestTemplate,
} from './api-types'

export const FIELD_TYPES: FieldType[] = ['string', 'int', 'float', 'boolean', 'image', 'array', 'date']
export const TYPE_LABELS: Record<FieldType, string> = {
  string: 'Text',
  int: 'Whole number',
  float: 'Number',
  boolean: 'True / false',
  image: 'Image URL',
  array: 'List (| or ,)',
  date: 'Date',
}
// Popover triggers and selects that sit next to <Input>s look like them.
export const fieldControlClass =
  'flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg border border-input bg-transparent dark:bg-input/30 px-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20'
// Letters, numbers and _ only: Jivox reads a contract's key no other way (its BAD_DOCUMENT on qa3, 2026-10-12).
export const RESPONSE_KEY = /^[A-Za-z0-9_]{1,64}$/
export const CONTEXT_SOURCES = [
  { value: '_meta.openai/locale', label: 'Locale', example: 'en-US', defaultKey: 'locale' },
  { value: '_meta.openai/userLocation', label: 'User location', example: 'city, region, country', defaultKey: 'location' },
] as const

// ───────────────────────────── the draft ─────────────────────────────

// A field being edited: the saved shape + a stable id for React lists.
export type DraftField = DesignField & { uid: string }
export type Draft = { idKey: string; fields: DraftField[]; request: RequestTemplate }

let nextUid = 0
export const newUid = () => `f${++nextUid}`

export function draftFromState(state: DesignState): Draft {
  return {
    idKey: state.design.idField.responseKey,
    fields: state.design.fields.map((f) => ({ ...f, uid: newUid() })),
    request: state.design.request,
  }
}

// What the backend receives (and what "unsaved changes" compares).
export function toInput(draft: Draft): DesignInput & { request: RequestTemplate } {
  return {
    idField: { responseKey: draft.idKey },
    fields: draft.fields.map(({ uid: _uid, ...field }) => field),
    request: draft.request,
  }
}

export const sameDesign = (a: Draft, b: Draft) => JSON.stringify(toInput(a)) === JSON.stringify(toInput(b))

// ───────────────────────────── suggestions ─────────────────────────────

// "currentPrice", "Current Price", "current-price" → "currentprice" (compared to Jivox names).
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

// Our column whose name matches a Jivox column ("currentPrice" ↔ current_price); none = null.
// Only obvious matches: anything else is left for the user to pick (never a guess).
export function matchColumn(jivoxName: string, columns: string[]) {
  const target = normalize(jivoxName)
  return columns.find((column) => normalize(column) === target) ?? null
}

// A response key made from a name: "Product Title" → "Product_Title" (same rule as the backend).
export function suggestKey(name: string) {
  const key = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_]+/g, '_') // "sub-category" → "sub_category" (Jivox reads no "-")
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return key || 'field'
}

// `base`, or base_2, base_3… if taken (keys are unique ignoring case).
export function uniqueKey(base: string, taken: string[]) {
  const used = new Set(taken.map((key) => key.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 60)}_${n}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

// The type to pre-fill: the Jivox field's type if the data allows it, else the best fit
// (same rule as the backend's suggestType).
export function suggestType(info: ColumnInfo | undefined, jivoxHint: FieldType): FieldType {
  const candidates = info?.candidates ?? []
  if (candidates.length === 0 || candidates.includes(jivoxHint)) return jivoxHint
  return candidates[0]
}

// Share of the sampled non-empty values that fit a type (0–100), null when nothing to judge.
export function fitPercent(info: ColumnInfo | undefined, type: FieldType): number | null {
  if (!info || info.filled === 0) return null
  if (type === 'string') return 100
  const count = info.fits[type]
  if (typeof count !== 'number') return null
  return Math.round((count / info.filled) * 1000) / 10
}

// ───────────────────────────── problems ─────────────────────────────

// Problems answer with paths like "fields.2.sourceColumn" (preview: "design.fields.2…").
export const problemPath = (problem: ErrorDetail) => problem.field.replace(/^design\./, '')

export function problemsFor(problems: ErrorDetail[], prefix: string) {
  return problems.filter((p) => problemPath(p) === prefix || problemPath(p).startsWith(`${prefix}.`))
}

// ───────────────────── request: form ⇄ JSON (contract/1 template) ─────────────────────

export type LiteralEntry = { uid: string; key: string; value: Literal }
export type ContextEntry = { uid: string; key: string; source: string }

// GET ?ids={id}&market=US&locale={_meta.openai/locale}
export type GetForm = { idsParam: string; literals: LiteralEntry[]; context: ContextEntry[] }

// POST { "<rowsKey>": [ { "<idKey>": "{id}", <row…> } ], <extras: dotted paths> }
export type RowEntry =
  | { uid: string; key: string; kind: 'column'; column: string }
  | { uid: string; key: string; kind: 'context'; source: string }
  | { uid: string; key: string; kind: 'literal'; value: Literal }
export type ExtraEntry =
  | { uid: string; path: string; kind: 'context'; source: string }
  | { uid: string; path: string; kind: 'literal'; value: Literal }
export type PostForm = { rowsKey: string; idKey: string; row: RowEntry[]; extras: ExtraEntry[] }

const PLACEHOLDER = /^\{([^{}]+)\}$/
const placeholderOf = (value: unknown) => (typeof value === 'string' ? (PLACEHOLDER.exec(value)?.[1] ?? null) : null)
const isLiteral = (value: unknown): value is Literal =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
const isPlainObject = (value: unknown): value is Record<string, JsonValue> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// Same JSON ignoring key order (the form may list keys in its own order).
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

// The form for a GET template, or null if it has something the form can't show (edit as JSON).
export function getFormOf(request: RequestTemplate, idColumn: string): GetForm | null {
  const form: GetForm = { idsParam: '', literals: [], context: [] }
  for (const [key, value] of Object.entries(request.query ?? {})) {
    const name = placeholderOf(value)
    if (name === idColumn && !form.idsParam) form.idsParam = key
    else if (name && CONTEXT_SOURCES.some((c) => c.value === name)) form.context.push({ uid: newUid(), key, source: name })
    else if (name === null && isLiteral(value)) form.literals.push({ uid: newUid(), key, value })
    else return null // a second id, an unknown placeholder…
  }
  if (!form.idsParam) return null
  return canonical(buildGetQuery(form, idColumn)) === canonical(request.query ?? {}) ? form : null
}

export function buildGetQuery(form: GetForm, idColumn: string): Record<string, Literal> {
  const query: Record<string, Literal> = { [form.idsParam]: `{${idColumn}}` }
  for (const entry of form.literals) query[entry.key] = entry.value
  for (const entry of form.context) query[entry.key] = `{${entry.source}}`
  return query
}

// The form for a POST template, or null if the body needs the JSON editor.
export function postFormOf(request: RequestTemplate, idColumn: string): PostForm | null {
  const body = request.body
  if (!isPlainObject(body)) return null
  const form: PostForm = { rowsKey: '', idKey: '', row: [], extras: [] }
  for (const [key, value] of Object.entries(body)) {
    if (key.includes('.')) return null
    const rowObject = Array.isArray(value) && value.length === 1 && isPlainObject(value[0]) ? value[0] : null
    const idEntry = rowObject ? Object.entries(rowObject).find(([, v]) => placeholderOf(v) === idColumn) : undefined
    if (rowObject && idEntry && !form.rowsKey) {
      form.rowsKey = key
      form.idKey = idEntry[0]
      for (const [rowKey, rowValue] of Object.entries(rowObject)) {
        if (rowKey === form.idKey) continue
        const name = placeholderOf(rowValue)
        if (name?.startsWith('_meta.')) form.row.push({ uid: newUid(), key: rowKey, kind: 'context', source: name })
        else if (name) form.row.push({ uid: newUid(), key: rowKey, kind: 'column', column: name })
        else if (isLiteral(rowValue)) form.row.push({ uid: newUid(), key: rowKey, kind: 'literal', value: rowValue })
        else return null
      }
    } else if (!collectExtras(value, key, form.extras)) {
      return null
    }
  }
  if (!form.rowsKey) return null
  return canonical(buildPostBody(form, idColumn)) === canonical(body) ? form : null
}

function collectExtras(value: JsonValue, path: string, out: ExtraEntry[]): boolean {
  const name = placeholderOf(value)
  if (name?.startsWith('_meta.')) {
    out.push({ uid: newUid(), path, kind: 'context', source: name })
    return true
  }
  if (name === null && isLiteral(value)) {
    out.push({ uid: newUid(), path, kind: 'literal', value })
    return true
  }
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    return Object.entries(value).every(([k, v]) => !k.includes('.') && collectExtras(v, `${path}.${k}`, out))
  }
  return false // null, lists, {} or another placeholder: JSON editor
}

export function buildPostBody(form: PostForm, idColumn: string): JsonValue {
  const row: Record<string, JsonValue> = { [form.idKey]: `{${idColumn}}` }
  for (const entry of form.row) {
    row[entry.key] =
      entry.kind === 'column' ? `{${entry.column}}` : entry.kind === 'context' ? `{${entry.source}}` : entry.value
  }
  const body: Record<string, JsonValue> = { [form.rowsKey]: [row] }
  for (const extra of form.extras) {
    const parts = extra.path.split('.')
    let node = body
    for (const part of parts.slice(0, -1)) {
      if (!isPlainObject(node[part])) node[part] = {}
      node = node[part] as Record<string, JsonValue>
    }
    node[parts.at(-1)!] = extra.kind === 'context' ? `{${extra.source}}` : extra.value
  }
  return body
}

// Switching method: carry over what the other method can express.
export function postFromGet(form: GetForm | null, idColumn: string): RequestTemplate['body'] {
  const post: PostForm = {
    rowsKey: 'items',
    idKey: 'id',
    row: [],
    extras: [
      ...(form?.literals ?? []).map((l) => ({ uid: newUid(), path: l.key, kind: 'literal' as const, value: l.value })),
      ...(form?.context ?? []).map((c) => ({ uid: newUid(), path: c.key, kind: 'context' as const, source: c.source })),
    ],
  }
  return buildPostBody(post, idColumn)
}

// GET can't send per-row values: those are dropped (returned so the user is told).
export function getFromPost(form: PostForm | null, idColumn: string) {
  const get: GetForm = { idsParam: 'ids', literals: [], context: [] }
  const dropped: string[] = []
  const usedKeys = new Set(['ids'])
  const keyFor = (path: string) => uniqueKey(path.replace(/\./g, '_'), [...usedKeys])
  for (const extra of form?.extras ?? []) {
    const key = keyFor(extra.path)
    usedKeys.add(key)
    if (extra.kind === 'literal') get.literals.push({ uid: newUid(), key, value: extra.value })
    else get.context.push({ uid: newUid(), key, source: extra.source })
  }
  for (const entry of form?.row ?? []) {
    if (entry.kind === 'context' && !get.context.some((c) => c.source === entry.source)) {
      const key = keyFor(entry.key)
      usedKeys.add(key)
      get.context.push({ uid: newUid(), key, source: entry.source })
    } else if (entry.kind !== 'context') {
      dropped.push(entry.key)
    }
  }
  return { query: buildGetQuery(get, idColumn), dropped }
}

// A literal typed in the form: "12" stays text unless the user picked number / true-false.
export type LiteralKind = 'text' | 'number' | 'boolean'
export const literalKind = (value: Literal): LiteralKind =>
  typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text'
export function castLiteral(value: Literal, kind: LiteralKind): Literal {
  if (kind === 'boolean') return value === true || String(value).trim().toLowerCase() === 'true'
  if (kind === 'number') {
    const n = Number(value)
    return Number.isFinite(n) && String(value).trim() !== '' ? n : 0
  }
  return String(value)
}
