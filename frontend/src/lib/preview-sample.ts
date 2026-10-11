// The preview only needs the START of a file (the server looks at the first 1 000 rows).
// So for big files we send just the first ~2 MB: the preview of a 200 MB file appears in a
// second, and the whole file is uploaded only once, when the data source is created.
import type { SourcePreview } from './api-types'

export const PREVIEW_SAMPLE_BYTES = 2 * 1024 * 1024

// The first ~2 MB, cut right after the last line break, so no row is cut in half.
// (A line break inside a quoted value could still be the cut point; the server only reads
// 1 000 rows, which are almost always far before it.)
export async function sampleOf(file: File): Promise<Blob> {
  if (file.size <= PREVIEW_SAMPLE_BYTES) return file
  const head = new Uint8Array(await file.slice(0, PREVIEW_SAMPLE_BYTES).arrayBuffer())
  const lastNewline = head.lastIndexOf(0x0a) // "\n"
  return lastNewline > 0 ? file.slice(0, lastNewline + 1) : file.slice(0, PREVIEW_SAMPLE_BYTES)
}

const TAIL_BYTES = 1024 * 1024

async function countLineBreaks(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let count = 0
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) count++
  return count
}

// Rows in the WHOLE file: exact if the server read all of it, otherwise an estimate.
// The estimate uses the average line length of the file's START (the sample) and its END
// (the last 1 MB, read locally, never uploaded): rows often get longer further down
// ("Product 9" … "Product 499999"), so the start alone over-counts by ~5%.
export async function rowEstimate(preview: SourcePreview, file: File, sample: Blob) {
  if (sample.size >= file.size && preview.totalRows !== null) return { rows: preview.totalRows, exact: true }
  const tail = file.slice(Math.max(sample.size, file.size - TAIL_BYTES))
  const lines = (await countLineBreaks(sample)) + (await countLineBreaks(tail))
  const bytes = sample.size + tail.size
  if (lines === 0) return { rows: null, exact: false }
  // (Quoted values with line breaks inside make this a little high; it's shown as "about".)
  return { rows: Math.max(1, Math.round(file.size / (bytes / lines)) - 1), exact: false } // − header row
}
