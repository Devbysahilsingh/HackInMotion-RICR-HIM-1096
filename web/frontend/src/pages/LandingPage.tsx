import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import {
  IconCheck,
  IconField,
  IconLeaf,
  IconLocation,
  IconMenu,
  IconX,
} from '@/components/ui/icons';

/**
 * The public landing page — what an anonymous visitor finds at `/`.
 *
 * Rebuilt to a photography-led editorial reference: a full-bleed hero
 * photograph rather than an illustration, and three feature cards carrying
 * real agricultural photography (a cotton harvest, a mandi, a diseased soybean
 * leaf) instead of the `.ph` gradient placeholder. The four images live in
 * `public/images/landing/` — self-hosted, not hotlinked, so a broken CDN never
 * breaks the front door (CLAUDE.md rule 12; the same reasoning that keeps the
 * fonts self-hosted below).
 *
 * The section order and voice otherwise follow the previous build: what this
 * is, who it is for, how it works, and why it can be trusted. "How it works"
 * stays a 3-step sequence rather than the reference's 4 — OnboardingPage.tsx
 * documents the same deliberate deviation for the same reason: the product's
 * actual flow is location+land in one farm form, then crops, then the daily
 * feed. A 4th invented step would be exactly the fabrication CLAUDE.md rule 7
 * forbids.
 *
 * The "today's farm decision" panel is clearly badged `decisionExampleBadge`
 * ("Example") rather than carrying invented statistics (a fake rain
 * probability, a fake mm figure) — the panel demonstrates the *shape* of a
 * decision, not a live reading, per rule 7 and rule 9's honesty labelling.
 */
export default function LandingPage() {
  const { t } = useTranslation(['landing', 'common', 'auth']);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.title = `${t('common:app.name')} — ${t('common:app.tagline')}`;
  }, [t]);

  // Closed on every route-affecting interaction so a stale open panel never
  // survives a navigation that happens to keep this component mounted.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const navLinks = [
    { to: '/weather', label: t('landing:navWeather') },
    { to: '/market', label: t('landing:navMandi') },
    { to: '/scan', label: t('landing:navHealth') },
  ];

  return (
    <div className="bg-canvas">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex max-w-[92.5rem] flex-wrap items-center gap-4 px-5 py-4 sm:px-10">
          <p className="flex items-center gap-2.5">
            <span
              className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-leaf-500 text-brand-900"
              aria-hidden="true"
            >
              <IconLeaf size={17} />
            </span>
            <span className="font-display text-[1.188rem] font-extrabold tracking-[-0.03em]">
              {t('common:app.name')}
            </span>
          </p>

          <nav className="hidden items-center gap-6 md:flex" aria-label={t('common:nav.primary')}>
            <a
              href="#how-it-works"
              className="text-sm font-medium text-ink-700 hover:text-brand-600"
            >
              {t('landing:navHow')}
            </a>
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="text-sm font-medium text-ink-700 hover:text-brand-600"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2.5">
            <LanguageToggle className="hidden sm:inline-flex" />
            <ButtonLink to="/login" variant="secondary" size="md" className="hidden sm:inline-flex">
              {t('auth:goToLogin')}
            </ButtonLink>
            <ButtonLink to="/register" size="md" className="hidden sm:inline-flex">
              {t('landing:ctaPrimary')}
            </ButtonLink>

            {/* Mobile-only trigger. The three desktop items above collapse into this panel. */}
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="landing-mobile-menu"
              aria-label={t('common:nav.menu')}
              onClick={() => setMenuOpen((open) => !open)}
              className="touch-target inline-flex items-center justify-center rounded-lg text-ink-700 hover:bg-mute md:hidden"
            >
              {menuOpen ? <IconX size={22} /> : <IconMenu size={22} />}
            </button>
          </div>
        </div>

        {/* Mobile panel — stacked links, then the two CTAs, then the language toggle. */}
        {menuOpen && (
          <div
            id="landing-mobile-menu"
            className="border-t border-line bg-canvas px-5 py-4 sm:px-10 md:hidden"
          >
            <nav
              className="flex flex-col gap-1"
              aria-label={t('common:nav.primary')}
              onClick={() => setMenuOpen(false)}
            >
              <a
                href="#how-it-works"
                className="touch-target flex items-center rounded-lg px-2 text-[0.938rem] font-medium text-ink-700 hover:bg-mute"
              >
                {t('landing:navHow')}
              </a>
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="touch-target flex items-center rounded-lg px-2 text-[0.938rem] font-medium text-ink-700 hover:bg-mute"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-line pt-3">
              <ButtonLink to="/login" variant="secondary" size="md">
                {t('auth:goToLogin')}
              </ButtonLink>
              <ButtonLink to="/register" size="md">
                {t('landing:ctaPrimary')}
              </ButtonLink>
              <LanguageToggle className="ml-auto" />
            </div>
          </div>
        )}
      </header>

      <main>
        {/* ── Hero ───────────────────────────────────────────────────── */}
        <section className="relative flex min-h-[560px] items-end overflow-hidden sm:min-h-[640px]">
          <img
            src="/images/landing/hero-farmer.jpg"
            alt={t('landing:heroImageAlt')}
            width={2400}
            height={1340}
            className="absolute inset-0 size-full object-cover object-[68%_center]"
            loading="eager"
          />
          {/*
            Left-to-right scrim: the text sits bottom-left, so the left edge is
            darkened hard and the right — where the farmer stands in the photo
            — stays open. Decorative, so hidden from assistive tech.
          */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-r from-brand-900/92 via-brand-900/60 to-brand-900/10"
          />

          <div className="relative max-w-[52rem] px-5 py-14 sm:px-10 sm:py-16">
            <span className="inline-flex items-center rounded-full bg-leaf-500/25 px-[11px] py-1 text-[0.719rem] font-semibold text-leaf-tint">
              {t('landing:heroEyebrow')}
            </span>

            <h1 className="mt-3.5 max-w-[16ch] text-[2.125rem] leading-[0.98] text-white sm:text-[3rem] lg:text-[3.75rem]">
              {t('landing:heroTitle')}
            </h1>

            <p className="mt-4 max-w-[56ch] text-base leading-relaxed text-brand-100 sm:text-lg">
              {t('landing:heroSubtitle')}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <ButtonLink to="/register" size="lg" variant="onDark">
                {t('landing:ctaPrimary')}
              </ButtonLink>
              {/*
                A real anchor, not a router `Link`: this scrolls within the
                page. `<Link to="#…">` resolves to a route change and would not
                move the viewport at all.
              */}
              <a
                href="#how-it-works"
                className="touch-target inline-flex items-center justify-center gap-2 rounded-full border border-white/45 px-6 py-3 font-display font-semibold text-white transition-colors hover:bg-white/10"
              >
                {t('landing:ctaSecondary')}
              </a>
            </div>

            <p className="mt-5 text-sm text-brand-100">
              <Link to="/login" className="text-white underline underline-offset-4">
                {t('landing:ctaLogin')}
              </Link>
            </p>
          </div>
        </section>

        {/* The soil horizon that closes the hero. Decorative. */}
        <div className="strata" aria-hidden="true">
          <i className="bg-leaf-500" />
          <i className="bg-brand-600" />
          <i className="bg-harvest-500" />
          <i className="bg-earth-600" />
        </div>

        {/* ── Problem ────────────────────────────────────────────────── */}
        <section className="mx-auto grid w-full max-w-[92.5rem] items-center gap-8 px-5 py-14 sm:px-10 lg:grid-cols-2 lg:gap-12">
          <div>
            <p className="kicker">{t('landing:trustTitle')}</p>
            <h2 className="mt-3 max-w-[16ch] text-[1.75rem] sm:text-[2.375rem]">
              {t('landing:problemTitle')}
            </h2>
            <p className="mt-4 max-w-[52ch] leading-relaxed text-ink-500">
              {t('landing:problemBody')}
            </p>
          </div>

          {/*
            Four tinted capability cards — Weather, Mandi, Crop health, Land —
            each carrying the same tone the rest of the app uses for that
            domain (sky/info for weather, harvest/warning for market, leaf for
            health, earth for land), so the colour vocabulary learned here is
            the one a farmer meets inside. Each card is now three tiers — a
            short category pill, a bold headline, a description — matching the
            reference composition rather than the previous two-tier card.
          */}
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                {
                  tone: 'info',
                  cat: t('landing:navWeather'),
                  title: 'featWeatherTitle',
                  body: 'featWeatherBody',
                },
                {
                  tone: 'warning',
                  cat: t('landing:navMandi'),
                  title: 'featMarketTitle',
                  body: 'featMarketBody',
                },
                {
                  tone: 'success',
                  cat: t('landing:navHealth'),
                  title: 'featHealthTitle',
                  body: 'featHealthBody',
                },
                {
                  tone: 'earth',
                  cat: t('landing:catLand'),
                  title: 'featLandTitle',
                  body: 'featLandBody',
                },
              ] as const
            ).map(({ tone, cat, title, body }) => (
              <div
                key={title}
                className="rounded-card border border-line bg-surface p-5 shadow-card"
              >
                <Badge tone={tone}>{cat}</Badge>
                <p className="mt-2.5 text-[0.938rem] font-semibold leading-snug">
                  {t(`landing:${title}`)}
                </p>
                <p className="mt-1.5 text-[0.813rem] leading-relaxed text-ink-500">
                  {t(`landing:${body}`)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ───────────────────────────────────────────── */}
        <section
          id="how-it-works"
          className="furrow scroll-mt-20 bg-brand-800 px-5 py-14 text-white sm:px-10"
        >
          <div className="mx-auto w-full max-w-[92.5rem]">
            <p className="kicker text-leaf-500">{t('landing:navHow')}</p>
            <h2 className="mt-3 text-[1.75rem] text-white sm:text-[2.375rem]">
              {t('landing:howTitle')}
            </h2>

            <ol className="mt-8 grid gap-8 sm:grid-cols-3">
              {(
                [
                  { step: '01', Icon: IconLocation, title: 'how1Title', body: 'how1Body' },
                  { step: '02', Icon: IconField, title: 'how2Title', body: 'how2Body' },
                  { step: '03', Icon: IconCheck, title: 'how3Title', body: 'how3Body' },
                ] as const
              ).map(({ step, Icon, title, body }) => (
                <li key={step}>
                  <span
                    className="font-display text-[2.5rem] font-extrabold leading-none text-leaf-500"
                    aria-hidden="true"
                  >
                    {step}
                  </span>
                  <h3 className="mt-2 flex items-center gap-2 text-[1.188rem] text-white">
                    <Icon size={18} aria-hidden="true" />
                    {t(`landing:${title}`)}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-brand-100">
                    {t(`landing:${body}`)}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Today's farm decision / the product ───────────────────── */}
        <section className="mx-auto grid w-full max-w-[92.5rem] items-center gap-8 px-5 py-14 sm:px-10 lg:grid-cols-[1.65fr_1fr]">
          {/*
            Styled like the real decision band (DecisionBanner.tsx: furrow
            texture, forest ground, soil-strata footer) but explicitly badged
            "Example" rather than carrying invented figures. A visitor sees the
            *shape* of a decision, never a fabricated rain probability or mm
            reading (CLAUDE.md rule 7).
          */}
          <div className="furrow overflow-hidden rounded-[18px] bg-brand-600 px-6 py-8 text-white sm:px-8">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.13em] text-leaf-tint/80">
                {t('common:decision.kicker')}
              </span>
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[0.719rem] font-semibold text-white">
                {t('landing:decisionExampleBadge')}
              </span>
            </div>
            <h2 className="mt-3 max-w-[18ch] text-[1.75rem] text-white sm:text-[2.25rem]">
              {t('landing:decisionExampleTitle')}
            </h2>
            <p className="mt-3 max-w-[46ch] leading-relaxed text-brand-100">
              {t('landing:decisionExampleBody')}
            </p>
            <div className="strata mt-7 rounded-full" aria-hidden="true">
              <i className="bg-leaf-500" />
              <i className="bg-harvest-500" />
              <i className="bg-earth-600" />
            </div>
          </div>

          <div>
            <p className="kicker">{t('landing:footerProduct')}</p>
            <h2 className="mt-3 max-w-[18ch] text-[1.75rem] sm:text-[2rem]">
              {t('landing:featWhyTitle')}
            </h2>
            <p className="mt-3 max-w-[48ch] leading-relaxed text-ink-500">
              {t('landing:featWhyBody')}
            </p>
            <ul className="mt-5 space-y-3">
              {(['trust1', 'trust2', 'trust3'] as const).map((key) => (
                <li key={key} className="flex items-start gap-3 text-[0.938rem] text-ink-700">
                  <span className="mt-0.5 shrink-0 text-leaf-600" aria-hidden="true">
                    <IconCheck size={18} />
                  </span>
                  {t(`landing:${key}`)}
                </li>
              ))}
            </ul>
            <ButtonLink to="/register" className="mt-6">
              {t('landing:ctaPrimary')}
            </ButtonLink>
          </div>
        </section>

        {/* ── Feature image cards ───────────────────────────────────── */}
        <section className="mx-auto grid w-full max-w-[92.5rem] gap-5 px-5 pb-14 sm:px-10 lg:grid-cols-3">
          {(
            [
              {
                tone: 'info',
                cat: t('landing:navWeather'),
                title: 'featWeatherTitle',
                body: 'featWeatherBody',
                src: '/images/landing/cotton-harvesting.jpg',
                w: 594,
                h: 395,
              },
              {
                tone: 'warning',
                cat: t('landing:navMandi'),
                title: 'featMarketTitle',
                body: 'featMarketBody',
                src: '/images/landing/mandi.jpg',
                w: 1600,
                h: 960,
              },
              {
                tone: 'success',
                cat: t('landing:navHealth'),
                title: 'featHealthTitle',
                body: 'featHealthBody',
                src: '/images/landing/disease-soya.jpg',
                w: 900,
                h: 598,
              },
            ] as const
          ).map(({ tone, cat, title, body, src, w, h }) => (
            <article
              key={title}
              className="overflow-hidden rounded-card border border-line bg-surface shadow-card"
            >
              <div className="h-[180px] overflow-hidden">
                <img
                  src={src}
                  alt={t(`landing:${title}`)}
                  width={w}
                  height={h}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </div>
              <div className="p-5">
                <Badge tone={tone}>{cat}</Badge>
                <p className="mt-2.5 text-[0.938rem] font-semibold leading-snug">
                  {t(`landing:${title}`)}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
                  {t(`landing:${body}`)}
                </p>
              </div>
            </article>
          ))}
        </section>

        {/* ── Gold CTA ───────────────────────────────────────────────── */}
        <section className="flex flex-wrap items-center gap-8 bg-harvest-500 px-5 py-14 sm:px-10">
          <h2 className="max-w-[22ch] text-[1.75rem] text-earth-800 sm:text-[2.625rem]">
            {t('landing:closingStatement')}
          </h2>
          <ButtonLink
            to="/register"
            size="lg"
            className="ml-auto border-earth-800 bg-earth-800 text-harvest-tint hover:bg-earth-700"
          >
            {t('landing:ctaPrimary')}
          </ButtonLink>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="flex flex-wrap gap-8 bg-ink-900 px-5 py-10 text-sm text-[#b7beb8] sm:px-10">
        <div className="max-w-[30ch]">
          <p className="font-display text-[1.063rem] font-extrabold text-white">
            {t('common:app.name')}
          </p>
          <p className="mt-2">{t('landing:footerBlurb')}</p>
        </div>

        <div>
          <p className="kicker text-[#6f7a72]">{t('landing:footerProduct')}</p>
          <p className="mt-2">
            {t('common:nav.dashboard')} · {t('landing:navWeather')} · {t('landing:navMandi')} ·{' '}
            {t('landing:navHealth')}
          </p>
        </div>

        {/*
          The real provenance of the product's numbers, named. This is the same
          claim the honesty labels make on every screen, made once up front —
          and every source here is one the system genuinely reads.
        */}
        <div>
          <p className="kicker text-[#6f7a72]">{t('landing:footerSources')}</p>
          <p className="mt-2">IMD · Open-Meteo · data.gov.in · ICAR · TNAU · FAO-56</p>
        </div>

        <div>
          <p className="kicker text-[#6f7a72]">{t('landing:footerLanguages')}</p>
          <p className="mt-2">English · हिन्दी</p>
        </div>
      </footer>
    </div>
  );
}
