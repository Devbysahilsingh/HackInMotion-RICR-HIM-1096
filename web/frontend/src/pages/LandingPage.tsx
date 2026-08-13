import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { ButtonLink } from '@/components/ui/Button';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import {
  IconCamera,
  IconChart,
  IconCheck,
  IconCloud,
  IconField,
  IconInfo,
  IconLeaf,
  IconLocation,
} from '@/components/ui/icons';

/**
 * The public landing page — what an anonymous visitor finds at `/`.
 *
 * Before this existed, `/` sat behind the auth guard and every visitor was
 * bounced straight to the login form: the product had no front door. This page
 * answers, in order, what this is, who it is for, how it works, and why it can
 * be trusted — the last one in the product's own voice (honesty labels, "why?"
 * traces, no invented numbers), because that is genuinely the differentiator.
 *
 * All imagery is inline SVG drawn from the design tokens. No external image
 * hosts: a hero that arrives broken on a rural connection is worse than a
 * simple one that always renders (and the CSP never has to trust a CDN).
 */
export default function LandingPage() {
  const { t } = useTranslation(['landing', 'common', 'auth']);

  useEffect(() => {
    document.title = `${t('common:app.name')} — ${t('common:app.tagline')}`;
  }, [t]);

  return (
    <div className="bg-canvas">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <p className="flex items-center gap-2 text-lg font-semibold text-brand-700">
          <IconLeaf size={22} aria-hidden="true" />
          {t('common:app.name')}
        </p>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ButtonLink to="/login" variant="ghost" size="md">
            {t('auth:goToLogin')}
          </ButtonLink>
        </div>
      </header>

      <main>
        {/* ── Hero ───────────────────────────────────────────────────── */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 md:py-16">
          <div className="space-y-5">
            <h1 className="text-3xl font-bold leading-tight text-ink-900 sm:text-4xl">
              {t('landing:heroTitle')}
            </h1>
            <p className="max-w-prose text-base text-ink-700 sm:text-lg">
              {t('landing:heroSubtitle')}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <ButtonLink to="/register" size="lg">
                {t('landing:ctaPrimary')}
              </ButtonLink>
              <a
                href="#how-it-works"
                className="touch-target inline-flex items-center rounded-lg px-4 text-sm font-semibold text-brand-700 underline underline-offset-4"
              >
                {t('landing:ctaSecondary')}
              </a>
            </div>
            <p className="text-sm text-ink-500">
              <Link to="/login" className="underline underline-offset-2">
                {t('landing:ctaLogin')}
              </Link>
            </p>
          </div>

          <FieldIllustration caption={t('landing:visualCaption')} />
        </section>

        {/* ── Problem ────────────────────────────────────────────────── */}
        <section className="bg-brand-800 py-12 text-white">
          <div className="mx-auto w-full max-w-4xl space-y-4 px-4 text-center sm:px-6">
            <h2 className="text-xl font-semibold leading-snug sm:text-2xl">
              {t('landing:problemTitle')}
            </h2>
            <p className="mx-auto max-w-prose text-sm text-brand-100 sm:text-base">
              {t('landing:problemBody')}
            </p>
          </div>
        </section>

        {/* ── How it works ───────────────────────────────────────────── */}
        <section id="how-it-works" className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
          <h2 className="text-center text-2xl font-semibold">{t('landing:howTitle')}</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {(
              [
                { step: 1, Icon: IconLocation, title: 'how1Title', body: 'how1Body' },
                { step: 2, Icon: IconField, title: 'how2Title', body: 'how2Body' },
                { step: 3, Icon: IconCheck, title: 'how3Title', body: 'how3Body' },
              ] as const
            ).map(({ step, Icon, title, body }) => (
              <li
                key={step}
                className="rounded-2xl border border-line bg-surface p-6"
              >
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700"
                  aria-hidden="true"
                >
                  <Icon size={22} />
                </span>
                <h3 className="mt-4 text-base font-semibold">
                  {step}. {t(`landing:${title}`)}
                </h3>
                <p className="mt-2 text-sm text-ink-700">{t(`landing:${body}`)}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Features ───────────────────────────────────────────────── */}
        <section className="bg-surface py-12">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 sm:grid-cols-2 sm:px-6">
            {(
              [
                { Icon: IconCloud, title: 'featWeatherTitle', body: 'featWeatherBody' },
                { Icon: IconChart, title: 'featMarketTitle', body: 'featMarketBody' },
                { Icon: IconCamera, title: 'featHealthTitle', body: 'featHealthBody' },
                { Icon: IconInfo, title: 'featWhyTitle', body: 'featWhyBody' },
              ] as const
            ).map(({ Icon, title, body }) => (
              <article key={title} className="flex gap-4 rounded-2xl border border-line p-6">
                <span className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true">
                  <Icon size={26} />
                </span>
                <div>
                  <h3 className="text-base font-semibold">{t(`landing:${title}`)}</h3>
                  <p className="mt-1.5 text-sm text-ink-700">{t(`landing:${body}`)}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── Trust ──────────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
          <h2 className="text-center text-2xl font-semibold">{t('landing:trustTitle')}</h2>
          <ul className="mx-auto mt-6 max-w-xl space-y-3">
            {(['trust1', 'trust2', 'trust3'] as const).map((key) => (
              <li key={key} className="flex items-start gap-3 text-sm text-ink-700 sm:text-base">
                <span className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true">
                  <IconCheck size={18} />
                </span>
                {t(`landing:${key}`)}
              </li>
            ))}
          </ul>
        </section>

        {/* ── Final CTA ──────────────────────────────────────────────── */}
        <section className="bg-brand-700 py-12 text-white">
          <div className="mx-auto w-full max-w-3xl space-y-4 px-4 text-center sm:px-6">
            <h2 className="text-2xl font-semibold">{t('landing:ctaFinalTitle')}</h2>
            <p className="mx-auto max-w-prose text-sm text-brand-100 sm:text-base">
              {t('landing:ctaFinalBody')}
            </p>
            <div className="pt-2">
              <ButtonLink to="/register" size="lg" variant="secondary">
                {t('landing:ctaPrimary')}
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-ink-500 sm:px-6">
        <p className="flex items-center gap-2">
          <IconLeaf size={16} aria-hidden="true" />
          {t('common:app.name')} · {t('common:app.tagline')}
        </p>
        <Link to="/login" className="underline underline-offset-2">
          {t('auth:goToLogin')}
        </Link>
      </footer>
    </div>
  );
}

/**
 * The hero visual: a stylised Indian field under a warm sky, drawn entirely
 * from the design tokens. Decorative — the caption carries the meaning.
 */
function FieldIllustration({ caption }: { caption: string }) {
  return (
    <figure className="overflow-hidden rounded-3xl border border-line bg-surface shadow-sm">
      <svg
        viewBox="0 0 480 300"
        role="img"
        aria-hidden="true"
        className="block h-auto w-full"
        preserveAspectRatio="xMidYMid slice"
      >
        {/* Sky */}
        <rect width="480" height="170" fill="#eaf4ee" />
        {/* Sun */}
        <circle cx="390" cy="58" r="30" fill="#f5c76f" />
        {/* Far hills */}
        <path d="M0 140 Q120 96 260 132 T480 122 V170 H0 Z" fill="#bbe1c6" />
        {/* Field bands, receding */}
        <rect y="170" width="480" height="130" fill="#8ecaa2" />
        <path d="M0 190 H480 V212 H0 Z" fill="#5aab78" />
        <path d="M0 226 H480 V252 H0 Z" fill="#388e5c" />
        <path d="M0 266 H480 V300 H0 Z" fill="#277249" />
        {/* Furrow lines converging toward the horizon */}
        {[80, 160, 240, 320, 400].map((x) => (
          <path
            key={x}
            d={`M${x} 300 L${200 + (x - 240) * 0.25} 172`}
            stroke="#1f5a3b"
            strokeOpacity="0.25"
            strokeWidth="3"
            fill="none"
          />
        ))}
        {/* Crop rows: simple plant clusters */}
        {[60, 140, 220, 300, 380, 460].map((x) => (
          <g key={x} transform={`translate(${x} 236)`} fill="#163b2a">
            <path d="M0 0 C-6 -12 -14 -14 -18 -12 C-12 -4 -6 0 0 2 Z" />
            <path d="M0 0 C6 -12 14 -14 18 -12 C12 -4 6 0 0 2 Z" />
            <path d="M-1 2 L1 2 L1 -14 L-1 -14 Z" />
          </g>
        ))}
        {/* Phone in the foreground: the advisor in the pocket */}
        <g transform="translate(36 96)">
          <rect x="0" y="0" width="96" height="168" rx="14" fill="#16211c" />
          <rect x="6" y="10" width="84" height="148" rx="8" fill="#ffffff" />
          <rect x="14" y="22" width="68" height="12" rx="6" fill="#dcf0e1" />
          <rect x="14" y="44" width="68" height="26" rx="6" fill="#fdf0e4" />
          <rect x="20" y="52" width="40" height="6" rx="3" fill="#9a4a06" />
          <rect x="14" y="78" width="68" height="26" rx="6" fill="#eef6f1" />
          <rect x="20" y="86" width="48" height="6" rx="3" fill="#1f5a3b" />
          <rect x="14" y="112" width="68" height="26" rx="6" fill="#f6f8f6" />
          <rect x="20" y="120" width="34" height="6" rx="3" fill="#5a6a62" />
        </g>
      </svg>
      <figcaption className="border-t border-line px-4 py-3 text-center text-sm text-ink-500">
        {caption}
      </figcaption>
    </figure>
  );
}
