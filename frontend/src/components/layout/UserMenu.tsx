import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useAuth } from '@/auth/useAuth'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// "Alice Smith" → "AS", no name → first 2 letters of the email ("al").
function initialsOf(name: string | null, email: string) {
  const source = name?.trim() || email
  const words = source.split(/[\s@._-]+/).filter(Boolean)
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : source.slice(0, 2)
  return letters.toUpperCase()
}

// Avatar in the header → menu with name, email and "Log out".
export function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)

  if (!user) return null

  async function handleLogout() {
    if (loggingOut) return // ignore double clicks
    setLoggingOut(true)
    // Never throws: logs out locally even if the server can't be reached.
    const serverConfirmed = await logout()
    if (serverConfirmed) {
      toast.success('Logged out')
    } else {
      toast.warning("Logged out on this device. The server couldn't be reached.")
    }
    navigate('/login', { replace: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label="Account menu"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
            {initialsOf(user.name, user.email)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{user.name ?? 'Your account'}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={loggingOut} onSelect={handleLogout}>
          <LogOut />
          {loggingOut ? 'Logging out…' : 'Log out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
