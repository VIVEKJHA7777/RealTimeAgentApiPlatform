// Task 6.0: the pure parts of "ready for a public server": who may sign up, and the attempt limiter.
//   cd backend && npx tsx ../docs/test-scripts/phase-06-task-6.0-deploy-lib.test.ts
import { createRateLimiter } from '../../backend/src/lib/rate-limit.ts';
import { signupAllowed } from '../../backend/src/lib/signup-policy.ts';

let pass = 0, fail = 0;
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`); };

// ── signupAllowed(email, setting, production) ──
eq('not set: open in development, CLOSED in production', [signupAllowed('a@b.com', undefined, false), signupAllowed('a@b.com', undefined, true), signupAllowed('a@b.com', '  ', true)], [true, false, false]);
eq('"*" = anyone (also in production)', signupAllowed('x@y.org', '*', true), true);
const rule = 'Vivek@Jivox.com, @test.com ,,';
eq('exact email (any case, spaces trimmed)', [signupAllowed('vivek@jivox.com', rule, true), signupAllowed(' VIVEK@JIVOX.COM ', rule, true), signupAllowed('vivek2@jivox.com', rule, true)], [true, true, false]);
eq('"@domain" = any email ending in it', [signupAllowed('a@test.com', rule, true), signupAllowed('a@TEST.com', rule, true)], [true, true]);
eq('look-alike domains are NOT in: @test.com.evil.io, @nottest.com, test.com without @', [signupAllowed('a@test.com.evil.io', rule, true), signupAllowed('a@nottest.com', rule, true), signupAllowed('a@b.com', 'test.com', true)], [false, false, false]);

// ── createRateLimiter(limit, windowMs, now) ──
let t = 0;
const lim = createRateLimiter(3, 60_000, () => t);
eq('3 attempts allowed, the 4th refused with the seconds to wait', [lim.hit('ip1'), lim.hit('ip1'), lim.hit('ip1'), lim.hit('ip1')], [null, null, null, 60]);
t = 45_000;
eq('still refused 45 s later (15 s left); another key is independent', [lim.hit('ip1'), lim.hit('ip2')], [15, null]);
t = 60_000;
eq('window over → allowed again (a new window starts)', [lim.hit('ip1'), lim.hit('ip1'), lim.hit('ip1'), lim.hit('ip1')], [null, null, null, 60]);
t = 10 * 60_000;
lim.hit('ip3');
eq('old windows are swept (memory stays small)', lim.size(), 1);
const many = createRateLimiter(1, 1000, () => t);
for (let i = 0; i < 10_000; i++) many.hit(`k${i}`);
t += 2000; many.hit('fresh');
eq('10 000 keys, then one window later → only the new one kept', many.size(), 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
