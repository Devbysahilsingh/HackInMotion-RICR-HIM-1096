import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import {
  IconCamera,
  IconChart,
  IconClock,
  IconCloud,
  IconField,
  IconHome,
  IconSettings,
  IconUsers,
} from '@/components/ui/icons';

/**
 * The authenticated shell.
 *
 * Navigation is bottom tabs under 768px and a sidebar above it
 * (ux-flows.md) — the bottom bar mirrors the Android app's layout so the two
 * surfaces share muscle memory.
 *
 * The bottom bar carries the five destinations a farmer reaches for daily;
 * the sidebar has room for the full set. Weather and History are therefore
 * sidebar-only here — on mobile they stay one tap away through the dashboard
 * and each farm's detail page, never orphaned.
 */
const NAV = [
  { to: '/dashboard', labelKey: 'common:nav.dashboard', Icon: IconHome },
  { to: '/farms', labelKey: 'common:nav.farms', Icon: IconField },
  { to: '/scan', labelKey: 'common:nav.scan', Icon: IconCamera },
  { to: '/market', labelKey: 'common:nav.market', Icon: IconChart },
  { to: '/community', labelKey: 'common:nav.community', Icon: IconUsers },
] as const;

/** Sidebar-only additions, slotted after Market. */
const NAV_DESKTOP_EXTRA = [
  { to: '/weather', labelKey: 'weather:pageTitle', Icon: IconCloud },
  { to: '/history', labelKey: 'common:nav.history', Icon: IconClock },
] as const;

export function AppLayout() {
  const { t } = useTranslation('common');

  return (
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
        <main
          id="main"
          className="mx-auto w-full max-w-4xl flex-1 px-4 pb-24 pt-4 sm:px-6 md:pb-8"
        >
          <Outlet />
        </main>
      </div>

      <BottomTabs />
    </div>
  );
}

function Sidebar() {
  const { t } = useTranslation('common');

  return (
    <nav
      aria-label={t('nav.primary')}
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r border-line bg-surface px-3 py-4 md:flex"
    >
      <p className="px-3 pb-3 text-lg font-semibold text-brand-700">{t('app.name')}</p>

      {[...NAV.slice(0, 4), ...NAV_DESKTOP_EXTRA, ...NAV.slice(4)].map(
        ({ to, labelKey, Icon }) => (
          <NavLink key={to} to={to} className={sidebarLinkClass}>
            <Icon size={20} />
            {t(labelKey)}
          </NavLink>
        ),
      )}

      <div className="mt-auto">
        <NavLink to="/settings" className={sidebarLinkClass}>
          <IconSettings size={20} />
          {t('nav.settings')}
        </NavLink>
      </div>
    </nav>
  );
}

const sidebarLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'touch-target flex items-center gap-3 rounded-lg px-3 text-sm font-medium',
    isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-canvas',
  );

function TopBar() {
  const { t } = useTranslation('common');

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur sm:px-6">
      <p className="text-base font-semibold text-brand-700 md:sr-only">{t('app.name')}</p>
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
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface md:hidden"
    >
      {NAV.map(({ to, labelKey, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[0.7rem] font-medium',
              isActive ? 'text-brand-700' : 'text-ink-500',
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
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation('common');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const location = useLocation();

  /**
   * Focus moves to the page title on every navigation, and the document title
   * follows the route (accessibility.md: "focus moved to page title on route
   * change"; routes.md: "document titles localized"). Without this a
   * screen-reader user stays parked wherever the previous page left them.
   */
  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`;
    headingRef.current?.focus();
  }, [title, location.key, t]);

  return (
    <div className="mb-5 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 ref={headingRef} tabIndex={-1} className="text-xl sm:text-2xl">
          {title}
        </h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="max-w-prose text-sm text-ink-500">{description}</p>}
      {children}
    </div>
  );
}
