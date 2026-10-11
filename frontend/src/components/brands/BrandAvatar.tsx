import { cn } from '@/lib/utils'

// Each brand gets a stable colour picked from its slug (same brand → same colour, always).
const COLORS = [
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
]

function colorFor(slug: string) {
  let hash = 0
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return COLORS[hash % COLORS.length]
}

// "Acme Shoes" → "AS", "Bolt" → "BO"
function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : name.trim().slice(0, 2)
  return letters.toUpperCase()
}

export function BrandAvatar({
  name,
  slug,
  size = 'md',
}: {
  name: string
  slug: string
  size?: 'md' | 'lg'
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl font-semibold',
        size === 'lg' ? 'size-14 text-lg' : 'size-10 text-sm',
        colorFor(slug),
      )}
    >
      {initialsOf(name)}
    </div>
  )
}
