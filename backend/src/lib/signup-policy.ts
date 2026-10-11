// Who may create an account (task 6.0). Pure: docs/test-scripts/phase-06-task-6.0-deploy-lib.test.ts.
//   setting undefined → anyone in development / test, NOBODY in production (the app is public)
//   "*"              → anyone
//   "a@x.com,@jivox.com" → exactly those emails, or any email ending in one of the "@domain"s
// Emails are compared lower-case and trimmed (signup lower-cases them too).
export function signupAllowed(email: string, setting: string | undefined, production: boolean): boolean {
  if (setting === undefined || setting.trim() === '') return !production;
  const rules = setting.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
  const e = email.trim().toLowerCase();
  return rules.some((rule) => rule === '*' || (rule.startsWith('@') ? e.endsWith(rule) : e === rule));
}
