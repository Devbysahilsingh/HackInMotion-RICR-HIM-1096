import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from './AuthContext';
import { Spinner } from '@/components/ui/Spinner';

/**
 * The bootstrap screen.
 *
 * Shown only while the silent refresh is in flight. It is not a spinner
 * standing in for nothing: this is the window in which the app genuinely does
 * not know whether it is signed in, and rendering either the dashboard or the
 * login page during it would be a guess.
 */
function BootstrapScreen() {
  const { t } = useTranslation('auth');

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-3 text-ink-500"
      data-testid="auth-bootstrapping"
      role="status"
      aria-live="polite"
    >
      <Spinner size="lg" className="text-brand-600" />
      <p className="text-sm">{t('restoringSession')}</p>
    </div>
  );
}

/**
 * Guards the authenticated half of the app.
 *
 * On failure it redirects to `/login` carrying the URL that was wanted, so
 * signing in lands the farmer where they were going rather than dumping them
 * on the dashboard (architecture.md: "login redirect preserving intent URL").
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'bootstrapping') return <BootstrapScreen />;

  if (status === 'anonymous') {
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }

  return <Outlet />;
}

/**
 * The mirror image: an already-signed-in farmer has no business on the login
 * or register screen, so they go to the dashboard — or back to whatever they
 * were trying to reach when the guard bounced them here.
 */
export function RequireGuest() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'bootstrapping') return <BootstrapScreen />;

  if (status === 'authenticated') {
    const intended = (location.state as { from?: string } | null)?.from;
    // Not `/dashboard`: a brand-new account belongs on onboarding, and that is
    // decided from the account's own data by `PostAuthLanding` at `/`. Sending
    // everyone to the dashboard here is what used to override the register
    // screen's redirect and strand new farmers on an empty dashboard.
    return <Navigate to={intended && intended !== '/login' ? intended : '/'} replace />;
  }

  return <Outlet />;
}
