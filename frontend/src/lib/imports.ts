// Small helpers about imports (background jobs that load a file into a data source).
import type { DataImport } from './api-types'

export const isImportActive = (dataImport: DataImport | null | undefined) =>
  dataImport?.status === 'queued' || dataImport?.status === 'running'

// Percentage of an import: rows done ÷ the server's estimate of the file's rows. null = not
// known yet (the first progress update comes after 10 000 rows).
// Every row has been read; the job is saving and switching to the new version (a few seconds).
export const isImportFinishing = (dataImport: DataImport) =>
  dataImport.status === 'running' &&
  dataImport.estimatedRows !== null &&
  dataImport.processedRows >= dataImport.estimatedRows

export function importPercent(dataImport: DataImport) {
  if (dataImport.status === 'succeeded') return 100
  const total = dataImport.estimatedRows
  if (!total || total <= 0) return null
  return Math.min(99, Math.floor((dataImport.processedRows / total) * 100))
}

const RECENT_MS = 5 * 60 * 1000

// Should the Data tab show the latest import's card? While it runs; when it failed AFTER the
// last successful version (so the failure is news); or when it succeeded in the last 5 minutes.
export function isImportWorthShowing(dataImport: DataImport | null, lastImportAt: string | null, now = Date.now()) {
  if (!dataImport) return false
  if (isImportActive(dataImport)) return true
  const finished = dataImport.finishedAt ? new Date(dataImport.finishedAt).getTime() : 0
  if (dataImport.status === 'failed') return !lastImportAt || finished > new Date(lastImportAt).getTime()
  return now - finished < RECENT_MS
}

export const IMPORT_MODE_LABELS: Record<DataImport['mode'], string> = {
  initial: 'First upload',
  replace: 'Replace',
  merge: 'Merge',
}

// The id column inside a file's header: exact name first, then ignoring upper/lower case
// (the same rule as the backend's findIdColumn).
export function findIdColumn(columns: string[], idColumn: string): string | null {
  if (columns.includes(idColumn)) return idColumn
  return columns.find((column) => column.toLowerCase() === idColumn.toLowerCase()) ?? null
}
