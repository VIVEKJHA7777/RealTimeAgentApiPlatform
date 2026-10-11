// A FAKE Jivox data MCP server for tests (Phase 5+). Answers like qa3 did in task 5.0 (from the
// snapshot in docs/jivox/mcp-snapshot-2026-10-12/), and can act out failures, chosen by the path:
//   /ok            SSE answers (like qa3)          /json         plain JSON answers
//   /auth          401 (wrong key)                 /garbage      not JSON-RPC
//   /tool-error    the tool answers isError        /big          a 3 MB answer
//   /redirect      302 to another host             /review       feed_type "review"
//   /slow          waits 3 s before answering      /mandatory    bound fields incl. product_name + unknown
//   /bound/<a,b>   bound fields a, b               /unregistered  no token registered in Studio
//   (any path) only the key in VALID_KEY works, except /auth
// Every request is appended to the log file as one JSON line: { path, method, tool, auth }.
// Write tools (submit_contract / activate_contract) are logged and answered with an error, so a
// test can prove they were never called.
//   node phase-05-fake-jivox-mcp.mjs <port> <log file> <valid key>   (not port 4190: fetch refuses it)
import { appendFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [port, logFile, VALID_KEY] = process.argv.slice(2);
const snap = new URL('../jivox/mcp-snapshot-2026-10-12/', import.meta.url);
const read = (f) => JSON.parse(readFileSync(new URL(f, snap), 'utf8'));
const SCHEMA = read('get_canonical_schema.json');
const SPEC = read('get_contract_spec.json');
const LIST = read('list_contracts.json');
const TOOLS = read('tools-list.json');

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const path = new URL(req.url, 'http://x').pathname;
    let msg = {};
    try { msg = JSON.parse(body); } catch {}
    appendFileSync(logFile, JSON.stringify({ path, method: msg.method, tool: msg.params?.name, auth: req.headers.authorization ?? null }) + '\n');
    const send = (status, obj, sse = true) => {
      const text = JSON.stringify(obj);
      res.writeHead(status, { 'Content-Type': sse ? 'text/event-stream' : 'application/json' });
      res.end(sse ? `event: message\ndata: ${text}\n\n` : text);
    };
    if (path === '/auth' || req.headers.authorization !== `Bearer ${VALID_KEY}`) {
      return send(401, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32600, message: 'Missing or malformed Authorization header' } }, false);
    }
    if (path === '/redirect') { res.writeHead(302, { Location: 'https://example.com/elsewhere' }); return res.end(); }
    if (path === '/garbage') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>hello</html>'); }
    if (path === '/slow') await new Promise((r) => setTimeout(r, 3000));
    if (msg.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
    const sse = path !== '/json';
    const ok = (result) => send(200, { jsonrpc: '2.0', id: msg.id, result }, sse);
    const text = (obj) => ok({ content: [{ type: 'text', text: JSON.stringify(obj) }], isError: false });
    if (msg.method === 'initialize') return ok({ protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'Fake Brandstore MCP', version: '0' } });
    if (msg.method === 'tools/list') return ok(TOOLS);
    if (msg.method !== 'tools/call') return send(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }, sse);
    const tool = msg.params?.name;
    if (path === '/big') return text({ junk: 'x'.repeat(3 * 1024 * 1024) });
    if (path === '/tool-error') return ok({ content: [{ type: 'text', text: 'agent not found' }], isError: true });
    if (tool === 'get_canonical_schema') {
      let bound = SCHEMA.bound_fields;
      if (path === '/mandatory') bound = ['product_name', 'sub_title', 'not_a_field', 'item_id'];
      if (path.startsWith('/bound/')) bound = decodeURIComponent(path.slice(7)).split(',');
      return text({ ...SCHEMA, feed_type: path === '/review' ? 'review' : SCHEMA.feed_type, bound_fields: bound });
    }
    if (tool === 'get_contract_spec') return text(path === '/unregistered' ? { ...SPEC, your_agent: { ...SPEC.your_agent, service_token_registered: false } } : SPEC);
    if (tool === 'list_contracts') return text(path === '/ok' ? LIST : { contracts: [{ version: 1, status: 'verified' }, { version: 2, status: 'active' }], active_version: 2 });
    return ok({ content: [{ type: 'text', text: `write tool ${tool} refused by the fake server` }], isError: true });
  });
}).listen(Number(port), '127.0.0.1', () => console.log(`fake MCP on ${port}`));
