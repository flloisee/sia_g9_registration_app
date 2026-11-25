import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { EventPage } from '@/pages/EventPage';
import { EventsPage } from '@/pages/EventsPage';
import { HomePage } from '@/pages/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// Staff pulls in the QR decoding library; keep it off the public pages.
const StaffPage = lazy(() =>
  import('@/pages/StaffPage').then((module) => ({ default: module.StaffPage })),
);
// Unlisted admin panel — never linked from the public navigation.
const AdminPage = lazy(() =>
  import('@/pages/AdminPage').then((module) => ({ default: module.AdminPage })),
);

export default function App() {
  return (
    <>
      <Pageviews />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="events/:id" element={<EventPage />} />
          <Route
            path="staff"
            element={
              <Suspense fallback={<PageLoading />}>
                <StaffPage />
              </Suspense>
            }
          />
          <Route
            path="dev/admin"
            element={
              <Suspense fallback={<PageLoading />}>
                <AdminPage />
              </Suspense>
            }
          />
          <Route path="scan" element={<Navigate to="/staff?tab=checkin" replace />} />
          <Route path="attendees" element={<Navigate to="/staff?tab=attendees" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}

function Pageviews() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    fetch('/api/telemetry/pageview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: pathname + search, referrer: document.referrer }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname, search]);
  return null;
}

function PageLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl py-16 text-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}
