// Pure helpers for the Test tab (task 4.7). Tested by docs/test-scripts/phase-04-task-4.7-testing-lib.test.ts.
import type { CheckStatus, SelfCheckResult } from './api-types'

export const TOKEN_PLACEHOLDER = '<your token>' // what the server puts in curl commands
export const MAX_TEST_IDS = 100

// The ids box: "SKU-1, SKU-2" or one per line. Spaces trimmed, empty parts dropped, each id once.
// [] = let the server pick the first rows.
export function idsFromText(text: string): { ids: string[] } | { error: string } {
  const ids = [...new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))]
  if (ids.length > MAX_TEST_IDS) return { error: `At most ${MAX_TEST_IDS} ids (you have ${ids.length})` }
  const long = ids.find((id) => id.length > 500)
  if (long) return { error: `An id is longer than 500 characters ("${long.slice(0, 20)}…")` }
  return { ids }
}

// The self-check's headline.
export type Verdict = { tone: 'pass' | 'warn' | 'fail'; title: string; text: string }
export function selfCheckVerdict(result: SelfCheckResult): Verdict {
  const failed = result.checks.filter((c) => c.status === 'fail')
  const warned = result.checks.filter((c) => c.status === 'warn')
  if (result.passed) {
    return warned.length
      ? { tone: 'warn', title: 'Passed, with a warning', text: warned.map((c) => c.label).join(' · ') }
      : { tone: 'pass', title: 'Passed', text: "Jivox's verification would accept this answer." }
  }
  if (result.mode === 'in-app' && failed.every((c) => c.id === 'published' || c.id === 'token')) {
    return {
      tone: 'warn',
      title: 'The answer looks right',
      text: 'Checked inside the app. Publish the API and keep an active token to run the real check over the network.',
    }
  }
  return { tone: 'fail', title: `${failed.length} check${failed.length === 1 ? '' : 's'} failed`, text: failed.map((c) => c.label).join(' · ') }
}

export const CHECK_ORDER: CheckStatus[] = ['fail', 'warn', 'pass', 'skip']
