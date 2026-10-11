// Task 5.0: READ-ONLY discovery of a Jivox data MCP server (one Real Time Agent's destination).
// Runs initialize, tools/list, resources/list, prompts/list, then only the read-only tools named on
// the command line (allowlist: get_contract_spec, get_canonical_schema, list_contracts). It can
// never call submit_contract or activate_contract. The access key comes from JIVOX_MCP_KEY and is
// scrubbed from everything printed.
//   read -s JIVOX_MCP_KEY && export JIVOX_MCP_KEY
//   node docs/test-scripts/phase-05-task-5.0-mcp-discovery.mjs https://brandstore-data-mcp.qa3.jivox.com/mcp bearer get_canonical_schema
// Findings: docs/phases/phase-05-contract-generator.md §10; snapshot: docs/jivox/mcp-snapshot-2026-10-12/

const [url, style = 'bearer'] = process.argv.slice(2)
const key = (process.env.JIVOX_MCP_KEY ?? '').trim()
if (!url || !key) { console.error('Usage: JIVOX_MCP_KEY=… node phase-05-task-5.0-mcp-discovery.mjs <mcp url> [bearer|none] [read-only tools…]'); process.exit(1) }
const scrub = (s) => String(s).split(key).join('<KEY>')
let sessionId
let id = 0

function authHeaders() {
  if (style === 'bearer') return { Authorization: `Bearer ${key}` }
  if (style === 'x-api-key') return { 'X-Api-Key': key }
  return {}
}

async function rpc(method, params, notification = false) {
  const body = notification ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++id, method, params }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
      ...(sessionId && { 'Mcp-Session-Id': sessionId }),
      ...authHeaders(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  const sid = res.headers.get('mcp-session-id')
  if (sid) sessionId = sid
  const text = await res.text()
  const info = {
    status: res.status,
    contentType: res.headers.get('content-type'),
    wwwAuthenticate: res.headers.get('www-authenticate'),
    session: sid ? 'yes' : 'no',
  }
  // Streamable HTTP may answer as SSE: take the data lines.
  let parsed = null
  const raw = info.contentType?.includes('text/event-stream')
    ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n')
    : text
  try { parsed = raw ? JSON.parse(raw) : null } catch { parsed = raw.slice(0, 2000) }
  return { info, parsed }
}

const show = (label, r) => console.log(`\n=== ${label} ===\n${scrub(JSON.stringify(r, null, 2))}`)

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'api-platform-discovery', version: '0.1.0' },
})
show(`initialize (auth: ${style})`, init)
if (init.info.status >= 400 || init.parsed?.error) process.exit(2)
await rpc('notifications/initialized', {}, true)
for (const m of ['tools/list', 'resources/list', 'resources/templates/list', 'prompts/list']) show(m, await rpc(m, {}))

// Read-only tools only (allowlist): never submit_contract / activate_contract.
const READ_ONLY = ['get_contract_spec', 'get_canonical_schema', 'list_contracts']
for (const name of process.argv.slice(4)) {
  if (!READ_ONLY.includes(name)) { console.log(`refusing to call ${name}`); continue }
  show(`tools/call ${name}`, await rpc('tools/call', { name, arguments: {} }))
}
