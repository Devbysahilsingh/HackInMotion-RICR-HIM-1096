import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { MAX_FARMS_PER_USER, type Farm } from '@/api/types';
import { useActiveFarm } from '@/farm/ActiveFarmContext';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { IconChevronDown, IconPlus } from '@/components/ui/icons';

/** First letter of each significant word, uppercased, capped at 2 — "Kolar Road field" → "K". */
function initials(name: string, max = 1): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .slice(0, max);
  return letters.join('') || '?';
}

/**
 * The sidebar's farm selector — real, functional multi-farm switching, not a
 * decorative header. Reads and writes `ActiveFarmContext`, which is the one
 * shared source of truth every farm-dependent page and query reads from.
 *
 * A native `<button>` driving a `role="listbox"` panel, per accessibility.md:
 * a real interactive control, keyboard-operable by default (Enter/Space on
 * the trigger and on each option), Escape-closable, closes on outside click,
 * and returns focus to the trigger on close.
 */
export function FarmSwitcher() {
  const { t } = useTranslation(['farm', 'common']);
  const { language } = useLanguage();
  const { farms, activeFarm, activeFarmId, setActiveFarmId, isLoading } = useActiveFarm();
  const location = useLocation();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /**
   * Selecting a farm while already viewing a URL scoped to the *previous*
   * farm (`/farms/:id`, `/farms/:id/weather`, `/farms/:id/crops/new`, …)
   * follows through to the same page for the new one, rather than leaving the
   * farmer looking at a stale farm's weather after they just switched away
   * from it. Any other route is untouched — this only rewrites the id
   * segment of an already farm-scoped path.
   */
  function selectFarm(farmId: string) {
    setActiveFarmId(farmId);
    setOpen(false);
    triggerRef.current?.focus();

    const match = /^\/farms\/[^/]+((?:\/.*)?)$/.exec(location.pathname);
    if (match && farmId !== activeFarmId) {
      navigate(`/farms/${farmId}${match[1]}`, { replace: true });
    }
  }

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (isLoading) {
    return (
      <div
        className="mx-[15px] mb-4 h-[58px] animate-pulse rounded-xl bg-white/[0.06]"
        aria-hidden="true"
      />
    );
  }

  if (!activeFarm) {
    // No farms yet — genuinely nothing to switch between. Points at the real
    // create-farm flow rather than showing a fake/empty selector.
    return (
      <Link
        to="/farms/new"
        className="mx-[15px] mb-4 flex items-center justify-center rounded-xl border border-dashed border-white/20 px-4 py-3 text-sm font-medium text-brand-100/75 hover:border-white/35 hover:text-white"
      >
        {t('farm:listEmptyCta')}
      </Link>
    );
  }

  const subtitle = subtitleFor(activeFarm, language, t);

  return (
    <div ref={rootRef} className="relative mx-[15px] mb-4">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('farm:switcherTrigger')}
        data-testid="farm-switcher-trigger"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 rounded-xl bg-white/[0.07] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.11]"
      >
        <span
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-harvest-500 text-sm font-bold text-white"
          aria-hidden="true"
        >
          {initials(activeFarm.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white">{activeFarm.name}</span>
          <span className="block truncate text-xs text-brand-100/70">{subtitle}</span>
        </span>
        <IconChevronDown
          size={16}
          className={cn('shrink-0 text-brand-100/70 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('farm:switcherTrigger')}
          data-testid="farm-switcher-panel"
          className="furrow absolute inset-x-0 top-[calc(100%+6px)] z-20 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-brand-900 p-1.5 shadow-raised"
        >
          {farms.map((farm) => {
            const selected = farm.id === activeFarmId;
            return (
              <button
                key={farm.id}
                type="button"
                role="option"
                aria-selected={selected}
                data-testid="farm-switcher-option"
                onClick={() => selectFarm(farm.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
                  selected ? 'bg-white/10' : 'hover:bg-white/[0.06]',
                )}
              >
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-md bg-harvest-500 text-[0.688rem] font-bold text-white"
                  aria-hidden="true"
                >
                  {initials(farm.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.813rem] font-semibold text-white">
                    {farm.name}
                  </span>
                  <span className="block truncate text-[0.688rem] text-brand-100/70">
                    {subtitleFor(farm, language, t)}
                  </span>
                </span>
              </button>
            );
          })}

          {farms.length <= 1 && (
            <p className="px-2.5 py-2 text-[0.688rem] text-brand-100/60">
              {t('farm:switcherNoOtherFarms')}
            </p>
          )}

          {/*
            Adding a farm belongs here.

            "My farm" in the sidebar goes straight to the selected field's own
            page, so a farmer with one farm had no route to a second one
            anywhere in the shell — the create flow existed but was reachable
            only from the farms list, which nothing links to once a farm exists.
            The switcher is where a farmer already goes to ask "which field?",
            which makes it where "another field" belongs.

            Outside the listbox's option list, and a link rather than an option:
            it navigates, it is not a selectable farm, and putting it inside
            `role="listbox"` would announce it as one.
          */}
          {farms.length < MAX_FARMS_PER_USER && (
            <Link
              to="/farms/new"
              onClick={() => setOpen(false)}
              data-testid="farm-switcher-add"
              className="mt-1 flex items-center gap-2.5 rounded-lg border-t border-white/10 px-2.5 py-2.5 text-[0.813rem] font-semibold text-brand-100 hover:bg-white/[0.06] hover:text-white"
            >
              <span
                aria-hidden="true"
                className="grid size-7 shrink-0 place-items-center rounded-md border border-dashed border-white/25"
              >
                <IconPlus size={14} />
              </span>
              {t('farm:addFarmCta')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function subtitleFor(
  farm: Farm,
  language: ReturnType<typeof useLanguage>['language'],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const size = `${formatNumber(farm.sizeValue, language, { maximumFractionDigits: 2 })} ${t(`common:unit.${farm.sizeUnit}`)}`;
  const place = farm.location.village || farm.location.district;
  return `${size} · ${place}`;
}
