import { Compass } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/PageStates'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={
          <Button asChild variant="outline">
            <Link to="/">Back to your brands</Link>
          </Button>
        }
      />
    </div>
  )
}
