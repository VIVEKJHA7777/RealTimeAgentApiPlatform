// Task 5.4: the base-URL rule of the checklist (the one check that can't pass on a localhost machine,
// so the scenario script can't show its ✓). Jivox calls from outside: https and not this machine.
//   cd backend && npx tsx ../docs/test-scripts/phase-05-task-5.4-checklist-lib.test.ts
import { baseUrlCheck } from '../../backend/src/modules/apis/agents/contract-check.ts';
let pass = 0, fail = 0;
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`); };
const s = (u: string) => baseUrlCheck(u).status;
eq('public https (tunnel / deployed) → ✓', ['https://abc.trycloudflare.com/v1/acme', 'https://api.example.com/v1/acme', 'https://10-0-0-1.example.org/v1/x'].map(s), ['pass', 'pass', 'pass']);
eq('this machine → ✗ (localhost, 127.0.0.1, [::1], 0.0.0.0, *.localhost), even with https', ['http://localhost:4000/v1/a', 'https://localhost/v1/a', 'http://127.0.0.1:4000/v1/a', 'http://[::1]:4000/v1/a', 'http://0.0.0.0:4000/v1/a', 'https://app.localhost/v1/a'].map(s), ['fail', 'fail', 'fail', 'fail', 'fail', 'fail']);
eq('public but plain http → ✗ "needs an https address"', [s('http://api.example.com/v1/a'), baseUrlCheck('http://api.example.com/v1/a').detail.includes('https')], ['fail', true]);
eq('localhost ✗ says why and where to fix it', [baseUrlCheck('http://localhost:4000/v1/a').detail.includes("can't reach this machine"), baseUrlCheck('http://localhost:4000/v1/a').fix?.place], [true, 'settings']);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
