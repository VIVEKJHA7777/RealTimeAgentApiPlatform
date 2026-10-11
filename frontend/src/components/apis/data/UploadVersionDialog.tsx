import { AlertTriangle, CheckCircle2, FileSpreadsheet, GitMerge, Loader2, RefreshCw, Replace, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FileDropZone } from '@/components/apis/wizard/FileDropZone'
import { SourcePreviewTable } from '@/components/apis/wizard/SourcePreviewTable'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { ApiError, dataSourcesApi } from '@/lib/api'
import type { Api, DataSource, ImportMode } from '@/lib/api-types'
import { formatBytes, formatNumber, formatRows } from '@/lib/format'
import { findIdColumn } from '@/lib/imports'
import { UPLOAD_MAX_MB, useFilePreview } from '@/lib/use-file-preview'
import { cn } from '@/lib/utils'

const MODES: { value: ImportMode; label: string; text: string; icon: typeof Replace }[] = [
  { value: 'replace', label: 'Replace', text: 'The file becomes the data. Rows not in the file are removed.', icon: Replace },
  { value: 'merge', label: 'Merge', text: 'Add new rows and update changed ones. Rows not in the file stay.', icon: GitMerge },
]

// "Upload new version" on the Data tab: choose a file → instant preview + checks → Replace or
// Merge → upload (progress) → the import runs in the background and the Data tab follows it.
// The current version stays live until the new one is complete (backend: generations).
export function UploadVersionDialog({
  open,
  onOpenChange,
  brandSlug,
  api,
  dataSource,
  onStarted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  brandSlug: string
  api: Api
  dataSource: DataSource
  onStarted: () => Promise<void> | void
}) {
  const [uploading, setUploading] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(next) => !uploading && onOpenChange(next)}>
      <DialogContent
        className="max-h-[92svh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!uploading}
        onInteractOutside={(event) => uploading && event.preventDefault()}
      >
        {/* Mounted only while open: every opening starts fresh, closing cancels a preview. */}
        <UploadForm
          brandSlug={brandSlug}
          api={api}
          dataSource={dataSource}
          onUploadingChange={setUploading}
          onClose={() => onOpenChange(false)}
          onStarted={onStarted}
        />
      </DialogContent>
    </Dialog>
  )
}

function UploadForm({
  brandSlug,
  api,
  dataSource,
  onUploadingChange,
  onClose,
  onStarted,
}: {
  brandSlug: string
  api: Api
  dataSource: DataSource
  onUploadingChange: (uploading: boolean) => void
  onClose: () => void
  onStarted: () => Promise<void> | void
}) {
  const { upload, pick, clear, retry, reject } = useFilePreview(brandSlug)
  const [mode, setMode] = useState<ImportMode>('replace')
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), []) // closing the dialog cancels the upload

  const others = dataSource.usedBy.filter((ref) => ref.id !== api.id)

  // What the file means for this data source (only once its preview is ready).
  const checks =
    upload.status === 'ready'
      ? (() => {
          const columns = upload.preview.columns
          const idColumn = findIdColumn(columns, dataSource.idColumn)
          const lower = new Set(columns.map((c) => c.toLowerCase()))
          return {
            idColumn,
            idUsable: idColumn !== null && upload.preview.idCandidates.includes(idColumn),
            added: columns.filter((c) => !dataSource.columns.some((old) => old.toLowerCase() === c.toLowerCase())),
            missing: dataSource.columns.filter((old) => !lower.has(old.toLowerCase())),
            problems: upload.preview.problems,
          }
        })()
      : null
  const blocked = !checks || checks.idColumn === null || !checks.idUsable || checks.problems.length > 0

  async function start() {
    if (upload.status !== 'ready' || blocked || progress) return
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    setProgress({ loaded: 0, total: upload.file.size })
    onUploadingChange(true)
    try {
      await dataSourcesApi.startImport(
        brandSlug,
        dataSource.id,
        { file: upload.file, mode },
        { signal: controller.signal, onProgress: setProgress },
      )
      toast.success(`Uploaded. Importing ${upload.file.name} (${mode})…`)
      onUploadingChange(false)
      onClose()
      await onStarted() // the Data tab reloads and follows the import
    } catch (err) {
      onUploadingChange(false)
      setProgress(null)
      if (!(err instanceof ApiError)) throw err
      if (err.code === 'ABORTED') return
      if (err.code === 'IMPORT_IN_PROGRESS') setError('An import is already running for this data. Wait until it finishes, then upload again.')
      else if (err.code === 'DATA_SOURCE_NOT_FOUND') setError('This data was deleted in the meantime.')
      else if (err.isNetworkError) setError(err.message)
      else reject(upload.file, err) // the file itself (id column missing, broken row, too big…)
    }
  }

  const uploading = progress !== null
  const percent = progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0

  return (
    <div className="grid grid-cols-1 gap-5">
      <DialogHeader>
        <DialogTitle>Upload a new version</DialogTitle>
        <DialogDescription>
          Of <span className="font-medium text-foreground">{dataSource.name}</span> · id column{' '}
          <span className="font-mono text-foreground">{dataSource.idColumn}</span>. The current version stays live until the
          new one is imported.
        </DialogDescription>
      </DialogHeader>

      {others.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Also used by {others.map((ref) => `"${ref.name}"`).join(', ')}: {others.length === 1 ? 'it answers' : 'they answer'} from
            the new version too.
          </span>
        </p>
      )}

      {upload.status === 'empty' || (upload.status === 'invalid' && upload.file === null) ? (
        <FileDropZone onFile={(file) => void pick(file)} maxMb={UPLOAD_MAX_MB} error={upload.status === 'invalid' ? upload.message : undefined} />
      ) : (
        <div className="flex items-center gap-3 rounded-xl border p-3">
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg',
              upload.status === 'invalid' || (checks && blocked) ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
            )}
          >
            <FileSpreadsheet className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={upload.file!.name}>
              {upload.file!.name}
            </p>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {formatBytes(upload.file!.size)}
              {upload.status === 'reading' && ' · Reading the file…'}
              {upload.status === 'ready' &&
                ` · ${upload.preview.columns.length} columns · ${upload.rows === null ? 'rows unknown' : formatRows(upload.rows, !upload.exactRows)}`}
            </p>
          </div>
          {upload.status === 'reading' ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Reading the file" />
          ) : (
            !uploading && (
              <Button type="button" variant="ghost" size="sm" onClick={clear}>
                <X />
                Change
              </Button>
            )
          )}
        </div>
      )}

      {upload.status === 'invalid' && upload.file !== null && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            {upload.message}
          </p>
          {upload.details.some((d) => d.message !== upload.message) && (
            <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">
              {upload.details
                .filter((d) => d.message !== upload.message)
                .map((d, i) => (
                  <li key={i}>{d.message}</li>
                ))}
            </ul>
          )}
          {upload.canRetry && (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={retry}>
              <RefreshCw />
              Try again
            </Button>
          )}
        </div>
      )}

      {upload.status === 'ready' && checks && (
        <>
          <ul className="grid grid-cols-1 gap-2 text-sm" aria-label="Checks">
            <Check ok={checks.idColumn !== null && checks.idUsable}>
              {checks.idColumn === null
                ? `The id column "${dataSource.idColumn}" isn't in this file. Every version needs it.`
                : !checks.idUsable
                  ? `"${checks.idColumn}" is empty or repeats in the first rows, so the import would fail.`
                  : `Id column "${checks.idColumn}" found`}
            </Check>
            {checks.added.length === 0 && checks.missing.length === 0 ? (
              <Check ok>Same columns as now</Check>
            ) : (
              <>
                {checks.added.length > 0 && (
                  <Check ok>
                    New {checks.added.length === 1 ? 'column' : 'columns'}: <Names names={checks.added} />
                  </Check>
                )}
                {checks.missing.length > 0 && (
                  <Check warn>
                    Not in this file: <Names names={checks.missing} />.{' '}
                    {mode === 'replace'
                      ? 'With Replace these columns disappear.'
                      : 'With Merge, rows from this file have no value for them.'}
                  </Check>
                )}
              </>
            )}
            {checks.problems.map((problem, index) => (
              <Check key={index} ok={false}>
                {problem.row !== null && <span className="font-mono">row {formatNumber(problem.row)}: </span>}
                {problem.message}
              </Check>
            ))}
          </ul>

          <SourcePreviewTable preview={upload.preview} idColumn={checks.idColumn} />

          <fieldset>
            <legend className="text-sm font-medium">How to use this file</legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Import mode">
              {MODES.map(({ value, label, text, icon: Icon }) => {
                const selected = mode === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={uploading}
                    onClick={() => setMode(value)}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/20 disabled:opacity-60',
                      selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/30 hover:bg-muted/40',
                    )}
                  >
                    <Icon className={cn('mt-0.5 size-4 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                    <span>
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{text}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>
        </>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {uploading && (
        <div className="rounded-xl border bg-muted/40 p-4" aria-live="polite">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">Uploading…</span>
            <span className="text-muted-foreground tabular-nums">
              {formatBytes(progress.loaded)} / {formatBytes(progress.total)} · {percent}%
            </span>
          </div>
          <Progress value={percent} className="mt-3 h-2" aria-label="Upload progress" />
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => (uploading ? abortRef.current?.abort() : onClose())}>
          {uploading ? 'Cancel upload' : 'Cancel'}
        </Button>
        <Button type="button" onClick={() => void start()} disabled={upload.status !== 'ready' || blocked || uploading}>
          {uploading && <Loader2 className="animate-spin" />}
          {uploading ? 'Uploading…' : mode === 'replace' ? 'Upload and replace' : 'Upload and merge'}
        </Button>
      </DialogFooter>
    </div>
  )
}

function Check({ ok = true, warn = false, children }: { ok?: boolean; warn?: boolean; children: ReactNode }) {
  const Icon = warn || !ok ? AlertTriangle : CheckCircle2
  return (
    <li
      className={cn(
        'flex items-start gap-2',
        warn ? 'text-amber-800 dark:text-amber-300' : ok ? 'text-foreground' : 'text-destructive',
      )}
    >
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', !warn && ok && 'text-emerald-600 dark:text-emerald-400')}
        aria-label={warn ? 'Warning' : ok ? 'OK' : 'Problem'}
      />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </li>
  )
}

function Names({ names }: { names: string[] }) {
  const shown = names.slice(0, 6)
  return (
    <span title={names.join(', ')}>
      {shown.map((name, i) => (
        <span key={name}>
          {i > 0 && ', '}
          <span className="font-mono text-xs">{name}</span>
        </span>
      ))}
      {names.length > shown.length && ` and ${names.length - shown.length} more`}
    </span>
  )
}
