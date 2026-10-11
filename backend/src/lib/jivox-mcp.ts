// A small client for Jivox's data MCP server (one Real Time Agent's "MCP destination"), task 5.2.
// What 5.0 discovery found on qa3 (docs/phases/phase-05-contract-generator.md §10):
//   JSON-RPC 2.0 over HTTPS (Streamable HTTP), stateless (no session), answers as SSE or JSON,
//   auth "Authorization: Bearer <agent's MCP access key>"; tools answer with one text item (JSON).
// Phase 5 calls ONLY the read-only tools (P5-14); submit / activate come in Phase 6.
// The access key never leaves this module except in the Authorization header, and is scrubbed from
// every error message.

const READ_ONLY_TOOLS = ['get_canonical_schema', 'get_contract_spec', 'list_contracts'] as const;
export type ReadOnlyTool = (typeof READ_ONLY_TOOLS)[number];

const TIMEOUT_MS = 20_000;
const MAX_ANSWER_BYTES = 2 * 1024 * 1024; // the spec answer is ~16 KB; anything huge is wrong
const PROTOCOL_VERSION = '2025-06-18';

// Why a call failed, in words for the user (never containing the key).
export class JivoxMcpError extends Error {
  constructor(
    public readonly kind: 'unreachable' | 'auth' | 'protocol' | 'tool',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'JivoxMcpError';
  }
}

export function createJivoxMcpClient(url: string, accessKey: string) {
  let nextId = 0;
  const scrub = (text: string) => (accessKey ? text.split(accessKey).join('<access key>') : text);

  async function rpc(method: string, params: Record<string, unknown>, notification = false): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': PROTOCOL_VERSION,
          Authorization: `Bearer ${accessKey}`,
        },
        body: JSON.stringify(notification ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++nextId, method, params }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error', // never follow a redirect elsewhere with the key
      });
    } catch (err) {
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      // The underlying reason says most: ECONNREFUSED, ENOTFOUND, "bad port", a TLS problem…
      const reason = (err as Error).name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000} s` : scrub(cause?.code ?? cause?.message ?? (err as Error).message);
      throw new JivoxMcpError('unreachable', `Couldn't reach the Jivox MCP destination (${reason}).`, { cause: err });
    }
    const text = await readLimited(res);
    if (res.status === 401 || res.status === 403) {
      throw new JivoxMcpError('auth', 'Jivox refused the access key. Copy it again from Studio (Real-time data → the agent → access keys).');
    }
    if (notification) return null;
    if (!res.ok) throw new JivoxMcpError('protocol', `The Jivox MCP destination answered HTTP ${res.status}.`);
    const message = parseAnswer(text, res.headers.get('content-type') ?? '');
    if (message.error) throw new JivoxMcpError('protocol', `Jivox MCP error: ${scrub(String(message.error.message ?? 'unknown')).slice(0, 300)}`);
    return message.result;
  }

  async function readLimited(res: Response) {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_ANSWER_BYTES) {
        await reader.cancel();
        throw new JivoxMcpError('protocol', 'The Jivox MCP destination sent an answer that is far too large.');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  // One JSON-RPC message, sent as plain JSON or as SSE "data:" lines.
  function parseAnswer(text: string, contentType: string): { result?: unknown; error?: { message?: unknown } } {
    const raw = contentType.includes('text/event-stream')
      ? text
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
      : text;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // fall through
    }
    throw new JivoxMcpError('protocol', "The Jivox MCP destination didn't answer in the expected format.");
  }

  let initialized = false;
  async function initialize() {
    if (initialized) return;
    await rpc('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'api-platform', version: '0.5.0' } });
    await rpc('notifications/initialized', {}, true);
    initialized = true;
  }

  // A read-only tool's answer: its text content, parsed as JSON.
  async function callReadOnly<T = unknown>(name: ReadOnlyTool): Promise<T> {
    if (!READ_ONLY_TOOLS.includes(name)) throw new Error(`Not a read-only tool: ${name}`); // belt and braces for callers without types
    await initialize();
    const result = (await rpc('tools/call', { name, arguments: {} })) as { content?: { type?: string; text?: string }[]; isError?: boolean } | null;
    const text = (result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    if (result?.isError) throw new JivoxMcpError('tool', `Jivox couldn't answer ${name}: ${scrub(text).slice(0, 300)}`);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new JivoxMcpError('protocol', `Jivox's ${name} answer isn't JSON.`);
    }
  }

  return { callReadOnly };
}
