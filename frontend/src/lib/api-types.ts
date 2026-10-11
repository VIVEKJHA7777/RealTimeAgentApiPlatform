// Shapes of the data the backend sends. Must match the backend's responses.

// GET /api/auth/me, POST /api/auth/login, POST /api/auth/signup → { user }
export type User = {
  id: string
  email: string
  name: string | null
  createdAt: string // ISO date string (JSON has no Date type)
}

// /api/organizations → { organizations: [...] } · /api/organizations/:slug → { organization }
export type Organization = {
  id: string
  name: string
  slug: string // final slug incl. the random suffix, e.g. "acme-shoes-k3x9q2"
  createdAt: string
}

// Every backend error: { "error": { code, message, details?, requestId } }
export type ErrorDetail = { field: string; message: string }

export type ApiErrorBody = {
  error: {
    code: string
    message: string
    details?: ErrorDetail[]
    extra?: Record<string, unknown> // more facts for the screen, e.g. AGENT_FIELDS_DROPPED's agents
    requestId?: string
  }
}

// ---------- Data sources (Phase 2) ----------

export type ImportStatus = 'queued' | 'running' | 'succeeded' | 'failed'

// A problem in the data, with the spreadsheet row number when there is one (row 1 = header).
export type Problem = { row: number | null; message: string }

// One import run (background job). Polled while queued/running.
export type DataImport = {
  id: string
  mode: 'initial' | 'replace' | 'merge'
  status: ImportStatus
  fileName: string | null
  fileSize: number | null
  processedRows: number
  estimatedRows: number | null // about how many rows the whole file has (while running); exact at the end
  inserted: number
  updated: number
  unchanged: number
  deleted: number
  problems: Problem[]
  errorCode: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export type ApiRef = { id: string; name: string; slug: string; status: ApiStatus }

export type DataSource = {
  id: string
  name: string
  kind: string // "csv" (later: "json", "google_sheet")
  idColumn: string
  columns: string[]
  rowCount: number
  hasData: boolean // false until the first import succeeds
  lastImportAt: string | null
  createdAt: string
  usedBy: ApiRef[]
  latestImport: DataImport | null
}

// POST /data-sources/preview → { preview }   (nothing is saved)
export type SourcePreview = {
  kind: string
  fileName: string | null
  fileSize: number | null
  columns: string[]
  sampleRows: { rowNumber: number; values: (string | null)[] }[]
  rowsScanned: number
  totalRows: number | null // exact when the whole (sent) file was read
  estimatedTotalRows: number | null
  idCandidates: string[] // unique + always filled in the scanned rows; best first
  suggestedIdColumn: string | null
  problems: Problem[]
}

// GET /data-sources/:id/records → one page of rows of the live version
export type RecordsPage = {
  columns: string[]
  idColumn: string
  total: number | null // rows in the live version; null for searches
  records: { position: number; id: string; values: (string | null)[] }[]
  next: { afterPosition: number } | { afterId: string } | null // null = last page
}

export type ImportMode = 'replace' | 'merge'

// ---------- APIs (Phase 2) ----------

export type FeedType = 'product' | 'review' | 'store' | 'content'
export type ApiStatus = 'draft' | 'published'

export type Api = {
  id: string
  name: string
  slug: string
  path: string // "/v1/<brand-slug>/<api-slug>"
  feedType: FeedType
  status: ApiStatus
  designVersion: number // 0 = no design saved yet (Phase 3)
  authHeader: AuthHeaderStyle // how Jivox sends the token (Phase 4)
  publishedAt: string | null
  dataSource: { id: string; name: string; idColumn: string; rowCount: number; hasData: boolean }
  createdAt: string
  updatedAt: string
}

// ---------- Design (Phase 3) ----------

export type FieldType = 'string' | 'int' | 'float' | 'boolean' | 'image'
export type Tier = 'mandatory' | 'expected' | 'optional'

// GET /api/jivox/feed-schemas/:feedType → { feedSchema }: the Jivox columns of a feed type.
export type JivoxField = { name: string; tier: Tier; description: string; example: string; typeHint: FieldType }
export type FeedSchema = { feedType: FeedType; idColumn: string; fields: JivoxField[] }

// One sent field: which Jivox column it fills, from which of our columns, under which key.
export type DesignField = {
  jivoxColumn: string
  sourceColumn: string
  responseKey: string
  type: FieldType
  typeInContract: boolean // false = the contract leaves `type` out (Jivox uses its own)
  default: string // "" = no default: then onEmpty decides
  // A value that isn't of `type`: "send" = as written (text) · "default" = like an empty value
  onMismatch: 'send' | 'default'
  // No value and no default: "empty_string" = sent as "" (the default) · "omit" = the key is left out
  onEmpty: 'empty_string' | 'omit'
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type Literal = string | number | boolean

// HOW Jivox calls the API (contract/1 request template).
export type RequestTemplate = {
  method: 'GET' | 'POST'
  query?: Record<string, Literal>
  body?: JsonValue
  maxIdsPerCall: number
}

export type RequestSummary =
  | { method: 'GET'; idParam: string; context: { param: string; source: string }[] }
  | {
      method: 'POST'
      rowsPath: (string | number)[]
      idKey: string
      columns: { key: string; column: string }[]
      context: { path: (string | number)[]; source: string }[]
    }

// GET / PUT /apis/:apiSlug/design
export type DesignState = {
  design: {
    version: number
    saved: boolean
    idField: { jivoxColumn: string; sourceColumn: string; responseKey: string }
    fields: DesignField[]
    request: RequestTemplate
  }
  requestSummary: RequestSummary | null
  data: { idColumn: string; columns: string[] }
  feedType: FeedType
  problems: ErrorDetail[]
  warnings: string[]
  // 5.6: the API's Jivox agents and their fields (the Design tab marks the fields they use)
  agents?: { id: string; name: string; fields: string[] }[]
  // only in a save's answer: what the save did to the agents' contracts
  agentImpact?: { dropped: DroppedAgentFields[]; changed: { id: string; name: string; changes: string[] }[] }
}
// 409 AGENT_FIELDS_DROPPED (extra.agents) and agentImpact.dropped: who loses which fields, and
// how many of its fields the design still answers (0 = no contract can be made for it)
export type DroppedAgentFields = { id: string; name: string; fields: string[]; left: number }

export type DesignInput = {
  idField: { responseKey: string }
  fields: DesignField[]
  request?: RequestTemplate
}

// GET /apis/:apiSlug/design/columns: which types fit each column (first 10 000 rows).
export type ColumnInfo = {
  name: string
  isId: boolean
  filled: number
  empty: number
  fits: { int: number; float: number; boolean: number; image: number }
  candidates: FieldType[] // best first; [] = no values to judge
  suggestedType: FieldType | null
  examples: string[]
}
export type ColumnTypes = { sampledRows: number; columns: ColumnInfo[] }

// POST /apis/:apiSlug/design/check-values: counted over EVERY row.
export type ValueCheck = {
  sourceColumn: string
  type: FieldType
  empty: number
  cantConvert: number
  examples: { row: number; id: string; value: string }[]
}

// POST /apis/:apiSlug/design/preview
export type DesignPreview = {
  request:
    | { method: 'GET'; path: string; query: Record<string, Literal>; url: string }
    | { method: 'POST'; path: string; body: JsonValue }
  response: {
    status: 'success'
    generated_at: string
    data: Record<string, Literal>[]
    errors: { error_id: string; error_code: string; error_message: string }[]
  }
  responseHeaders: Record<string, string>
  notes: { id: string; responseKey: string; column: string; value: string | null; used: string }[]
  warnings: string[]
}

// ── Phase 4: API tokens (task 4.2 backend; screens in 4.6) ──
export type AuthHeaderStyle = 'x-api-key' | 'bearer'
export type TokenState = 'active' | 'expired' | 'revoked'
export type TokenInfo = {
  id: string
  name: string
  hint: string // "rtk_8Hf2"
  state: TokenState
  canShow: boolean // false: revoked, or saved with another encryption key (renew it)
  expiresAt: string | null // null = never
  revokedAt: string | null
  lastUsedAt: string | null
  createdAt: string
}
export type TokenList = { tokens: TokenInfo[]; authHeader: AuthHeaderStyle; limits: { maxTokens: number } }
export type NewToken = { token: string; tokenInfo: TokenInfo; replaced?: TokenInfo; agentsMoved?: number } // agentsMoved: renew only (Jivox agents now on the new token)

// ── Phase 4: Test tab (task 4.5 endpoints; screens 4.7) ──
export type TestRequest = {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  query?: Record<string, string | number | boolean>
  body?: unknown
}
export type TestResponse = { status: number; headers: Record<string, string>; body: unknown }
// POST /try: what /v1 would answer (in-app, saved design, no token; drafts too)
export type TryResult = {
  mode: 'in-app'
  status: 'draft' | 'published'
  designVersion: number
  ids: string[] // asked for (the first rows when none were sent)
  request: TestRequest
  curl: string // with "<your token>"
  response: TestResponse
  durationMs: number
}
export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip'
export type SelfCheckItem = { id: string; label: string; status: CheckStatus; detail: string }
// POST /self-check: Jivox's verification checks. passed = live call made + no ✗.
export type SelfCheckResult = {
  mode: 'live' | 'in-app'
  url: string
  ids: string[]
  passed: boolean
  checks: SelfCheckItem[]
  request: TestRequest
  response: TestResponse | null
  durationMs: number | null
}
// GET …/recent-calls (task 4.8b): the last 5 calls to the live URL, newest first. Never a token.
export type RecentCallTokenKind = 'this_api' | 'other_api' | 'unknown' | 'not_checked' | 'none'
export type RecentCall = {
  id: string
  at: string
  method: string
  path: string // path + query (token-shaped text scrubbed), ≤ 2 KB
  status: number | null // null = the caller hung up before the answer
  durationMs: number
  errorCode: string | null
  errorMessage: string | null
  tokenKind: RecentCallTokenKind
  tokenName: string | null // only for this_api
  header: 'x_api_key' | 'bearer' | null
  idCount: number | null // null = failed before the ids were read
  ids: string[] // the first 10
  found: number | null
  body: string | null // the first 2 KB as sent (scrubbed)
  bodyBytes: number
  userAgent: string | null
  ip: string | null
}
export type RecentCalls = { calls: RecentCall[]; kept: number; clearedAt: string | null }
export type PublishReason = { code: 'NO_DESIGN' | 'DESIGN_INVALID' | 'NO_DATA' | 'NO_ACTIVE_TOKEN'; message: string }
export type PublishCheck = { status: 'draft' | 'published'; publishedAt: string | null; canPublish: boolean; reasons: PublishReason[] }

// ---------- Jivox agents + contracts (Phase 5, tasks 5.2–5.4) ----------
// What Jivox told us about an agent ("Read from Jivox", read-only MCP tools).
export type JivoxFacts = {
  feedType: string
  idColumn: string
  boundFields: string[]
  credential: string | null
  serviceTokenRegistered: boolean | null
  schema: { name: string; type: string; tier: string; isId: boolean; group: string | null }[]
  contracts: { activeVersion: number | null; versions: unknown[] }
  readAt: string
}
export type Agent = {
  id: string
  name: string
  brandstore: string | null
  fields: string[] // Jivox column names
  sampleIds: string[] // [] = the first 2 rows
  token: { id: string; name: string; hint: string; state: TokenState } | null
  mcpUrl: string | null
  accessKey: { hint: string; readable: boolean } | null // the key itself is never sent back
  jivox: JivoxFacts | null
  lastError: string | null
  contract: ContractState
  createdAt: string
  updatedAt: string
}
export type AgentList = { agents: Agent[]; limits: { maxAgents: number } }
// 5.6: the contract last copied / downloaded, and whether today's differs from it.
//   last null → never taken · outOfDate null → unknown (no design to compare with)
export type ContractState = {
  last: { at: string; how: 'copy' | 'download' | 'submit'; designVersion: number } | null
  outOfDate: boolean | null
  changes: string[] // in plain words: "sub_title removed", "Request: GET → POST"
}
// PATCH: only what is sent changes; accessKey: a new one replaces it, null removes it
export type AgentInput = {
  name?: string
  brandstore?: string | null
  fields?: string[]
  tokenId?: string | null
  mcpUrl?: string | null
  accessKey?: string | null
  sampleIds?: string[]
}
export type ContractNote = { level: 'blocker' | 'warning' | 'info'; code: string; field?: string; message: string }
// The generated contract/1 document (task 5.3). Typed loosely: shown as JSON, read for a few keys.
export type ContractDocument = {
  contract_format: string
  feed_type: string
  base_url: string
  service_header: string
  service_value_format: string
  request: { method: 'GET' | 'POST'; path: string; query?: Record<string, unknown>; body?: unknown }
  fields: { column_name: string; at: string; type?: string; default_value: string }[]
  call_rules: { max_ids_per_call: number }
  [key: string]: unknown
}
export type AgentContract = {
  agent: { id: string; name: string }
  document: ContractDocument
  notes: ContractNote[]
  sample: { ids: string[]; request: TestRequest; response: { status: number; body: unknown } }
  apiStatus: 'draft' | 'published'
  designVersion: number
  contract: ContractState
}
export type FixPlace = 'design' | 'agent' | 'studio' | 'publish' | 'tokens' | 'settings' | 'data'
export type ContractCheck = {
  id: string
  group: 'agent' | 'contract' | 'token' | 'live'
  label: string
  status: CheckStatus
  detail: string
  fix?: { place: FixPlace; text: string }
}
export type AgentCheck = {
  agent: { id: string; name: string }
  ready: boolean
  checks: ContractCheck[]
  document: ContractDocument
  sample: { ids: string[]; request: TestRequest; response: { status: number; body: unknown }; live: boolean }
  designVersion: number
  contract: ContractState
}

