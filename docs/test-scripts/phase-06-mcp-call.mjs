// Calls ONE tool on an MCP server the way our backend does (JSON-RPC over HTTP, SSE or JSON answer)
// and prints what came back as one JSON line (task 6.2 tests):
//   { result: <the tool's JSON> } · { toolError: "<text>" } · { http: <status>, body } · { rpcError }
// The key comes from the MCP_KEY environment variable (never on the command line).
//   MCP_KEY=… node phase-06-mcp-call.mjs <mcp url> <tool> '<arguments JSON>'
const [url, tool, args = '{}'] = process.argv.slice(2);
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${process.env.MCP_KEY}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: JSON.parse(args) } }),
});
const text = await res.text();
if (!res.ok) { console.log(JSON.stringify({ http: res.status, body: text.slice(0, 300) })); process.exit(0); }
const json = JSON.parse(text.startsWith('event:') || text.startsWith('data:') ? text.split('\n').find((l) => l.startsWith('data: ')).slice(6) : text);
if (json.error) console.log(JSON.stringify({ rpcError: json.error }));
else if (json.result.isError) console.log(JSON.stringify({ toolError: json.result.content?.[0]?.text }));
else console.log(JSON.stringify({ result: JSON.parse(json.result.content[0].text) }));
