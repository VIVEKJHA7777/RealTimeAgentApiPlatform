import { AlertTriangle, Database, FileSpreadsheet, Loader2, RefreshCw, Upload, X } from 'lucide-react'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DataSource } from '@/lib/api-types'
import { UPLOAD_MAX_MB, type UploadState } from '@/lib/use-file-preview'
import { formatBytes, formatNumber, formatRows } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ExistingDataPicker } from './ExistingDataPicker'
import { FileDropZone } from './FileDropZone'
import { IdColumnPicker } from './IdColumnPicker'
import { SourcePreviewTable } from './SourcePreviewTable'

export type DataChoice = 'upload' | 'existing'

// Step 2: upload a new CSV (preview → id column → name) or pick data the brand already has.
export function DataStep(props: {
  choice: DataChoice
  onChoiceChange: (choice: DataChoice) => void
  upload: UploadState
  onFile: (file: File) => void
  onClearFile: () => void
  onRetryPreview: () => void
  idColumn: string | null
  onIdColumnChange: (column: string) => void
  dataName: string
  onDataNameChange: (name: string) => void
  dataSources: DataSource[] | undefined // undefined = still loading
  existingId: string | null
  onExistingChange: (id: string) => void
  errors: Record<string, string>
}) {
  const { choice, dataSources } = props
  const hasExisting = (dataSources?.length ?? 0) > 0

  return (
    <div className="grid grid-cols-1 gap-6">
      <div
        role="radiogroup"
        aria-label="Where the data comes from"
        className="inline-flex w-full rounded-xl border bg-muted/50 p-1 sm:w-fit"
      >
        <ChoiceButton active={choice === 'upload'} onClick={() => props.onChoiceChange('upload')} icon={Upload} short="Upload CSV">
          Upload a CSV
        </ChoiceButton>
        <ChoiceButton
          active={choice === 'existing'}
          onClick={() => hasExisting && props.onChoiceChange('existing')}
          icon={Database}
          disabled={!hasExisting}
          title={hasExisting ? undefined : 'This brand has no data yet'}
          short="Existing data"
        >
          Use existing data
        </ChoiceButton>
      </div>

      {choice === 'upload' ? <UploadPanel {...props} /> : (
        <ExistingDataPicker
          dataSources={dataSources ?? []}
          value={props.existingId}
          onChange={props.onExistingChange}
          error={props.errors.existing}
        />
      )}
    </div>
  )
}

function ChoiceButton({
  active,
  disabled,
  onClick,
  icon: Icon,
  title,
  short,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  icon: typeof Upload
  title?: string
  short: string // label on phones
  children: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors sm:px-4 outline-none focus-visible:ring-4 focus-visible:ring-ring/20 sm:flex-none',
        active ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-50 hover:text-muted-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{children}</span>
    </button>
  )
}

function UploadPanel(props: Parameters<typeof DataStep>[0]) {
  const { upload, errors } = props

  if (upload.status === 'empty' || (upload.status === 'invalid' && upload.file === null)) {
    return (
      <FileDropZone
        onFile={props.onFile}
        maxMb={UPLOAD_MAX_MB}
        error={upload.status === 'invalid' ? upload.message : errors.file}
      />
    )
  }

  const file = upload.file!
  return (
    <div className="grid grid-cols-1 gap-6">
      {/* The chosen file */}
      <div className="flex items-center gap-3 rounded-xl border bg-background p-3">
        <div
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            upload.status === 'invalid' ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
          )}
        >
          <FileSpreadsheet className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={file.name}>
            {file.name}
          </p>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {formatBytes(file.size)}
            {upload.status === 'reading' && ' · Reading the file…'}
            {upload.status === 'ready' &&
              ` · ${upload.preview.columns.length} columns · ${
                upload.rows === null ? 'rows unknown' : formatRows(upload.rows, !upload.exactRows)
              }`}
          </p>
        </div>
        {upload.status === 'reading' ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Reading the file" />
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={props.onClearFile}>
            <X />
            Change
          </Button>
        )}
      </div>

      {/* "Next" refused because of the file (problems, still reading…): say so right here. */}
      {errors.file && upload.status !== 'invalid' && (
        <p role="alert" className="-mt-3 text-sm text-destructive animate-in fade-in duration-150" ref={(el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}>
          {errors.file}
        </p>
      )}

      {upload.status === 'reading' && <PreviewSkeleton />}

      {upload.status === 'invalid' && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            {upload.message}
          </p>
          {upload.details.some((detail) => detail.message !== upload.message) && (
            <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">
              {upload.details.filter((detail) => detail.message !== upload.message).map((detail, index) => (
                <li key={index}>{detail.field !== 'file' ? `${detail.field}: ${detail.message}` : detail.message}</li>
              ))}
            </ul>
          )}
          {upload.canRetry && (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={props.onRetryPreview}>
              <RefreshCw />
              Try again
            </Button>
          )}
        </div>
      )}

      {upload.status === 'ready' && (
        <>
          {upload.preview.problems.length > 0 && <Problems problems={upload.preview.problems} />}

          <section aria-label="Preview of the file" className="grid grid-cols-1 gap-2">
            <SourcePreviewTable preview={upload.preview} idColumn={props.idColumn} />
            <p className="text-xs text-muted-foreground">
              First {upload.preview.sampleRows.length} rows. Values are stored exactly as written; types are chosen per API later.
            </p>
          </section>

          <IdColumnPicker
            columns={upload.preview.columns}
            candidates={upload.preview.idCandidates}
            rowsScanned={upload.preview.rowsScanned}
            value={props.idColumn}
            onChange={props.onIdColumnChange}
            error={errors.idColumn}
          />

          <FormField
            id="data-name"
            label="Name of this data"
            error={errors.dataName}
            hint="Other APIs of this brand can use the same data by this name."
          >
            {(field) => (
              <Input
                {...field}
                maxLength={120}
                value={props.dataName}
                onChange={(event) => props.onDataNameChange(event.target.value)}
              />
            )}
          </FormField>
        </>
      )}
    </div>
  )
}

function Problems({ problems }: { problems: { row: number | null; message: string }[] }) {
  return (
    <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        This file has problems, so its import would fail. Fix them and choose the file again.
      </p>
      <ul className="mt-2 space-y-1.5">
        {problems.map((problem, index) => (
          <li key={index} className="flex gap-2">
            {problem.row !== null && (
              <span className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs text-amber-700 dark:text-amber-400">
                row {formatNumber(problem.row)}
              </span>
            )}
            <span className="min-w-0 break-words text-muted-foreground">{problem.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PreviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border p-3" role="status" aria-label="Reading the file">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-6 animate-pulse rounded-md bg-muted" style={{ opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  )
}
