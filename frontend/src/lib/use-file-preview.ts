import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, dataSourcesApi } from './api'
import type { ErrorDetail, SourcePreview } from './api-types'
import { formatBytes, formatNumber } from './format'
import { rowEstimate, sampleOf } from './preview-sample'

export const UPLOAD_MAX_MB = 200 // mirrors the backend's UPLOAD_MAX_MB default
const MAX_ROWS = 1_000_000 // mirrors the backend's IMPORT_MAX_ROWS default

// The chosen file and what we know about it.
export type UploadState =
  | { status: 'empty' }
  | { status: 'reading'; file: File } // preview request running
  | { status: 'invalid'; file: File | null; message: string; details: ErrorDetail[]; canRetry: boolean }
  | { status: 'ready'; file: File; preview: SourcePreview; rows: number | null; exactRows: boolean }

// "Choose a file → see what's in it", shared by the Create API wizard and "Upload new version":
//   1. checks we can do in the browser (.csv, empty, > 200 MB) — no request at all
//   2. preview of the START of the file only (lib/preview-sample.ts), so even 200 MB is instant
//   3. row estimate for the whole file; > 1 000 000 rows is added as a problem
// Picking another file (or leaving the page) cancels the preview still running.
export function useFilePreview(brandSlug: string, onReady?: (preview: SourcePreview, file: File) => void) {
  const [upload, setUpload] = useState<UploadState>({ status: 'empty' })
  const abortRef = useRef<AbortController | null>(null)
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  })
  useEffect(() => () => abortRef.current?.abort(), [])

  const pick = useCallback(
    async (file: File) => {
      abortRef.current?.abort()
      const problem = !/\.csv$/i.test(file.name)
        ? `"${file.name}" isn't a .csv file. Export your sheet as CSV and choose it here.`
        : file.size === 0
          ? 'This file is empty.'
          : file.size > UPLOAD_MAX_MB * 1024 * 1024
            ? `This file is ${formatBytes(file.size)}; the limit is ${UPLOAD_MAX_MB} MB.`
            : null
      if (problem) {
        setUpload({ status: 'invalid', file: null, message: problem, details: [], canRetry: false })
        return
      }

      const controller = new AbortController()
      abortRef.current = controller
      setUpload({ status: 'reading', file })
      try {
        const sample = await sampleOf(file)
        const { preview } = await dataSourcesApi.preview(brandSlug, sample, file.name, { signal: controller.signal })
        if (controller.signal.aborted) return
        const { rows, exact } = await rowEstimate(preview, file, sample)
        if (controller.signal.aborted) return
        const problems = [...preview.problems]
        if (rows !== null && rows > MAX_ROWS) {
          problems.push({
            row: null,
            message: `This file has about ${formatNumber(rows)} rows; the limit is ${formatNumber(MAX_ROWS)}.`,
          })
        }
        const ready = { ...preview, problems }
        setUpload({ status: 'ready', file, preview: ready, rows, exactRows: exact })
        onReadyRef.current?.(ready, file)
      } catch (error) {
        if (controller.signal.aborted) return
        if (!(error instanceof ApiError)) throw error
        setUpload({ status: 'invalid', file, message: error.message, details: error.details, canRetry: error.isNetworkError })
      }
    },
    [brandSlug],
  )

  const clear = useCallback(() => {
    abortRef.current?.abort()
    setUpload({ status: 'empty' })
  }, [])

  const retry = useCallback(() => {
    if (upload.status === 'invalid' && upload.file) void pick(upload.file)
  }, [upload, pick])

  // e.g. the server refused the file at upload time (it changed, or a rule the preview can't see)
  const reject = useCallback((file: File | null, error: ApiError) => {
    setUpload({ status: 'invalid', file, message: error.message, details: error.details, canRetry: false })
  }, [])

  return { upload, pick, clear, retry, reject }
}
