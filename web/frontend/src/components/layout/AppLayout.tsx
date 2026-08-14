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
  IconLeaf,
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
  );
}

/**
 * The dark rail.
 *
 * Deep forest with the furrow texture, straight from the design reference. It
 * does real work beyond looking agricultural: a dark rail against a cream body
 * separates "where am I in the app" from "what is the app telling me" without
 * needing a border, which is what lets the content column stay borderless and
 * calm.
 *
 * The active marker is a leaf-coloured left edge plus a tinted fill — two
 * signals, so it survives both greyscale and a farmer glancing at a sunlit
 * screen.
 */
function Sidebar() {
  const { t } = useTranslation('common');

  return (
    <nav
      aria-label={t('nav.primary')}
      className="furrow sticky top-0 hidden h-dvh w-[15.75rem] shrink-0 flex-col gap-0.5 bg-brand-800 py-4 md:flex"
    >
      <p className="flex items-center gap-2.5 px-[18px] pb-4">
        <span
          className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-leaf-500 text-brand-900"
          aria-hidden="true"
        >
          <IconLeaf size={18} />
        </span>
        <span className="font-display text-[17px] font-extrabold tracking-tight text-white">
          {t('app.name')}
        </span>
      </p>

      {[...NAV.slice(0, 4), ...NAV_DESKTOP_EXTRA, ...NAV.slice(4)].map(({ to, labelKey, Icon }) => (
        <NavLink key={to} to={to} className={sidebarLinkClass}>
          <Icon size={20} />
          {t(labelKey)}
        </NavLink>
      ))}

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
