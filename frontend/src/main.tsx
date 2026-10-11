import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { AuthProvider } from '@/auth/AuthProvider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'
import App from './App.tsx'

// Entry point: mounts React into <div id="root"> in index.html.
//   RouterProvider lets pages change the URL without reloading the browser. A "data router"
//                  (createBrowserRouter) instead of <BrowserRouter> only because it enables
//                  useBlocker ("you have unsaved changes" on the Design tab, task 3.7); the
//                  pages themselves are still the <Routes> in App.tsx (one catch-all route).
//   AuthProvider   knows who is logged in; every page can ask with useAuth()
//   Toaster        shows the small pop-up messages (toast.success / toast.error)
//   TooltipProvider lets any component show a tooltip (one shared hover delay)
// Dark mode is handled by a small script in index.html (follows the computer's setting).
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <AuthProvider>
        <TooltipProvider delayDuration={300}>
          <App />
        </TooltipProvider>
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    ),
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
