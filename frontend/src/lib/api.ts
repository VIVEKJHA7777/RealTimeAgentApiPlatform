// The one place where the frontend talks to the backend.
// All paths start with /api, which Vite forwards to http://localhost:4000 (see vite.config.ts).
// Pages never call fetch() themselves: they call the functions at the bottom of this file.
import type {
  Api,
  ApiErrorBody,
  ColumnTypes,
  DesignInput,
  DesignPreview,
  DesignState,
  FeedSchema,
  FieldType,
  ValueCheck,
  DataImport,
  DataSource,
  ErrorDetail,
  FeedType,
  ImportMode,
  RecordsPage,
  Organization,
  SourcePreview,
  User,
  AuthHeaderStyle,
  NewToken,
  PublishCheck,
  SelfCheckResult,
  TryResult,
  TokenInfo,
  TokenList,
  RecentCalls,
  Agent,
  AgentCheck,
  ContractDocument,
  AgentContract,
  AgentInput,
  AgentList,
} from './api-types'
import { uploadForm, type UploadOptions } from './upload'

// Any failed call becomes an ApiError, so pages handle ONE kind of error.
//   status 0 = we never got an answer from our backend (network down, backend stopped)
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: ErrorDetail[]
  readonly requestId?: string
  readonly extra?: Record<string, unknown>

  constructor(status: number, code: string, message: string, details: ErrorDetail[] = [], requestId?: string, extra?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
    this.extra = extra
  }

  get isNetworkError() {
    return this.status === 0
  }
}

export const UNREACHABLE_MESSAGE = "Can't reach the server. Try again."

// Called when the backend says "you're not logged in" (401 UNAUTHENTICATED), e.g. the
// session expired or you logged out in another tab. AuthProvider registers it.
let onUnauthenticated: (() => void) | null = null
export function setUnauthenticatedHandler(handler: (() => void) | null) {
  onUnauthenticated = handler
}

// Turns an error answer's JSON into an ApiError (shared with lib/upload.ts).
export function toApiError(status: number, data: unknown): ApiError {
  const { error } = data as ApiErrorBody
  const apiError = new ApiError(status, error.code, error.message, error.details, error.requestId, error.extra)
  if (apiError.code === 'UNAUTHENTICATED') onUnauthenticated?.()
  return apiError
}

type RequestOptions = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown }

export async function apiFetch<T>(path: string, { method = 'GET', body }: RequestOptions = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      // Same origin (thanks to the Vite proxy), so the session cookie is sent automatically.
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', UNREACHABLE_MESSAGE)
  }

  if (res.status === 204) return undefined as T

  // Our backend always answers JSON. Anything else (e.g. Vite's "proxy error" page when the
  // backend is stopped) means we didn't really reach it.
  const isJson = res.headers.get('content-type')?.includes('application/json')
  if (!isJson) {
    throw new ApiError(0, 'BACKEND_UNREACHABLE', UNREACHABLE_MESSAGE)
  }

  const data = await res.json()
  if (res.ok) return data as T

  throw toApiError(res.status, data)
}

// Field name → first error message, from a 400 VALIDATION_ERROR's details.
export function fieldErrorsOf(error: ApiError): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const { field, message } of error.details) {
    errors[field] ??= message
  }
  return errors
}

// ---------- Health (Phase 0) ----------

export type HealthResponse = {
  status: 'ok' | 'degraded'
  db: 'up' | 'down'
  uptimeSeconds: number
  timestamp: string
}

// Not using apiFetch: a 503 here is a normal answer ("DB down"), not an error.
export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health')
  const isJson = res.headers.get('content-type')?.includes('application/json')
  if (!isJson) {
    throw new Error(`Backend unreachable (HTTP ${res.status})`)
  }
  return res.json()
}

// ---------- Auth ----------

export const authApi = {
  me: () => apiFetch<{ user: User }>('/api/auth/me'),
  login: (input: { email: string; password: string }) =>
    apiFetch<{ user: User }>('/api/auth/login', { method: 'POST', body: input }),
  signup: (input: { email: string; password: string; name?: string }) =>
    apiFetch<{ user: User }>('/api/auth/signup', { method: 'POST', body: input }),
  logout: () => apiFetch<void>('/api/auth/logout', { method: 'POST' }),
}

// ---------- Brands (organizations) ----------

export const organizationsApi = {
  list: () => apiFetch<{ organizations: Organization[] }>('/api/organizations'),
  // encodeURIComponent: the slug comes from the URL bar, so never trust it to be URL-safe
  get: (slug: string) =>
    apiFetch<{ organization: Organization }>(`/api/organizations/${encodeURIComponent(slug)}`),
  // `slug` is only the START; the server appends "-" + 6 random characters
  create: (input: { name: string; slug: string }) =>
    apiFetch<{ organization: Organization }>('/api/organizations', { method: 'POST', body: input }),
}

// ---------- Data sources (Phase 2) ----------

const brandPath = (brandSlug: string) => `/api/organizations/${encodeURIComponent(brandSlug)}`

export const dataSourcesApi = {
  list: (brandSlug: string) =>
    apiFetch<{ dataSources: DataSource[] }>(`${brandPath(brandSlug)}/data-sources`),
  get: (brandSlug: string, id: string) =>
    apiFetch<{ dataSource: DataSource }>(`${brandPath(brandSlug)}/data-sources/${encodeURIComponent(id)}`),
  imports: (brandSlug: string, id: string) =>
    apiFetch<{ imports: DataImport[] }>(`${brandPath(brandSlug)}/data-sources/${encodeURIComponent(id)}/imports`),
  // One page of rows: browse (afterPosition) or search by id prefix (search + afterId).
  records: (
    brandSlug: string,
    id: string,
    query: { limit: number; afterPosition?: number; search?: string; afterId?: string },
  ) => {
    const params = new URLSearchParams({ limit: String(query.limit) })
    if (query.search) {
      params.set('search', query.search)
      if (query.afterId) params.set('afterId', query.afterId)
    } else if (query.afterPosition) {
      params.set('afterPosition', String(query.afterPosition))
    }
    return apiFetch<RecordsPage>(`${brandPath(brandSlug)}/data-sources/${encodeURIComponent(id)}/records?${params}`)
  },
  // A plain link: the browser downloads the streamed CSV itself (big files never pass through JS).
  downloadUrl: (brandSlug: string, id: string) => `${brandPath(brandSlug)}/data-sources/${encodeURIComponent(id)}/download`,
  remove: (brandSlug: string, id: string) =>
    apiFetch<void>(`${brandPath(brandSlug)}/data-sources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // A new version of the data (replace / merge); the import runs in the background (202).
  startImport: (brandSlug: string, id: string, input: { file: File; mode: ImportMode }, options?: UploadOptions) => {
    const form = new FormData()
    form.append('mode', input.mode)
    form.append('file', input.file, input.file.name)
    return uploadForm<{ import: DataImport }>(
      `${brandPath(brandSlug)}/data-sources/${encodeURIComponent(id)}/imports`,
      form,
      options,
    )
  },
  getImport: (brandSlug: string, id: string, importId: string) =>
    apiFetch<{ import: DataImport }>(
      `${brandPath(brandSlug)}/data-sources/${encodeURIComponent(id)}/imports/${encodeURIComponent(importId)}`,
    ),
  // What's in this file? Nothing is saved. (The wizard sends only the start of big files.)
  preview: (brandSlug: string, file: Blob, fileName: string, options?: UploadOptions) => {
    const form = new FormData()
    form.append('file', file, fileName)
    return uploadForm<{ preview: SourcePreview }>(`${brandPath(brandSlug)}/data-sources/preview`, form, options)
  },
  // Creates the data source and starts its first import (202: the import runs in the background).
  create: (
    brandSlug: string,
    input: { file: File; idColumn: string; name: string },
    options?: UploadOptions,
  ) => {
    const form = new FormData()
    form.append('idColumn', input.idColumn)
    form.append('name', input.name)
    form.append('file', input.file, input.file.name)
    return uploadForm<{ dataSource: DataSource; import: DataImport }>(
      `${brandPath(brandSlug)}/data-sources`,
      form,
      options,
    )
  },
}

// ---------- APIs (Phase 2) ----------

export type ApiInput = { name: string; slug: string; feedType: FeedType; dataSourceId: string }

export const apisApi = {
  list: (brandSlug: string) => apiFetch<{ apis: Api[] }>(`${brandPath(brandSlug)}/apis`),
  get: (brandSlug: string, apiSlug: string) =>
    apiFetch<{ api: Api }>(`${brandPath(brandSlug)}/apis/${encodeURIComponent(apiSlug)}`),
  create: (brandSlug: string, input: ApiInput) =>
    apiFetch<{ api: Api }>(`${brandPath(brandSlug)}/apis`, { method: 'POST', body: input }),
  // Send only what changed. warnings: what to redo in Jivox when a published API changed.
  update: (brandSlug: string, apiSlug: string, changes: Partial<ApiInput>) =>
    apiFetch<{ api: Api; warnings: string[] }>(`${brandPath(brandSlug)}/apis/${encodeURIComponent(apiSlug)}`, {
      method: 'PATCH',
      body: changes,
    }),
  // Deletes the API only; its data stays.
  remove: (brandSlug: string, apiSlug: string) =>
    apiFetch<void>(`${brandPath(brandSlug)}/apis/${encodeURIComponent(apiSlug)}`, { method: 'DELETE' }),
}

// ---------- Design (Phase 3) ----------

const designPath = (brandSlug: string, apiSlug: string) =>
  `${brandPath(brandSlug)}/apis/${encodeURIComponent(apiSlug)}/design`

export const designApi = {
  get: (brandSlug: string, apiSlug: string) => apiFetch<DesignState>(designPath(brandSlug, apiSlug)),
  // `version` = the one loaded; someone saved in between → 409 DESIGN_CHANGED. A save that takes
  // fields away from Jivox agents → 409 AGENT_FIELDS_DROPPED until those pairs are confirmed.
  save: (brandSlug: string, apiSlug: string, input: DesignInput & { version: number; confirmDroppedFields?: { agentId: string; field: string }[] }) =>
    apiFetch<DesignState>(designPath(brandSlug, apiSlug), { method: 'PUT', body: input }),
  columns: (brandSlug: string, apiSlug: string) => apiFetch<ColumnTypes>(`${designPath(brandSlug, apiSlug)}/columns`),
  checkValues: (brandSlug: string, apiSlug: string, fields: { sourceColumn: string; type: FieldType }[]) =>
    apiFetch<{ rows: number; fields: ValueCheck[] }>(`${designPath(brandSlug, apiSlug)}/check-values`, {
      method: 'POST',
      body: { fields },
    }),
  // Nothing is saved: the design being edited + optional ids.
  preview: (brandSlug: string, apiSlug: string, input: { design: DesignInput; ids?: string[] }) =>
    apiFetch<DesignPreview>(`${designPath(brandSlug, apiSlug)}/preview`, { method: 'POST', body: input }),
}

// ---------- Tokens (Phase 4, task 4.2 endpoints; screens 4.6) ----------

const apiPath = (brandSlug: string, apiSlug: string) => `${brandPath(brandSlug)}/apis/${encodeURIComponent(apiSlug)}`
const tokenPath = (brandSlug: string, apiSlug: string, tokenId: string) =>
  `${apiPath(brandSlug, apiSlug)}/tokens/${encodeURIComponent(tokenId)}`

export const tokensApi = {
  list: (brandSlug: string, apiSlug: string) => apiFetch<TokenList>(`${apiPath(brandSlug, apiSlug)}/tokens`),
  // expiresAt: ISO with zone, or null = never
  create: (brandSlug: string, apiSlug: string, input: { name: string; expiresAt: string | null }) =>
    apiFetch<NewToken>(`${apiPath(brandSlug, apiSlug)}/tokens`, { method: 'POST', body: input }),
  reveal: (brandSlug: string, apiSlug: string, tokenId: string) =>
    apiFetch<{ token: string; tokenInfo: TokenInfo }>(`${tokenPath(brandSlug, apiSlug, tokenId)}/reveal`),
  // Rename and / or Extend (same token, new expiry)
  update: (brandSlug: string, apiSlug: string, tokenId: string, input: { name?: string; expiresAt?: string | null }) =>
    apiFetch<{ tokenInfo: TokenInfo }>(tokenPath(brandSlug, apiSlug, tokenId), { method: 'PATCH', body: input }),
  // A new token in place of this one (the old one is revoked at once)
  renew: (brandSlug: string, apiSlug: string, tokenId: string, input: { expiresAt: string | null }) =>
    apiFetch<NewToken>(`${tokenPath(brandSlug, apiSlug, tokenId)}/renew`, { method: 'POST', body: input }),
  revoke: (brandSlug: string, apiSlug: string, tokenId: string) =>
    apiFetch<{ tokenInfo: TokenInfo }>(tokenPath(brandSlug, apiSlug, tokenId), { method: 'DELETE' }),
  setAuthHeader: (brandSlug: string, apiSlug: string, style: AuthHeaderStyle) =>
    apiFetch<{ authHeader: AuthHeaderStyle }>(`${apiPath(brandSlug, apiSlug)}/auth-header`, { method: 'PUT', body: { style } }),
}

// ---------- Test tab + publishing (Phase 4, tasks 4.4 / 4.5 endpoints; screens 4.7) ----------

export const testingApi = {
  // ids left out = the first 2 rows of the data
  tryIt: (brandSlug: string, apiSlug: string, ids?: string[]) =>
    apiFetch<TryResult>(`${apiPath(brandSlug, apiSlug)}/try`, { method: 'POST', body: ids ? { ids } : {} }),
  selfCheck: (brandSlug: string, apiSlug: string, ids?: string[]) =>
    apiFetch<SelfCheckResult>(`${apiPath(brandSlug, apiSlug)}/self-check`, { method: 'POST', body: ids ? { ids } : {} }),
  publishCheck: (brandSlug: string, apiSlug: string) => apiFetch<PublishCheck>(`${apiPath(brandSlug, apiSlug)}/publish-check`),
  // 409 PUBLISH_BLOCKED: details = every reason ({ field: code, message })
  publish: (brandSlug: string, apiSlug: string) => apiFetch<{ api: Api }>(`${apiPath(brandSlug, apiSlug)}/publish`, { method: 'POST' }),
  unpublish: (brandSlug: string, apiSlug: string) => apiFetch<{ api: Api }>(`${apiPath(brandSlug, apiSlug)}/unpublish`, { method: 'POST' }),
  // Task 4.8b: the last 5 calls to the live URL (self-checks not included), and Clear
  recentCalls: (brandSlug: string, apiSlug: string) => apiFetch<RecentCalls>(`${apiPath(brandSlug, apiSlug)}/recent-calls`),
  clearRecentCalls: (brandSlug: string, apiSlug: string) =>
    apiFetch<RecentCalls>(`${apiPath(brandSlug, apiSlug)}/recent-calls`, { method: 'DELETE' }),
}

export const jivoxApi = {
  feedSchema: (feedType: string) =>
    apiFetch<{ feedSchema: FeedSchema }>(`/api/jivox/feed-schemas/${encodeURIComponent(feedType)}`),
}

// ---------- Jivox agents + contracts (Phase 5) ----------
const agentPath = (brandSlug: string, apiSlug: string, agentId: string) => `${apiPath(brandSlug, apiSlug)}/agents/${encodeURIComponent(agentId)}`

export const agentsApi = {
  list: (brandSlug: string, apiSlug: string) => apiFetch<AgentList>(`${apiPath(brandSlug, apiSlug)}/agents`),
  create: (brandSlug: string, apiSlug: string, input: AgentInput & { name: string }) =>
    apiFetch<{ agent: Agent }>(`${apiPath(brandSlug, apiSlug)}/agents`, { method: 'POST', body: input }),
  update: (brandSlug: string, apiSlug: string, agentId: string, input: AgentInput) =>
    apiFetch<{ agent: Agent }>(agentPath(brandSlug, apiSlug, agentId), { method: 'PATCH', body: input }),
  remove: (brandSlug: string, apiSlug: string, agentId: string) => apiFetch<void>(agentPath(brandSlug, apiSlug, agentId), { method: 'DELETE' }),
  // Read-only MCP calls to Jivox; the agent's fields become Jivox's bound fields (same feed type).
  readJivox: (brandSlug: string, apiSlug: string, agentId: string) =>
    apiFetch<{ agent: Agent; fieldsBefore: string[]; feedTypeMatches: boolean }>(`${agentPath(brandSlug, apiSlug, agentId)}/read-jivox`, { method: 'POST' }),
  contract: (brandSlug: string, apiSlug: string, agentId: string) => apiFetch<AgentContract>(`${agentPath(brandSlug, apiSlug, agentId)}/contract`),
  // The checklist: every Jivox rule + a verification-like live call with the agent's token.
  check: (brandSlug: string, apiSlug: string, agentId: string) => apiFetch<AgentCheck>(`${agentPath(brandSlug, apiSlug, agentId)}/contract/check`, { method: 'POST' }),
  downloadUrl: (brandSlug: string, apiSlug: string, agentId: string) => `${agentPath(brandSlug, apiSlug, agentId)}/contract/download`,
  // The file exactly as the server makes it (text + its name), so what is saved is what is remembered.
  download: async (brandSlug: string, apiSlug: string, agentId: string) => {
    let res: Response
    try {
      res = await fetch(`${agentPath(brandSlug, apiSlug, agentId)}/contract/download`)
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', UNREACHABLE_MESSAGE)
    }
    if (!res.headers.get('content-type')?.includes('application/json')) throw new ApiError(0, 'BACKEND_UNREACHABLE', UNREACHABLE_MESSAGE)
    if (!res.ok) throw toApiError(res.status, await res.json())
    const fileName = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'contract.json'
    return { text: await res.text(), fileName }
  },
  // 5.6: remember the contract just copied / downloaded (its shape) → "out of date" when it changes.
  taken: (brandSlug: string, apiSlug: string, agentId: string, input: { how: 'copy' | 'download'; designVersion: number; document: ContractDocument }) =>
    apiFetch<{ agent: Agent }>(`${agentPath(brandSlug, apiSlug, agentId)}/contract/taken`, { method: 'POST', body: input }),
}

