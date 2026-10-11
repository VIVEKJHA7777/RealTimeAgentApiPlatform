import { Braces, ListChecks, Plus, X, XCircle } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { SearchSelect } from '@/components/SearchSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ErrorDetail, FeedSchema, JsonValue, Literal, RequestTemplate } from '@/lib/api-types'
import {
  CONTEXT_SOURCES,
  type ExtraEntry,
  type GetForm,
  type LiteralKind,
  type PostForm,
  type RowEntry,
  buildGetQuery,
  buildPostBody,
  castLiteral,
  fieldControlClass,
  getFormOf,
  getFromPost,
  literalKind,
  newUid,
  postFormOf,
  postFromGet,
  problemPath,
  problemsFor,
  uniqueKey,
} from '@/lib/design'
import { cn } from '@/lib/utils'

type Props = {
  request: RequestTemplate
  onChange: (request: RequestTemplate) => void
  schema: FeedSchema
  problems: ErrorDetail[]
  // The JSON editor holds text that isn't valid JSON (the design can't be saved meanwhile).
  onJsonInvalid: (invalid: boolean) => void
}

const pretty = (request: RequestTemplate) => JSON.stringify(request, null, 2)

// "How Jivox calls it": GET / POST, as a form for the usual shapes, or as JSON for any shape
// (contract/1 request template, P3-14). The form and the JSON are two views of ONE request.
export function RequestEditor({ request, onChange, schema, problems, onJsonInvalid }: Props) {
  const idColumn = schema.idColumn
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [jsonText, setJsonText] = useState(() => pretty(request))
  const [jsonError, setJsonError] = useState<string | null>(null)
  // The request the forms were built from. When the request changes from OUTSIDE (discard,
  // reload, JSON editor), the forms are rebuilt; changes made in a form don't rebuild it
  // (so a half-typed duplicate name doesn't vanish).
  const [synced, setSynced] = useState<string | null>(null)
  const [getForm, setGetForm] = useState<GetForm | null>(null)
  const [postForm, setPostForm] = useState<PostForm | null>(null)
  // The other method's last request: switching GET → POST → GET restores it.
  const remembered = useRef<Partial<Record<'GET' | 'POST', RequestTemplate>>>({})

  // No jump when switching GET ⇄ POST or form ⇄ JSON (reported by the user): the views differ
  // in height, so the page got shorter / taller and the browser moved the scroll position
  // (80–140 px). The card keeps the tallest height it had (the page never shrinks under you),
  // and the clicked control is put back at the same place on the screen.
  const sectionRef = useRef<HTMLElement>(null)
  const methodRef = useRef<HTMLDivElement>(null)
  const jsonButtonRef = useRef<HTMLButtonElement>(null)
  const anchor = useRef<{ element: HTMLElement; top: number } | null>(null)
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined)
  function holdPosition(element: HTMLElement | null) {
    if (!element) return
    anchor.current = { element, top: element.getBoundingClientRect().top }
    setMinHeight((current) => Math.max(current ?? 0, sectionRef.current?.offsetHeight ?? 0))
  }
  useLayoutEffect(() => {
    if (!anchor.current) return
    const moved = anchor.current.element.getBoundingClientRect().top - anchor.current.top
    anchor.current = null
    if (Math.abs(moved) >= 1) window.scrollBy(0, moved)
  })

  const current = JSON.stringify(request)
  if (current !== synced) {
    setSynced(current)
    setGetForm(request.method === 'GET' ? getFormOf(request, idColumn) : null)
    setPostForm(request.method === 'POST' ? postFormOf(request, idColumn) : null)
    setJsonText(pretty(request))
  }
  const form = request.method === 'GET' ? getForm : postForm
  const showJson = mode === 'json' || form === null

  // A change made here: the forms already show it.
  function emit(next: RequestTemplate) {
    setSynced(JSON.stringify(next))
    onChange(next)
  }

  function updateGet(next: GetForm) {
    setGetForm(next)
    emit({ method: 'GET', query: buildGetQuery(next, idColumn), maxIdsPerCall: request.maxIdsPerCall })
  }
  function updatePost(next: PostForm) {
    setPostForm(next)
    emit({ method: 'POST', body: buildPostBody(next, idColumn), maxIdsPerCall: request.maxIdsPerCall })
  }

  function switchMethod(method: 'GET' | 'POST') {
    if (method === request.method) return
    holdPosition(methodRef.current)
    remembered.current[request.method] = request
    let next = remembered.current[method]
    if (!next && method === 'POST') {
      next = { method, body: postFromGet(getForm, idColumn), maxIdsPerCall: request.maxIdsPerCall }
    } else if (!next) {
      const { query, dropped } = getFromPost(postForm, idColumn)
      if (dropped.length > 0) {
        toast.info(`GET can't send per-row values, so these were left out: ${dropped.join(', ')}. Switch back to POST to get them back.`)
      }
      next = { method, query, maxIdsPerCall: request.maxIdsPerCall }
    }
    setJsonError(null)
    onJsonInvalid(false)
    onChange({ ...next, maxIdsPerCall: request.maxIdsPerCall }) // the forms rebuild from it
  }

  function onJsonChange(text: string) {
    setJsonText(text)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'Not valid JSON')
      onJsonInvalid(true)
      return
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setJsonError('The request must be a JSON object: { "method": …, "query" or "body": … }')
      onJsonInvalid(true)
      return
    }
    const value = parsed as Record<string, unknown>
    setJsonError(null)
    onJsonInvalid(false)
    // Sent as written: the backend checks it (problems show below). The forms are rebuilt
    // for later, but the text being typed is left alone (no re-formatting under the cursor).
    const next = {
      ...(value as object),
      method: value.method as RequestTemplate['method'],
      maxIdsPerCall: (value.maxIdsPerCall as number | undefined) ?? 100,
    } as RequestTemplate
    setSynced(JSON.stringify(next))
    setGetForm(next.method === 'GET' ? getFormOf(next, idColumn) : null)
    setPostForm(next.method === 'POST' ? postFormOf(next, idColumn) : null)
    onChange(next)
  }

  const requestProblems = problemsFor(problems, 'request')

  return (
    <section ref={sectionRef} style={{ minHeight }} aria-labelledby="request-heading" className="@container rounded-2xl border bg-background p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-full @md:basis-0">
          <h2 id="request-heading" className="font-semibold">
            How Jivox calls it
          </h2>
          <p className="text-sm text-muted-foreground">
            {request.method === 'GET' ? 'Ids in the URL, comma-separated' : 'Ids in a JSON body, one object per row'}
          </p>
        </div>
        <div ref={methodRef} role="radiogroup" aria-label="Method" className="flex rounded-lg border p-0.5">
          {(['GET', 'POST'] as const).map((method) => (
            <button
              key={method}
              type="button"
              role="radio"
              aria-checked={request.method === method}
              onClick={() => switchMethod(method)}
              disabled={jsonError !== null && request.method !== method}
              title={jsonError !== null && request.method !== method ? 'Fix the JSON first' : undefined}
              className={cn(
                'rounded-md px-3 py-1 font-mono text-xs font-medium transition-colors disabled:opacity-50',
                request.method === method ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {method}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={form === null || (mode === 'json' && jsonError !== null)}
          ref={jsonButtonRef}
          onClick={() => {
            holdPosition(jsonButtonRef.current)
            setMode(mode === 'json' ? 'form' : 'json')
            setJsonText(pretty(request))
          }}
        >
          {showJson ? <ListChecks /> : <Braces />}
          {showJson ? 'Edit as form' : 'Edit as JSON'}
        </Button>
      </div>

      <div className="mt-4 grid max-w-xs grid-cols-1 gap-1">
        <label htmlFor="max-ids" className="text-xs text-muted-foreground">
          Max ids per call (1–100)
        </label>
        <Input
          id="max-ids"
          type="number"
          min={1}
          max={100}
          value={Number.isFinite(request.maxIdsPerCall) ? request.maxIdsPerCall : ''}
          aria-invalid={problemsFor(problems, 'request.maxIdsPerCall').length > 0 || undefined}
          onChange={(e) => {
            const next = { ...request, maxIdsPerCall: e.target.value === '' ? Number.NaN : Number(e.target.value) }
            if (showJson) setJsonText(pretty(next))
            emit(next)
          }}
          className="w-28"
        />
        <p className="text-xs text-muted-foreground">Jivox splits bigger batches into several calls.</p>
      </div>

      <div className="mt-4">
        {showJson ? (
          <JsonEditor
            text={jsonText}
            error={jsonError}
            onChange={onJsonChange}
            note={form === null ? 'This request has a shape the form can’t show, so it’s edited as JSON.' : undefined}
          />
        ) : request.method === 'GET' && getForm ? (
          <GetFormView form={getForm} onChange={updateGet} />
        ) : postForm ? (
          <PostFormView form={postForm} onChange={updatePost} schema={schema} />
        ) : null}
      </div>

      {requestProblems.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1 rounded-xl border border-destructive/30 bg-destructive/5 p-3" aria-label="Request problems">
          {requestProblems.map((p, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-destructive">
              <XCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {problemPath(p) !== 'request' && (
                  <code className="mr-1 rounded bg-destructive/10 px-1">{problemPath(p).replace(/^request\./, '')}</code>
                )}
                {p.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function JsonEditor({
  text,
  error,
  onChange,
  note,
}: {
  text: string
  error: string | null
  onChange: (text: string) => void
  note?: string
}) {
  return (
    <div>
      {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
      <textarea
        aria-label="Request as JSON"
        value={text}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(24, Math.max(8, text.split('\n').length + 1))}
        aria-invalid={error !== null || undefined}
        className="w-full rounded-lg border border-input bg-muted/30 p-3 font-mono text-xs leading-5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
      {error ? (
        <p className="mt-1 text-xs text-destructive">Not valid JSON: {error}</p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          Placeholders: <code>{'{item_id}'}</code>-style id, <code>{'{column}'}</code> (POST, next to the id),{' '}
          <code>{'{_meta.openai/locale}'}</code>, <code>{'{_meta.openai/userLocation}'}</code>. Anything else is sent as written.
        </p>
      )}
    </div>
  )
}

// ───────────────────────────── shared bits ─────────────────────────────

const ENTRY_GRID = 'grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 @xl:grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,1.6fr)_2rem]'
const ENTRY_KIND = 'order-3 col-span-2 @xl:order-2 @xl:col-span-1'
const ENTRY_VALUE = 'order-4 col-span-2 min-w-0 @xl:order-3 @xl:col-span-1'
const ENTRY_REMOVE = 'order-2 @xl:order-4'

function duplicates(names: string[]) {
  const seen = new Map<string, number>()
  for (const name of names) seen.set(name, (seen.get(name) ?? 0) + 1)
  return new Set([...seen].filter(([name, count]) => count > 1 && name !== '').map(([name]) => name))
}

function LiteralInput({ value, onChange, label }: { value: Literal; onChange: (value: Literal) => void; label: string }) {
  const kind = literalKind(value)
  return (
    <div className="flex min-w-0 gap-1">
      {kind === 'boolean' ? (
        <select
          aria-label={label}
          value={String(value)}
          onChange={(e) => onChange(e.target.value === 'true')}
          className={cn(fieldControlClass, 'appearance-auto')}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <Input
          aria-label={label}
          type={kind === 'number' ? 'number' : 'text'}
          value={String(value)}
          onChange={(e) => onChange(kind === 'number' ? castLiteral(e.target.value, 'number') : e.target.value)}
          className="text-[13px]"
        />
      )}
      <select
        aria-label={`${label}: kind`}
        value={kind}
        onChange={(e) => onChange(castLiteral(value, e.target.value as LiteralKind))}
        className={cn(fieldControlClass, 'w-24 shrink-0 appearance-auto text-xs')}
      >
        <option value="text">text</option>
        <option value="number">number</option>
        <option value="boolean">true/false</option>
      </select>
    </div>
  )
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={onClick}>
      <X />
    </Button>
  )
}

function SubHeading({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-medium">{children}</h3>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

const DupNote = ({ show }: { show: boolean }) =>
  show ? <p className="order-5 col-span-full -mt-1 text-xs text-destructive">This name is used twice: only one would be sent.</p> : null

// ───────────────────────────── GET ─────────────────────────────

function GetFormView({ form, onChange }: { form: GetForm; onChange: (form: GetForm) => void }) {
  const dup = duplicates([form.idsParam, ...form.literals.map((l) => l.key), ...form.context.map((c) => c.key)])
  const allKeys = () => [form.idsParam, ...form.literals.map((l) => l.key), ...form.context.map((c) => c.key)]
  return (
    <div className="flex flex-col gap-5">
      <div className="grid max-w-sm grid-cols-1 gap-1">
        <label htmlFor="ids-param" className="text-xs text-muted-foreground">
          Ids parameter
        </label>
        <Input
          id="ids-param"
          value={form.idsParam}
          onChange={(e) => onChange({ ...form, idsParam: e.target.value })}
          aria-invalid={dup.has(form.idsParam) || undefined}
          className="font-mono text-[13px]"
        />
        <p className="text-xs text-muted-foreground">
          <code>?{form.idsParam || '…'}=ID-1,ID-2</code> (comma-separated)
        </p>
        <DupNote show={dup.has(form.idsParam)} />
      </div>

      <div>
        <SubHeading hint="Sent with every call, as written.">Fixed parameters</SubHeading>
        <div className="flex flex-col gap-2">
          {form.literals.map((entry, i) => (
            <div key={entry.uid} className={ENTRY_GRID}>
              <Input
                aria-label={`Parameter ${i + 1} name`}
                value={entry.key}
                placeholder="market"
                aria-invalid={dup.has(entry.key) || entry.key === '' || undefined}
                onChange={(e) =>
                  onChange({ ...form, literals: form.literals.map((l) => (l.uid === entry.uid ? { ...l, key: e.target.value } : l)) })
                }
                className="font-mono text-[13px]"
              />
              <span className={cn(ENTRY_KIND, 'hidden text-center text-muted-foreground @xl:block')}>=</span>
              <div className={ENTRY_VALUE}>
                <LiteralInput
                  label={`Parameter ${i + 1} value`}
                  value={entry.value}
                  onChange={(value) =>
                    onChange({ ...form, literals: form.literals.map((l) => (l.uid === entry.uid ? { ...l, value } : l)) })
                  }
                />
              </div>
              <div className={ENTRY_REMOVE}>
                <RemoveButton
                  label={`Remove parameter ${entry.key || i + 1}`}
                  onClick={() => onChange({ ...form, literals: form.literals.filter((l) => l.uid !== entry.uid) })}
                />
              </div>
              <DupNote show={dup.has(entry.key)} />
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 text-primary"
          onClick={() =>
            onChange({ ...form, literals: [...form.literals, { uid: newUid(), key: uniqueKey('param', allKeys()), value: '' }] })
          }
        >
          <Plus />
          Add parameter
        </Button>
      </div>

      <div>
        <SubHeading hint="Sent when the chat host has it (never in Jivox's verification call).">Chat context</SubHeading>
        <div className="flex flex-col gap-2">
          {CONTEXT_SOURCES.map((source) => {
            const entry = form.context.find((c) => c.source === source.value)
            return (
              <div key={source.value} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex w-36 items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={entry !== undefined}
                    onChange={(e) =>
                      onChange({
                        ...form,
                        context: e.target.checked
                          ? [...form.context, { uid: newUid(), key: uniqueKey(source.defaultKey, allKeys()), source: source.value }]
                          : form.context.filter((c) => c.source !== source.value),
                      })
                    }
                  />
                  {source.label}
                </label>
                {entry && (
                  <>
                    <span className="text-xs text-muted-foreground">as</span>
                    <Input
                      aria-label={`${source.label} parameter name`}
                      value={entry.key}
                      aria-invalid={dup.has(entry.key) || entry.key === '' || undefined}
                      onChange={(e) =>
                        onChange({ ...form, context: form.context.map((c) => (c.uid === entry.uid ? { ...c, key: e.target.value } : c)) })
                      }
                      className="w-40 font-mono text-[13px]"
                    />
                    <span className="text-xs text-muted-foreground">e.g. {source.example}</span>
                    <DupNote show={dup.has(entry.key)} />
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────── POST ─────────────────────────────

function PostFormView({ form, onChange, schema }: { form: PostForm; onChange: (form: PostForm) => void; schema: FeedSchema }) {
  const columns = schema.fields.filter((f) => f.name !== schema.idColumn)
  const rowDup = duplicates([form.idKey, ...form.row.map((r) => r.key)])
  const extraDup = duplicates([form.rowsKey, ...form.extras.map((x) => x.path)])
  const setRow = (uid: string, next: RowEntry) => onChange({ ...form, row: form.row.map((r) => (r.uid === uid ? next : r)) })
  const setExtra = (uid: string, next: ExtraEntry) => onChange({ ...form, extras: form.extras.map((x) => (x.uid === uid ? next : x)) })

  return (
    <div className="flex flex-col gap-5">
      <div className="grid max-w-md grid-cols-2 gap-3">
        <div className="grid gap-1">
          <label htmlFor="rows-key" className="text-xs text-muted-foreground">
            Rows list key
          </label>
          <Input
            id="rows-key"
            value={form.rowsKey}
            aria-invalid={extraDup.has(form.rowsKey) || form.rowsKey === '' || undefined}
            onChange={(e) => onChange({ ...form, rowsKey: e.target.value })}
            className="font-mono text-[13px]"
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor="id-key" className="text-xs text-muted-foreground">
            Id key in each row
          </label>
          <Input
            id="id-key"
            value={form.idKey}
            aria-invalid={rowDup.has(form.idKey) || form.idKey === '' || undefined}
            onChange={(e) => onChange({ ...form, idKey: e.target.value })}
            className="font-mono text-[13px]"
          />
        </div>
      </div>

      <div>
        <SubHeading hint="Inside each row object, next to the id. A Jivox column is filled by Jivox from its row.">
          Per-row values
        </SubHeading>
        <div className="flex flex-col gap-2">
          {form.row.map((entry, i) => (
            <div key={entry.uid} className={ENTRY_GRID}>
              <Input
                aria-label={`Row value ${i + 1} key`}
                value={entry.key}
                aria-invalid={rowDup.has(entry.key) || entry.key === '' || undefined}
                onChange={(e) => setRow(entry.uid, { ...entry, key: e.target.value })}
                className="font-mono text-[13px]"
              />
              <select
                aria-label={`Row value ${i + 1} kind`}
                value={entry.kind}
                onChange={(e) => {
                  const kind = e.target.value as RowEntry['kind']
                  setRow(
                    entry.uid,
                    kind === 'column'
                      ? { uid: entry.uid, key: entry.key, kind, column: columns[0]?.name ?? '' }
                      : kind === 'context'
                        ? { uid: entry.uid, key: entry.key, kind, source: CONTEXT_SOURCES[0].value }
                        : { uid: entry.uid, key: entry.key, kind, value: '' },
                  )
                }}
                className={cn(fieldControlClass, ENTRY_KIND, 'appearance-auto text-xs')}
              >
                <option value="column">Jivox column</option>
                <option value="context">Chat context</option>
                <option value="literal">Fixed value</option>
              </select>
              <div className={ENTRY_VALUE}>
                {entry.kind === 'column' ? (
                  <SearchSelect
                    label={`Row value ${i + 1} Jivox column`}
                    value={entry.column}
                    onChange={(column) => setRow(entry.uid, { ...entry, column })}
                    options={[
                      ...(columns.some((c) => c.name === entry.column)
                        ? []
                        : [{ value: entry.column, label: `{${entry.column}}`, hint: `not a ${schema.feedType} column` }]),
                      ...columns.map((c) => ({ value: c.name, label: `{${c.name}}` })),
                    ]}
                    className="font-mono text-[13px]"
                  />
                ) : entry.kind === 'context' ? (
                  <ContextSelect
                    label={`Row value ${i + 1} context`}
                    value={entry.source}
                    onChange={(source) => setRow(entry.uid, { ...entry, source })}
                  />
                ) : (
                  <LiteralInput
                    label={`Row value ${i + 1} value`}
                    value={entry.value}
                    onChange={(value) => setRow(entry.uid, { ...entry, value })}
                  />
                )}
              </div>
              <div className={ENTRY_REMOVE}>
                <RemoveButton
                  label={`Remove row value ${entry.key || i + 1}`}
                  onClick={() => onChange({ ...form, row: form.row.filter((r) => r.uid !== entry.uid) })}
                />
              </div>
              <DupNote show={rowDup.has(entry.key)} />
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 text-primary"
          onClick={() =>
            onChange({
              ...form,
              row: [
                ...form.row,
                {
                  uid: newUid(),
                  key: uniqueKey('value', [form.idKey, ...form.row.map((r) => r.key)]),
                  kind: 'column',
                  column: columns[0]?.name ?? '',
                },
              ],
            })
          }
        >
          <Plus />
          Add per-row value
        </Button>
      </div>

      <div>
        <SubHeading hint="Outside the rows, sent once per call. Use dots for nesting: context.locale">Fixed values and context</SubHeading>
        <div className="flex flex-col gap-2">
          {form.extras.map((entry, i) => (
            <div key={entry.uid} className={ENTRY_GRID}>
              <Input
                aria-label={`Body value ${i + 1} path`}
                value={entry.path}
                aria-invalid={extraDup.has(entry.path) || entry.path === '' || undefined}
                onChange={(e) => setExtra(entry.uid, { ...entry, path: e.target.value })}
                className="font-mono text-[13px]"
              />
              <select
                aria-label={`Body value ${i + 1} kind`}
                value={entry.kind}
                onChange={(e) =>
                  setExtra(
                    entry.uid,
                    e.target.value === 'context'
                      ? { uid: entry.uid, path: entry.path, kind: 'context', source: CONTEXT_SOURCES[0].value }
                      : { uid: entry.uid, path: entry.path, kind: 'literal', value: '' },
                  )
                }
                className={cn(fieldControlClass, ENTRY_KIND, 'appearance-auto text-xs')}
              >
                <option value="literal">Fixed value</option>
                <option value="context">Chat context</option>
              </select>
              <div className={ENTRY_VALUE}>
                {entry.kind === 'context' ? (
                  <ContextSelect
                    label={`Body value ${i + 1} context`}
                    value={entry.source}
                    onChange={(source) => setExtra(entry.uid, { ...entry, source })}
                  />
                ) : (
                  <LiteralInput
                    label={`Body value ${i + 1} value`}
                    value={entry.value}
                    onChange={(value) => setExtra(entry.uid, { ...entry, value })}
                  />
                )}
              </div>
              <div className={ENTRY_REMOVE}>
                <RemoveButton
                  label={`Remove body value ${entry.path || i + 1}`}
                  onClick={() => onChange({ ...form, extras: form.extras.filter((x) => x.uid !== entry.uid) })}
                />
              </div>
              <DupNote show={extraDup.has(entry.path)} />
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 text-primary"
          onClick={() =>
            onChange({
              ...form,
              extras: [
                ...form.extras,
                { uid: newUid(), path: uniqueKey('value', [form.rowsKey, ...form.extras.map((x) => x.path)]), kind: 'literal', value: '' },
              ],
            })
          }
        >
          <Plus />
          Add value
        </Button>
      </div>

      <div>
        <p className="mb-1 text-xs text-muted-foreground">The body template</p>
        <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-5">
          {JSON.stringify(bodyPreview(form, schema.idColumn), null, 2)}
        </pre>
      </div>
    </div>
  )
}

const bodyPreview = (form: PostForm, idColumn: string): JsonValue => buildPostBody(form, idColumn)

function ContextSelect({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(fieldControlClass, 'appearance-auto font-mono text-xs')}
    >
      {CONTEXT_SOURCES.map((s) => (
        <option key={s.value} value={s.value}>{`{${s.value}}`}</option>
      ))}
    </select>
  )
}
