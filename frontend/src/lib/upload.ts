// File uploads with a progress bar.
// fetch() can't report how much of a request body was sent, so uploads use XMLHttpRequest,
// which can. The result is the same as apiFetch: the parsed JSON, or an ApiError.
import { ApiError, UNREACHABLE_MESSAGE, toApiError } from './api'

export type UploadProgress = { loaded: number; total: number }

export type UploadOptions = {
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal // abort() cancels the upload (e.g. the user picked another file)
}

export function uploadForm<T>(path: string, form: FormData, { onProgress, signal }: UploadOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(new ApiError(0, 'ABORTED', 'Upload cancelled'))

    const xhr = new XMLHttpRequest()
    xhr.open('POST', path)
    xhr.responseType = 'text'

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.({ loaded: event.loaded, total: event.total })
    }
    xhr.onload = () => {
      const isJson = xhr.getResponseHeader('content-type')?.includes('application/json')
      if (!isJson) return reject(new ApiError(0, 'BACKEND_UNREACHABLE', UNREACHABLE_MESSAGE))
      let data: unknown
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        return reject(new ApiError(0, 'BACKEND_UNREACHABLE', UNREACHABLE_MESSAGE))
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T)
      else reject(toApiError(xhr.status, data))
    }
    // The connection broke (backend stopped, network gone). Note: when the server refuses a
    // too-big file early (413), some browsers report that as an error too.
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', UNREACHABLE_MESSAGE))
    xhr.onabort = () => reject(new ApiError(0, 'ABORTED', 'Upload cancelled'))

    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(form)
  })
}
