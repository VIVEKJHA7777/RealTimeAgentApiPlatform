import { Route, Routes } from 'react-router'
import { RedirectIfAuthed } from '@/auth/RedirectIfAuthed'
import { RequireAuth } from '@/auth/RequireAuth'
import { AppLayout } from '@/components/layout/AppLayout'
import { OverviewTab } from '@/components/apis/api-page/OverviewTab'
import { DataTab } from '@/components/apis/data/DataTab'
import { DesignTab } from '@/components/apis/design/DesignTab'
import { JivoxTab } from '@/components/apis/jivox/JivoxTab'
import { TestTab } from '@/components/apis/test/TestTab'
import { ApiPage } from '@/pages/ApiPage'
import { BrandPage } from '@/pages/BrandPage'
import { BrandsPage } from '@/pages/BrandsPage'
import { CreateApiPage } from '@/pages/CreateApiPage'
import { CreateBrandPage } from '@/pages/CreateBrandPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { SignupPage } from '@/pages/SignupPage'

// URL → page mapping.
//   Logged-out pages (/login, /signup): logged-in users are sent into the app.
//   Everything else needs a login, and is shown inside AppLayout (sidebar + header).
export default function App() {
  return (
    <Routes>
      <Route element={<RedirectIfAuthed />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<BrandsPage />} />
          {/* "new" is a reserved slug, so this never clashes with /brands/:slug */}
          <Route path="/brands/new" element={<CreateBrandPage />} />
          <Route path="/brands/:slug" element={<BrandPage />} />
          {/* "new" is a reserved API slug, so this never clashes with /apis/:apiSlug */}
          <Route path="/brands/:slug/apis/new" element={<CreateApiPage />} />
          {/* The API page is a frame (header + tabs); each tab is a child route with its own address. */}
          <Route path="/brands/:slug/apis/:apiSlug" element={<ApiPage />}>
            <Route index element={<OverviewTab />} />
            <Route path="data" element={<DataTab />} />
            <Route path="design" element={<DesignTab />} />
            <Route path="test" element={<TestTab />} />
            <Route path="jivox" element={<JivoxTab />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
