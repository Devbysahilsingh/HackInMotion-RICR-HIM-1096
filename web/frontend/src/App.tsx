import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { RequireAuth, RequireGuest } from '@/auth/guards';
import { PostAuthLanding } from '@/auth/PostAuthLanding';
import { AppLayout } from '@/components/layout/AppLayout';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Route table (docs/frontend/routes.md).
 *
 * Every page below the guard is lazily loaded, so a farmer on a 3G connection
 * downloads the login screen and nothing else before signing in. The two auth
 * pages are eager: they are the entry point, and a chunk fetch there would put
 * a spinner in front of the very first screen.
 */
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const FarmListPage = lazy(() => import('@/pages/farms/FarmListPage'));
const FarmFormPage = lazy(() => import('@/pages/farms/FarmFormPage'));
const FarmDetailPage = lazy(() => import('@/pages/farms/FarmDetailPage'));
const CropFormPage = lazy(() => import('@/pages/crops/CropFormPage'));
const CropDetailPage = lazy(() => import('@/pages/crops/CropDetailPage'));
const ScanPage = lazy(() => import('@/pages/health/ScanPage'));
const HealthResultPage = lazy(() => import('@/pages/health/HealthResultPage'));
const SymptomCheckPage = lazy(() => import('@/pages/health/SymptomCheckPage'));
const WeatherPage = lazy(() => import('@/pages/WeatherPage'));
const WeatherIndexPage = lazy(() => import('@/pages/WeatherIndexPage'));
const MarketPage = lazy(() => import('@/pages/MarketPage'));
const MandiDetailPage = lazy(() => import('@/pages/MandiDetailPage'));
const IrrigationPlanPage = lazy(() => import('@/pages/IrrigationPlanPage'));
const YieldPage = lazy(() => import('@/pages/YieldPage'));
const DiseaseDetailPage = lazy(() => import('@/pages/health/DiseaseDetailPage'));
const CropRecDetailPage = lazy(() => import('@/pages/CropRecDetailPage'));
const LanguagePage = lazy(() => import('@/pages/LanguagePage'));
const HistoryPage = lazy(() => import('@/pages/HistoryPage'));
const CropRecommendationPage = lazy(() => import('@/pages/CropRecommendationPage'));
const CommunityPage = lazy(() => import('@/pages/CommunityPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

/**
 * The primitive showcase (component-map.md), which must be **absent from a
 * production bundle** rather than merely unreachable in one.
 *
 * The `lazy()` call has to sit inside the dead branch, not just the `<Route>`
 * that uses it. Vite replaces `import.meta.env.DEV` with the literal `false`
 * at build time, so this whole expression becomes `false ? … : null`, Rollup
 * drops it, the dynamic `import()` loses its only reference, and no chunk is
 * emitted. Written the obvious way — `const X = lazy(…)` at module scope with
 * a conditional route — the chunk ships anyway, because the import is
 * evaluated unconditionally even when nothing renders it.
 */
const ComponentShowcase = import.meta.env.DEV
  ? lazy(() => import('@/pages/dev/ComponentShowcase'))
  : null;

import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';

function RouteFallback() {
  return (
    <div className="flex min-h-40 items-center justify-center py-16 text-brand-600">
      <Spinner size="lg" />
    </div>
  );
}

/**
 * The front door.
 *
 * `/` is public: an anonymous visitor gets the product's landing page instead
 * of being bounced to a login form. A signed-in farmer is forwarded to
 * `/home`, where `PostAuthLanding` decides between dashboard and onboarding
 * from the account's own data — the policy that used to live at the index
 * route, unchanged, one path segment deeper.
 */
function HomeGate() {
  const { status } = useAuth();

  if (status === 'bootstrapping') return <RouteFallback />;
  if (status === 'authenticated') return <Navigate to="/home" replace />;
  return <LandingPage />;
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Public front door — landing for visitors, forwarder for farmers. */}
        <Route path="/" element={<HomeGate />} />

        <Route element={<RequireGuest />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          {/* Onboarding sits outside the shell — it is a full-screen first run. */}
          <Route path="/onboarding" element={<OnboardingPage />} />

          <Route element={<AppLayout />}>
            {/*
              Decides onboarding-vs-dashboard from the account's own data.
              Both the login and register paths funnel through here (via the
              public `/` gate), so the two redirects can no longer race to
              different destinations.
            */}
            <Route path="/home" element={<PostAuthLanding />} />
            <Route path="/dashboard" element={<DashboardPage />} />

            <Route path="/farms" element={<FarmListPage />} />
            <Route path="/farms/new" element={<FarmFormPage mode="create" />} />
            <Route path="/farms/:farmId" element={<FarmDetailPage />} />
            <Route path="/farms/:farmId/edit" element={<FarmFormPage mode="edit" />} />
            <Route path="/farms/:farmId/weather" element={<WeatherPage />} />
            <Route path="/farms/:farmId/crops/new" element={<CropFormPage />} />

            <Route path="/crops/:cropId" element={<CropDetailPage />} />

            <Route path="/scan" element={<ScanPage />} />
            <Route path="/scan/symptoms" element={<SymptomCheckPage />} />
            <Route path="/health/:logId" element={<HealthResultPage />} />

            <Route path="/weather" element={<WeatherIndexPage />} />
            <Route path="/market" element={<MarketPage />} />
            {/*
              One mandi, one commodity. The market name is encoded into the path
              and the commodity rides as a query parameter — a mandi trades many
              things, so the pair is what identifies the series being shown.
            */}
            <Route path="/market/:market" element={<MandiDetailPage />} />

            {/*
              The farm-wide watering plan. Crop-level irrigation still lives on
              each crop's own tab; this is the "should I water anything today?"
              view the design gives its own screen.
            */}
            <Route path="/irrigation" element={<IrrigationPlanPage />} />

            {/*
              Harvest estimates for every crop the farmer owns. Account-wide
              rather than farm-scoped: the estimate depends on the crop's own
              district and area, and a farmer planning a season wants the whole
              holding in one place.
            */}
            <Route path="/yield" element={<YieldPage />} />

            {/* The knowledge base behind a diagnosis, reachable without a scan. */}
            <Route path="/health/disease/:code" element={<DiseaseDetailPage />} />

            {/* Why one candidate scored what it did. Needs farm + season in the query. */}
            <Route path="/crop-recommendation/:cropCode" element={<CropRecDetailPage />} />

            <Route path="/settings/language" element={<LanguagePage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/crop-recommendation" element={<CropRecommendationPage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/settings" element={<SettingsPage />} />

            {/*
              Not a hidden production route (CLAUDE.md rule 2) — a route that
              does not exist in production at all. See the declaration above.
            */}
            {ComponentShowcase && <Route path="/dev/components" element={<ComponentShowcase />} />}
          </Route>
        </Route>

        {/* Localized, with a way home — never a bare browser 404. */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
