import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { IconLeaf } from '@/components/ui/icons';

/**
 * The pre-auth frame. Carries the language toggle, because a farmer who cannot
 * read the form cannot reach Settings to change it (routes.md: "language
 * switch visible pre-auth").
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  const { t } = useTranslation('common');
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`;
    headingRef.current?.focus();
  }, [title, t]);

  return (
    /*
     * Split screen, from the design reference: a field on one side, the form on
     * the other. On a phone the field collapses to a short band above the form
     * rather than disappearing — it is what tells a farmer at a glance that this
     * is an agriculture app and not a bank, before they have read a word.
     */
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-2">
      <FieldPanel />

      <div className="flex min-h-dvh flex-col lg:min-h-0">
        <header className="flex items-center justify-between px-4 py-3 sm:px-6">
          <p className="flex items-center gap-2 lg:invisible">
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
          <LanguageToggle />
        </header>

        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-10 sm:px-6">
          <h1 ref={headingRef} tabIndex={-1} className="text-[1.75rem]">
            {title}
          </h1>
          <p className="mt-2 text-sm text-ink-500">{subtitle}</p>
          <div className="mt-7">{children}</div>
          <div className="mt-6 text-sm text-ink-500">{footer}</div>
        </main>
      </div>
    </div>
  );
}

/**
 * The field.
 *
 * Drawn rather than photographed: a gradient from forest through earth to
 * harvest, with the furrow texture over it — the same three-colour ramp the
 * reference uses for its image placeholders. That is a deliberate trade. A
 * photograph would be warmer, but it would also be 200–400KB in front of the
 * login form on a 2G connection, and this costs nothing and never fails to
 * load.
 *
 * Purely decorative, so it is hidden from assistive technology entirely: there
 * is no information here that the heading beside it does not already carry.
 */
function FieldPanel() {
  return (
    <div
      aria-hidden="true"
      className="furrow relative h-32 overflow-hidden bg-gradient-to-br from-brand-500 via-earth-600 to-harvest-500 sm:h-44 lg:h-auto"
    >
      {/* A horizon line, so the panel reads as land rather than as a swatch. */}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-brand-900/45 to-transparent" />
      <div className="strata absolute inset-x-0 bottom-0">
        <i className="bg-leaf-500" />
        <i className="bg-harvest-500" />
        <i className="bg-earth-600" />
        <i className="bg-earth-800" />
      </div>
    </div>
  );
}
