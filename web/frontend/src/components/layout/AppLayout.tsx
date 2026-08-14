import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/auth/AuthContext';
import { FarmSwitcher } from '@/components/domain/FarmSwitcher';
import { ActiveFarmProvider, useActiveFarm } from '@/farm/ActiveFarmContext';
import { usePageHeading } from '@/hooks/usePageHeading';
import { cn } from '@/lib/cn';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { ConfirmDialog } from '@/components/ui/Modal';
import {
  IconCamera,
  IconChart,
  IconClock,
  IconCloud,
  IconDroplet,
  IconField,
  IconHome,
  IconLeaf,
  IconScan,
  IconSettings,
  IconTrendUp,
  IconUsers,
} from '@/components/ui/icons';

/**
 * The authenticated shell.
 *
 * Navigation is bottom tabs under 768px and a sidebar above it
 * (ux-flows.md) — the bottom bar mirrors the Android app's layout so the two
 * surfaces share muscle memory. The bottom bar's five destinations are
 * unchanged by the sidebar redesign below; it is a distinct navigation
 * paradigm for a thumb-reachable phone screen, not a collapsed sidebar.
 */
const NAV = [
  { to: '/dashboard', labelKey: 'common:nav.dashboard', Icon: IconHome },
  { to: '/farms', labelKey: 'common:nav.farms', Icon: IconField },
  { to: '/scan', labelKey: 'common:nav.scan', Icon: IconCamera },
  { to: '/market', labelKey: 'common:nav.market', Icon: IconChart },
  { to: '/community', labelKey: 'common:nav.community', Icon: IconUsers },
] as const;

export function AppLayout() {
  const { t } = useTranslation('common');

  return (
    <ActiveFarmProvider>
      <div className="min-h-dvh md:flex">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
        >
          {t('nav.skipToContent')}
        </a>

        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          {/*
            1480px, from the reference. Wider than the old 4xl (896px) because the
            dashboard now lays out in two and three columns on a desktop — at 896px
            a "split" layout is really just a narrow column with a gutter.
          */}
          <main
            id="main"
            className="mx-auto w-full max-w-[92.5rem] flex-1 px-4 pb-24 pt-6 sm:px-6 md:pb-12 lg:px-8"
          >
            <Outlet />
          </main>
        </div>

        <BottomTabs />
      </div>
    </ActiveFarmProvider>
  );
}

/**
 * The dark rail.
 *
 * Deep forest with the furrow texture, per the reference. A real farm
 * switcher sits below the wordmark — `FarmSwitcher` reads and writes
 * `ActiveFarmContext`, the one shared source of truth every farm-dependent
 * page and query reads from — then the nine destinations the reference
 * names, then the account section, pinned to the bottom behind a divider.
 *
 * The active marker is a leaf-coloured left edge plus a tinted fill — two
 * signals, so it survives both greyscale and a farmer glancing at a sunlit
 * screen.
 */
function Sidebar() {
  const { t } = useTranslation(['common', 'weather', 'irrigation', 'market', 'auth']);
  const { user, logout } = useAuth();
  const { activeFarmId } = useActiveFarm();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const items = [
    { to: '/dashboard', labelKey: 'common:nav.today', Icon: IconHome },
    {
      to: activeFarmId ? `/farms/${activeFarmId}` : '/farms',
      labelKey: 'common:nav.myFarm',
      Icon: IconField,
    },
    { to: '/weather', labelKey: 'weather:pageTitle', Icon: IconCloud },
    { to: '/irrigation', labelKey: 'irrigation:pageTitle', Icon: IconDroplet },
    { to: '/market', labelKey: 'market:pageTitle', Icon: IconTrendUp },
    { to: '/scan', labelKey: 'common:nav.cropHealth', Icon: IconScan },
    { to: '/crop-recommendation', labelKey: 'common:nav.whatToPlant', Icon: IconLeaf },
    /*
     * Community was reachable from the bottom tabs but not from the sidebar, so
     * on any desktop screen the page existed and nothing linked to it. It sits
     * after "what to plant" because both answer a question about the season
     * rather than about today, and before the account block.
     */
    { to: '/community', labelKey: 'common:nav.community', Icon: IconUsers },
    { to: '/history', labelKey: 'common:nav.history', Icon: IconClock },
    { to: '/settings', labelKey: 'common:nav.settings', Icon: IconSettings },
  ] as const;

  return (
    <nav
      aria-label={t('common:nav.primary')}
      className="furrow sticky top-0 hidden h-dvh w-[16.5rem] shrink-0 flex-col bg-brand-800 py-4 md:flex"
    >
      <p className="flex items-center gap-2.5 px-[18px] pb-4">
        <span
          className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-leaf-500 text-brand-900"
          aria-hidden="true"
        >
          <IconLeaf size={18} />
        </span>
        <span className="font-display text-[17px] font-extrabold tracking-tight text-white">
          {t('common:app.name')}
        </span>
      </p>

      <FarmSwitcher />

      <div className="flex flex-col gap-0.5">
        {items.map(({ to, labelKey, Icon }) => (
          <NavLink key={labelKey} to={to} className={sidebarLinkClass}>
            <Icon size={20} />
            {t(labelKey)}
          </NavLink>
        ))}
      </div>

      <div className="mt-auto border-t border-white/10 px-[15px] pt-4">
        <div className="flex items-center gap-2.5">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full bg-leaf-500 text-sm font-bold text-brand-900"
            aria-hidden="true"
          >
            {userInitials(user?.name ?? '')}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{user?.name}</p>
            <button
              type="button"
              data-testid="sidebar-logout"
              onClick={() => setConfirmOpen(true)}
              className="touch-target -ml-0.5 text-xs font-medium text-brand-100/75 hover:text-white"
            >
              {t('auth:logout')}
            </button>
          </div>
        </div>
      </div>

      {/*
        The same confirm the Settings page uses (auth:logoutConfirmTitle/Body)
        — a persistent sidebar control gets tapped by accident far more often
        than a dedicated settings screen does, so this is not optional here.
      */}
      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setIsLoggingOut(true);
          await logout();
          setIsLoggingOut(false);
          setConfirmOpen(false);
          navigate('/login', { replace: true });
        }}
        title={t('auth:logoutConfirmTitle')}
        body={t('auth:logoutConfirmBody')}
        confirmLabel={t('auth:logout')}
        isPending={isLoggingOut}
      />
    </nav>
  );
}

function userInitials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .slice(0, 2);
  return letters.join('') || '?';
}

const sidebarLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'touch-target flex items-center gap-[11px] border-l-[3px] px-[15px] text-sm',
    isActive
      ? 'border-leaf-500 bg-leaf-500/15 font-semibold text-white'
      : 'border-transparent font-medium text-brand-100/75 hover:bg-white/[0.06] hover:text-white',
  );

function TopBar() {
  const { t } = useTranslation('common');

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur sm:px-6 lg:px-8">
      <p className="flex items-center gap-2 md:sr-only">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-600 text-white"
          aria-hidden="true"
        >
          <IconLeaf size={16} />
        </span>
        <span className="font-display text-base font-extrabold tracking-tight text-brand-600">
          {t('app.name')}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <LanguageToggle />
        <NavLink
          to="/settings"
          aria-label={t('nav.settings')}
          className="touch-target inline-flex items-center justify-center rounded-lg text-ink-500 hover:bg-canvas md:hidden"
        >
          <IconSettings size={20} />
        </NavLink>
      </div>
    </header>
  );
}

function BottomTabs() {
  const { t } = useTranslation('common');

  return (
    <nav
      aria-label={t('nav.primary')}
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV.map(({ to, labelKey, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[0.7rem] font-semibold',
              isActive ? 'text-brand-600' : 'text-ink-400',
            )
          }
        >
          <Icon size={20} />
          <span className="truncate">{t(labelKey)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * Page frame: title, optional back link and actions, plus the focus and
 * document-title management every route needs.
 */
export function PageHeader({
  title,
  kicker,
  description,
  actions,
  children,
}: {
  title: string;
  /** Small uppercase eyebrow above the title — the reference's `.k` label. */
  kicker?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  /**
   * Focus moves to the page title on every navigation, and the document title
   * follows the route (accessibility.md: "focus moved to page title on route
   * change"; routes.md: "document titles localized"). Without this a
   * screen-reader user stays parked wherever the previous page left them.
   */
  const headingRef = usePageHeading(title);

  return (
    <div className="mb-6 space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          {kicker && <p className="kicker mb-1.5">{kicker}</p>}
          <h1 ref={headingRef} tabIndex={-1} className="text-[1.75rem] sm:text-[2rem]">
            {title}
          </h1>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="max-w-prose text-sm text-ink-500">{description}</p>}
      {children}
    </div>
  );
}
