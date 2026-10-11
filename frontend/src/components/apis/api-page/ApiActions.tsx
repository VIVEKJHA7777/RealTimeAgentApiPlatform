import { CloudOff, Ellipsis, Pencil, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Api, DataSource, Organization } from '@/lib/api-types'
import { DeleteApiDialog } from './DeleteApiDialog'
import { EditApiDialog } from './EditApiDialog'
import { PublishButton } from './PublishButton'
import { UnpublishDialog } from './UnpublishDialog'

// The API page header's buttons: Publish (drafts), Edit, and ⋯ (more) → Unpublish (published) / Delete API.
// The dialogs are opened by state (not nested inside the menu), so the menu can close first.
export function ApiActions({
  organization,
  api,
  dataSource,
  onChanged,
  readinessTick,
}: {
  organization: Organization
  api: Api
  dataSource: DataSource
  onChanged: () => Promise<void> | void
  readinessTick: number
}) {
  const [editing, setEditing] = useState(false)
  const [unpublishing, setUnpublishing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // The dialogs aren't opened by Radix triggers (state + a menu), so we tell them where keyboard
  // focus goes back when they close: the button that opened them.
  const editRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="flex shrink-0 items-center gap-2">
      <PublishButton organization={organization} api={api} readinessTick={readinessTick} onChanged={onChanged} />
      <Button ref={editRef} variant="outline" onClick={() => setEditing(true)}>
        <Pencil />
        Edit
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={moreRef} variant="outline" size="icon" aria-label="More actions">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {api.status === 'published' && (
            <>
              <DropdownMenuItem onSelect={() => setUnpublishing(true)}>
                <CloudOff />
                Unpublish
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 />
            Delete API
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditApiDialog open={editing} onOpenChange={setEditing} organization={organization} api={api} onSaved={onChanged} returnFocusTo={editRef} />
      <UnpublishDialog open={unpublishing} onOpenChange={setUnpublishing} brandSlug={organization.slug} api={api} onDone={onChanged} returnFocusTo={moreRef} />
      <DeleteApiDialog open={deleting} onOpenChange={setDeleting} brandSlug={organization.slug} api={api} dataSource={dataSource} returnFocusTo={moreRef} />
    </div>
  )
}
