// The ready-to-copy curl command for an API (Test tab). The token is a placeholder unless one
// is passed (the browser fills in a real one it already has, e.g. right after creating it).
export const TOKEN_PLACEHOLDER = '<your token>';

export function tokenHeader(style: 'x_api_key' | 'bearer', token = TOKEN_PLACEHOLDER): [string, string] {
  return style === 'bearer' ? ['Authorization', `Bearer ${token}`] : ['X-Api-Key', token];
}

// Single quotes are safe in a shell except for ' itself: close, escape, reopen.
const q = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

// `rawBody`: a body as it was sent (the call log, task 7.3; any method, maybe not JSON), with its
// own Content-Type. Otherwise a POST sends `body` as JSON.
export function buildCurl(input: { method: string; url: string; header: [string, string]; body?: unknown; rawBody?: string; contentType?: string }) {
  const lines = [`curl -s ${input.method !== 'GET' ? `-X ${input.method} ` : ''}${q(input.url)}`, `  -H ${q(`${input.header[0]}: ${input.header[1]}`)}`];
  if (input.rawBody !== undefined) {
    lines.push(`  -H ${q(`Content-Type: ${input.contentType ?? 'application/json'}`)}`, `  --data-binary ${q(input.rawBody)}`);
  } else if (input.method === 'POST') {
    lines.push(`  -H ${q('Content-Type: application/json')}`, `  -d ${q(JSON.stringify(input.body))}`);
  }
  return lines.join(' \\\n');
}
