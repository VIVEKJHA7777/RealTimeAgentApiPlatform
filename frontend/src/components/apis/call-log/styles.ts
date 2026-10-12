// Classes shared by the Logs tab, its drawer and Recent calls (task 7.5). Kept out of the component
// files so fast refresh keeps working; Tailwind finds them here too (whole class names only).
import type { Tone } from '@/lib/recent-calls'

// Desktop columns (container ≥ 3xl); a phone gets two lines per call instead. Written out in
// full: Tailwind only makes classes it finds as whole words in the source.
export const LIST_COLUMNS = '@3xl:grid-cols-[4.5rem_3rem_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_3.5rem_minmax(0,0.9fr)_3.5rem]'

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  partial: 'text-amber-700 dark:text-amber-400',
  fail: 'text-destructive',
}
export const TONE_PILL: Record<Tone, string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  partial: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  fail: 'bg-destructive/10 text-destructive',
}
