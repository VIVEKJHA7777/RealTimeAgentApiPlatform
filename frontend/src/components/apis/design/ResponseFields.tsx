import { AlertCircle, ArrowDown, ArrowUp, Bot, Info, Lock, MoreHorizontal, Plus, Trash2, Wand2, XCircle } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { ColumnInfo, ErrorDetail, FeedSchema, FieldType, JivoxField, ValueCheck } from '@/lib/api-types'
import { type Draft, type DraftField, matchColumn, problemsFor, suggestKey, suggestType, uniqueKey, newUid } from '@/lib/design'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ColumnSelect, JivoxFieldButton, JivoxFieldPicker, TierBadge, TypePicker } from './field-controls'

type Props = {
  draft: Draft
  onChange: (draft: Draft) => void
  schema: FeedSchema
  columns: string[] // the data's columns, file order
  info: Map<string, ColumnInfo>
  idColumn: string
  problems: ErrorDetail[]
  checkFor: (column: string, type: FieldType) => (ValueCheck & { rows: number }) | null
  agentUse?: Map<string, string[]> // 5.6: Jivox field → names of the agents whose contract uses it
}

// The grid shared by the header row and the field rows (desktop / wide container).
const ROW_GRID = 'grid grid-cols-[minmax(0,1.75fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_2rem] items-start gap-2'

// "Response fields": the id (fixed, first) + the chosen Jivox fields. Rows on wide screens,
// cards that open a bottom sheet on phones (container query, so the preview column counts).
export function ResponseFields({ draft, onChange, schema, columns, info, idColumn, problems, checkFor, agentUse }: Props) {
  const [editing, setEditing] = useState<string | null>(null) // uid of the field open in the sheet
  const addRef = useRef<HTMLButtonElement>(null)
  // After a remove, focus goes to the row that took its place (or "Add field"), not to <body>.
  const focusRowAfterRemove = (index: number) =>
    (document.querySelector<HTMLElement>(`[aria-label^="Jivox field of field ${index + 1}:"]`) ?? addRef.current)?.focus()
  const byName = new Map(schema.fields.map((f) => [f.name, f]))
  const choosable = schema.fields.filter((f) => f.name !== schema.idColumn)
  const used = new Set(draft.fields.map((f) => f.jivoxColumn))
  const keys = () => [draft.idKey, ...draft.fields.map((f) => f.responseKey)]

  const setFields = (fields: DraftField[]) => onChange({ ...draft, fields })
  const update = (uid: string, patch: Partial<DraftField>) =>
    setFields(draft.fields.map((f) => (f.uid === uid ? { ...f, ...patch } : f)))

  // A new field from a Jivox column: our column by name match (or empty), key, detected type.
  function fieldFor(jivox: JivoxField, takenKeys: string[]): DraftField {
    const column = matchColumn(jivox.name, columns)
    return {
      uid: newUid(),
      jivoxColumn: jivox.name,
      sourceColumn: column ?? '',
      responseKey: uniqueKey(suggestKey(column ?? jivox.name), takenKeys),
      type: suggestType(column ? info.get(column) : undefined, jivox.typeHint),
      typeInContract: true,
      default: '',
      onMismatch: 'send',
      onEmpty: 'empty_string',
    }
  }

  function add(jivox: JivoxField) {
    setFields([...draft.fields, fieldFor(jivox, keys())])
  }

  // Auto-map (R6): every Jivox field whose name matches one of our columns, not used yet.
  const matches = choosable.filter((f) => !used.has(f.name) && matchColumn(f.name, columns) !== null)
  function autoMap() {
    const taken = keys()
    const added = matches.map((jivox) => {
      const field = fieldFor(jivox, taken)
      taken.push(field.responseKey)
      return field
    })
    setFields([...draft.fields, ...added])
  }

  // Changing the column re-suggests the key and type, unless the user changed them by hand.
  function changeColumn(field: DraftField, column: string) {
    const jivox = byName.get(field.jivoxColumn)
    const hint = jivox?.typeHint ?? 'string'
    const autoKey = field.responseKey === suggestKey(field.sourceColumn || field.jivoxColumn) || field.responseKey === ''
    const autoType = field.type === suggestType(info.get(field.sourceColumn), hint)
    const otherKeys = keys().filter((k) => k !== field.responseKey)
    update(field.uid, {
      sourceColumn: column,
      ...(autoKey && column && { responseKey: uniqueKey(suggestKey(column), otherKeys) }),
      ...(autoType && { type: suggestType(info.get(column), hint) }),
    })
  }

  // Picking another Jivox field for a row: an empty column gets the name match.
  function changeJivox(field: DraftField, jivox: JivoxField) {
    if (field.sourceColumn) {
      const info_ = info.get(field.sourceColumn)
      const oldHint = byName.get(field.jivoxColumn)?.typeHint ?? 'string'
      const autoType = field.type === suggestType(info_, oldHint)
      return update(field.uid, { jivoxColumn: jivox.name, ...(autoType && { type: suggestType(info_, jivox.typeHint) }) })
    }
    const fresh = fieldFor(jivox, keys().filter((k) => k !== field.responseKey))
    update(field.uid, { ...fresh, uid: field.uid })
  }

  function move(uid: string, step: -1 | 1) {
    const index = draft.fields.findIndex((f) => f.uid === uid)
    const target = index + step
    if (target < 0 || target >= draft.fields.length) return
    const fields = [...draft.fields]
    ;[fields[index], fields[target]] = [fields[target], fields[index]]
    setFields(fields)
  }

  const remove = (uid: string) => setFields(draft.fields.filter((f) => f.uid !== uid))
  const missingMandatory = choosable.filter((f) => f.tier === 'mandatory' && !used.has(f.name))
  const idProblems = problemsFor(problems, 'idField')
  const editingField = draft.fields.find((f) => f.uid === editing)

  const rowProps = (field: DraftField, index: number): FieldEditorProps => ({
    field,
    index,
    jivox: byName.get(field.jivoxColumn),
    choosable,
    used,
    columns,
    info,
    problems: problemsFor(problems, `fields.${index}`),
    check: field.sourceColumn && columns.includes(field.sourceColumn) ? checkFor(field.sourceColumn, field.type) : null,
    // The best type for this column's values (for "Send as … instead")
    suggested: suggestType(info.get(field.sourceColumn), byName.get(field.jivoxColumn)?.typeHint ?? 'string'),
    onUpdate: (patch) => update(field.uid, patch),
    onColumn: (column) => changeColumn(field, column),
    onJivox: (jivox) => changeJivox(field, jivox),
    agentNames: agentUse?.get(field.jivoxColumn) ?? [],
  })

  return (
    <section aria-labelledby="response-heading" className="@container rounded-2xl border bg-background p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 id="response-heading" className="font-semibold">
            Response fields
          </h2>
          <p className="text-sm text-muted-foreground">
            {draft.fields.length} of {choosable.length} Jivox {schema.feedType} fields · the id is always sent first
          </p>
        </div>
        {matches.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={autoMap} title={matches.map((m) => m.name).join(', ')}>
            <Wand2 />
            Auto-map {matches.length} {matches.length === 1 ? 'match' : 'matches'}
          </Button>
        )}
        <JivoxFieldPicker fields={choosable} used={used} columns={columns} onPick={add} align="end">
          <Button ref={addRef} type="button" size="sm">
            <Plus />
            Add field
          </Button>
        </JivoxFieldPicker>
      </div>

      {/* ── wide: rows ── */}
      <div className="mt-4 hidden @2xl:block">
        <div className={cn(ROW_GRID, 'px-1 pb-1 text-xs text-muted-foreground')} aria-hidden="true">
          <span>Jivox field</span>
          <span>From your column</span>
          <span>Response key</span>
          <span>Type</span>
          <span>Default</span>
          <span />
        </div>
        <div className={cn(ROW_GRID, 'rounded-xl bg-muted/50 p-1')}>
          <div className="flex h-8 items-center gap-1.5 px-2 text-sm">
            <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Fixed" />
            <span className="truncate font-mono text-[13px]">{schema.idColumn}</span>
            <TierBadge tier="id" />
          </div>
          <div className="flex h-8 min-w-0 items-center gap-1.5 px-2 text-sm">
            <span className="truncate font-mono text-[13px]">{idColumn}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">id column</span>
          </div>
          <IdKeyInput draft={draft} onChange={onChange} problems={idProblems} />
          <div className="flex h-8 items-center px-2 font-mono text-[13px] text-muted-foreground">string</div>
          <div className="flex h-8 items-center px-2 text-xs text-muted-foreground">always sent</div>
          <span />
        </div>
        {draft.fields.length === 0 && <EmptyFields />}
        <ul className="mt-1 flex flex-col">
          {draft.fields.map((field, index) => (
            <li key={field.uid} className="border-t py-1.5 first:border-t-0">
              <FieldRow
                {...rowProps(field, index)}
                isFirst={index === 0}
                isLast={index === draft.fields.length - 1}
                onMove={(step) => move(field.uid, step)}
                onRemove={() => remove(field.uid)}
                onAfterRemove={() => focusRowAfterRemove(index)}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* ── narrow (phone): cards → bottom sheet ── */}
      <div className="mt-4 flex flex-col gap-2 @2xl:hidden">
        <div className="rounded-xl border bg-muted/50 p-3">
          <div className="flex items-center gap-2 text-sm">
            <Lock className="size-3.5 text-muted-foreground" aria-label="Fixed" />
            <span className="font-mono text-[13px]">{schema.idColumn}</span>
            <TierBadge tier="id" />
            <span className="ml-auto truncate text-xs text-muted-foreground">from {idColumn}</span>
          </div>
          <div className="mt-2">
            <IdKeyInput draft={draft} onChange={onChange} problems={idProblems} withLabel />
          </div>
        </div>
        {draft.fields.length === 0 && <EmptyFields />}
        {draft.fields.map((field, index) => {
          const props = rowProps(field, index)
          return (
            <button
              key={field.uid}
              type="button"
              onClick={() => setEditing(field.uid)}
              className={cn(
                'rounded-xl border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                props.problems.length > 0 && 'border-destructive/50',
              )}
            >
              <span className="flex items-center gap-2">
                <span className="truncate font-mono text-[13px]">{field.jivoxColumn}</span>
                {props.jivox && <TierBadge tier={props.jivox.tier} />}
                <MoreHorizontal className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                ← {field.sourceColumn || 'no column'} · key {field.responseKey || '—'} · {field.type}
                {!field.typeInContract && ' (not in contract)'}
                {field.default && ` · default ${field.default}`}
              </span>
              <AgentUse names={props.agentNames} compact />
              <FieldNotes problems={props.problems} check={props.check} field={field} suggested={props.suggested} compact />
            </button>
          )
        })}
      </div>

      {missingMandatory.length > 0 && (
        <p className="mt-4 flex gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Jivox marks {missingMandatory.length === 1 ? 'this' : 'these'} {schema.feedType} {missingMandatory.length === 1 ? 'field' : 'fields'} as
            mandatory: <span className="font-mono">{missingMandatory.map((f) => f.name).join(', ')}</span>. That's fine if the agent
            gets {missingMandatory.length === 1 ? 'it' : 'them'} from the uploaded feed.
          </span>
        </p>
      )}

      <Sheet open={editingField !== undefined} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl">
          {editingField && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono">{editingField.jivoxColumn}</SheetTitle>
                <SheetDescription>{byName.get(editingField.jivoxColumn)?.description ?? 'Not a field of this feed type.'}</SheetDescription>
              </SheetHeader>
              <div className="px-4">
                <FieldForm {...rowProps(editingField, draft.fields.indexOf(editingField))} />
              </div>
              <SheetFooter className="flex-row">
                <Button type="button" variant="outline" className="flex-1 text-destructive" onClick={() => {
                  remove(editingField.uid)
                  setEditing(null)
                }}>
                  <Trash2 />
                  Remove
                </Button>
                <Button type="button" className="flex-1" onClick={() => setEditing(null)}>
                  Done
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  )
}

function EmptyFields() {
  return (
    <p className="mt-2 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      Only the id is sent for now. Add the fields Jivox should receive.
    </p>
  )
}

function IdKeyInput({ draft, onChange, problems, withLabel }: { draft: Draft; onChange: (d: Draft) => void; problems: ErrorDetail[]; withLabel?: boolean }) {
  return (
    <div className="min-w-0">
      {withLabel && (
        <label htmlFor="id-key-sm" className="mb-1 block text-xs text-muted-foreground">
          Response key
        </label>
      )}
      <Input
        id={withLabel ? 'id-key-sm' : undefined}
        aria-label="Response key of the id"
        value={draft.idKey}
        aria-invalid={problems.length > 0 || undefined}
        onChange={(e) => onChange({ ...draft, idKey: e.target.value })}
        className="font-mono text-[13px]"
      />
      {problems.map((p, i) => (
        <p key={i} className="mt-1 text-xs text-destructive">
          {p.message}
        </p>
      ))}
    </div>
  )
}

type FieldEditorProps = {
  field: DraftField
  index: number
  jivox?: JivoxField
  choosable: JivoxField[]
  used: Set<string>
  columns: string[]
  info: Map<string, ColumnInfo>
  problems: ErrorDetail[]
  check: (ValueCheck & { rows: number }) | null
  suggested: FieldType
  onUpdate: (patch: Partial<DraftField>) => void
  onColumn: (column: string) => void
  onJivox: (jivox: JivoxField) => void
  agentNames: string[]
}

// "Used by axas · Agent 1": a Jivox agent's contract answers this field live (5.6), so removing it
// or changing its Jivox field asks first when saving.
function AgentUse({ names, compact = false }: { names: string[]; compact?: boolean }) {
  if (names.length === 0) return null
  const text = compact ? `${names.length} Jivox agent${names.length === 1 ? '' : 's'}` : `Used by ${names.join(', ')}`
  return (
    <span className={cn('flex min-w-0 items-center gap-1 text-xs text-muted-foreground', !compact && 'mt-1 px-1')} title={`Jivox agents using this field: ${names.join(', ')}`}>
      <Bot className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{text}</span>
    </span>
  )
}

const has = (problems: ErrorDetail[], field: string) => problems.some((p) => p.field.endsWith(`.${field}`))

function FieldRow(
  props: FieldEditorProps & { isFirst: boolean; isLast: boolean; onMove: (step: -1 | 1) => void; onRemove: () => void; onAfterRemove: () => void },
) {
  const { field, index, jivox, choosable, used, columns, info, problems, check, onUpdate, onColumn, onJivox } = props
  const n = index + 1
  const removed = useRef(false)
  return (
    <div>
      <div className={ROW_GRID}>
        <JivoxFieldPicker fields={choosable} used={used} columns={columns} onPick={onJivox} label={`Jivox field of field ${n}`}>
          <JivoxFieldButton field={jivox} name={field.jivoxColumn} invalid={has(problems, 'jivoxColumn')} aria-label={`Jivox field of field ${n}: ${field.jivoxColumn}`} />
        </JivoxFieldPicker>
        <ColumnSelect label={`Column of field ${n}`} value={field.sourceColumn} columns={columns} info={info} onChange={onColumn} invalid={has(problems, 'sourceColumn')} />
        <Input
          aria-label={`Response key of field ${n}`}
          value={field.responseKey}
          aria-invalid={has(problems, 'responseKey') || undefined}
          onChange={(e) => onUpdate({ responseKey: e.target.value })}
          className="font-mono text-[13px]"
        />
        <TypePicker
          label={`Type of field ${n}`}
          type={field.type}
          typeInContract={field.typeInContract}
          onMismatch={field.onMismatch}
          onEmpty={field.onEmpty ?? 'empty_string'}
          info={info.get(field.sourceColumn)}
          suggested={suggestType(info.get(field.sourceColumn), jivox?.typeHint ?? 'string')}
          jivoxHint={jivox?.typeHint}
          onChange={onUpdate}
          invalid={has(problems, 'type')}
        />
        <Input
          aria-label={`Default of field ${n}`}
          value={field.default}
          placeholder={(field.onEmpty ?? 'empty_string') === 'omit' ? 'none' : 'none: ""'}
          title={(field.onEmpty ?? 'empty_string') === 'omit' ? 'No default: empty rows leave the key out' : 'No default: empty rows send ""'}
          aria-invalid={has(problems, 'default') || undefined}
          onChange={(e) => onUpdate({ default: e.target.value })}
          className="text-[13px]"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={`More for field ${n} (${field.jivoxColumn})`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              if (!removed.current) return // move / Escape: back to the ⋯ button
              event.preventDefault()
              props.onAfterRemove()
            }}
          >
            <DropdownMenuItem disabled={props.isFirst} onSelect={() => props.onMove(-1)}>
              <ArrowUp />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={props.isLast} onSelect={() => props.onMove(1)}>
              <ArrowDown />
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                removed.current = true
                props.onRemove()
              }}
            >
              <Trash2 />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AgentUse names={props.agentNames} />
      <FieldNotes problems={problems} check={check} field={field} suggested={props.suggested} onUpdate={onUpdate} />
    </div>
  )
}

// The same editors stacked (phone bottom sheet).
function FieldForm(props: FieldEditorProps) {
  const { field, jivox, choosable, used, columns, info, problems, check, onUpdate, onColumn, onJivox } = props
  const id = (name: string) => `sheet-${name}`
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Jivox field</p>
        <JivoxFieldPicker fields={choosable} used={used} columns={columns} onPick={onJivox}>
          <JivoxFieldButton field={jivox} name={field.jivoxColumn} invalid={has(problems, 'jivoxColumn')} aria-label={`Jivox field: ${field.jivoxColumn}`} />
        </JivoxFieldPicker>
      </div>
      <div>
        <label htmlFor={id('column')} className="mb-1 block text-xs text-muted-foreground">
          From your column
        </label>
        <ColumnSelect id={id('column')} label="From your column" value={field.sourceColumn} columns={columns} info={info} onChange={onColumn} invalid={has(problems, 'sourceColumn')} />
      </div>
      <div>
        <label htmlFor={id('key')} className="mb-1 block text-xs text-muted-foreground">
          Response key
        </label>
        <Input id={id('key')} value={field.responseKey} aria-invalid={has(problems, 'responseKey') || undefined} onChange={(e) => onUpdate({ responseKey: e.target.value })} className="font-mono" />
      </div>
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Type</p>
        <TypePicker
          label="Type"
          type={field.type}
          typeInContract={field.typeInContract}
          onMismatch={field.onMismatch}
          onEmpty={field.onEmpty ?? 'empty_string'}
          info={info.get(field.sourceColumn)}
          suggested={suggestType(info.get(field.sourceColumn), jivox?.typeHint ?? 'string')}
          jivoxHint={jivox?.typeHint}
          onChange={onUpdate}
        />
      </div>
      <div>
        <label htmlFor={id('default')} className="mb-1 block text-xs text-muted-foreground">
          Default (when a row has no usable value)
        </label>
        <Input id={id('default')} value={field.default} placeholder={(field.onEmpty ?? 'empty_string') === 'omit' ? 'none: the key is left out' : 'none: "" is sent'} aria-invalid={has(problems, 'default') || undefined} onChange={(e) => onUpdate({ default: e.target.value })} />
      </div>
      <FieldNotes problems={problems} check={check} field={field} suggested={props.suggested} onUpdate={onUpdate} />
    </div>
  )
}

// Under a field: its problems (red), then what the data looks like for it (amber / muted).
function FieldNotes({
  problems,
  check,
  field,
  suggested,
  onUpdate,
  compact,
}: {
  problems: ErrorDetail[]
  check: FieldEditorProps['check']
  field: DraftField
  suggested: FieldType
  onUpdate?: (patch: Partial<DraftField>) => void
  compact?: boolean
}) {
  const allBad = check !== null && check.cantConvert > 0 && check.cantConvert === check.rows - check.empty
  const fallback = field.default.trim()
    ? `the default ${field.default} is sent`
    : (field.onEmpty ?? 'empty_string') === 'omit'
      ? 'the key is left out'
      : '"" is sent'
  // Values that don't fit the type: sent as written (text), or treated like empty ones.
  const mismatch = field.onMismatch === 'send' ? 'they are sent as written (as text)' : fallback
  return (
    <div className={cn('flex flex-col gap-0.5', !compact && 'px-1', (problems.length > 0 || check) && 'mt-1')}>
      {problems.map((p, i) => (
        <p key={i} className="flex items-start gap-1 text-xs text-destructive">
          <XCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {p.message}
        </p>
      ))}
      {check && check.cantConvert > 0 && (
        <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {formatNumber(check.cantConvert)} of {formatNumber(check.rows)} rows can't be sent as {field.type}
            {!compact && check.examples.length > 0 && ` (${check.examples.length === 1 && check.cantConvert === 1 ? 'row' : 'rows'} ${check.examples.map((e) => e.row).join(', ')}${check.cantConvert > check.examples.length ? '…' : ''})`}: {mismatch}.
            {allBad && !compact && ' None of its values fit this type.'}
            {onUpdate && suggested !== field.type && (
              <button type="button" onClick={() => onUpdate({ type: suggested })} className="ml-1.5 font-medium underline underline-offset-2 hover:no-underline">
                Send as {suggested} instead
              </button>
            )}
          </span>
        </p>
      )}
      {check && check.empty > 0 && !compact && (
        <p className="text-xs text-muted-foreground">
          {formatNumber(check.empty)} {check.empty === 1 ? 'row is' : 'rows are'} empty: {fallback}.
        </p>
      )}
    </div>
  )
}
