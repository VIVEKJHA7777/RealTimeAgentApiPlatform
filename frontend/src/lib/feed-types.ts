import { FileText, Package, Star, Store, type LucideIcon } from 'lucide-react'
import type { FeedType } from '@/lib/api-types'

// The four Jivox feed types (contract/1 "feed_type"), with how we show them.
export const FEED_TYPES: {
  value: FeedType
  label: string
  hint: string
  icon: LucideIcon
  tone: string // icon tile colours (light + dark)
}[] = [
  { value: 'product', label: 'Product', hint: 'Prices, stock, badges', icon: Package, tone: 'bg-primary/10 text-primary' },
  { value: 'review', label: 'Review', hint: 'Ratings and reviews', icon: Star, tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  { value: 'store', label: 'Store', hint: 'Locations, opening hours', icon: Store, tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  { value: 'content', label: 'Content', hint: 'Text, banners, labels', icon: FileText, tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
]

export function feedTypeInfo(feedType: FeedType) {
  return FEED_TYPES.find((type) => type.value === feedType) ?? FEED_TYPES[0]
}
