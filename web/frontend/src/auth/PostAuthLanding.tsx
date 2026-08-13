import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { farmsApi } from '@/api/endpoints';
import { queryKeys } from '@/api/queryKeys';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Where a farmer lands immediately after authenticating.
 *
 * ## Why this exists
 *
 * `RequireGuest` used to send every authenticated visitor straight to
 * `/dashboard`, while `RegisterPage` separately called
 * `navigate('/onboarding')`. Both fired on the same state change, so the two
 * redirects raced and the guard won: a brand-new account was dropped on the
 * dashboard's empty state instead of onboarding.
 *
 * Deleting one of the two redirects would only have moved the policy somewhere
 * arbitrary. The destination is not a property of *which screen you came from*,
 * it is a property of *the account*: a farmer with no field needs to add one,
 * and a farmer who already has fields wants their dashboard. So both entry
 * points now converge here and the answer is derived from data. Whichever
 * redirect wins the race no longer matters, because they both land in the same
 * place.
 *
 * `farms.list()` is the key the farms screen already uses, so on the common
 * path this is served from cache rather than costing an extra round trip.
 *
 * A failed lookup falls through to the dashboard. Being unable to count
 * someone's fields is not a reason to trap them on a spinner, and the dashboard
 * has its own honest empty state.
 */
export function PostAuthLanding() {
  const { t } = useTranslation('auth');

  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: farmsApi.list,
    retry: false,
  });

  if (isPending) {
    return (
      <div
        className="flex min-h-40 flex-col items-center justify-center gap-3 py-16 text-ink-500"
        data-testid="post-auth-landing"
        role="status"
        aria-live="polite"
      >
        <Spinner size="lg" className="text-brand-600" />
        <p className="text-sm">{t('restoringSession')}</p>
      </div>
    );
  }

  if (isError) return <Navigate to="/dashboard" replace />;

  const hasFarm = (data?.farms?.length ?? 0) > 0;
  return <Navigate to={hasFarm ? '/dashboard' : '/onboarding'} replace />;
}
