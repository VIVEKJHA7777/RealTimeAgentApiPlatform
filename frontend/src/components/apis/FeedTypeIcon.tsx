import { feedTypeInfo } from '@/lib/feed-types'
import type { FeedType } from '@/lib/api-types'
import { cn } from '@/lib/utils'

// The coloured square with the feed type's icon, used on cards and page headers.
export function FeedTypeIcon({ feedType, size = 'md' }: { feedType: FeedType; size?: 'md' | 'lg' }) {
  const { icon: Icon, tone, label } = feedTypeInfo(feedType)
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl',
        size === 'lg' ? 'size-12' : 'size-10',
        tone,
      )}
      title={`${label} feed`}
    >
      <Icon className={size === 'lg' ? 'size-6' : 'size-5'} aria-hidden="true" />
    </div>
  )
}
