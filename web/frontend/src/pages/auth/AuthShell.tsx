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
  panelMessage,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  /** Editorial line over the field photo. Defaults to `auth:panelMessage` (login's). */
  panelMessage?: ReactNode;
}) {
  // Both namespaces: the frame's own copy is in `common`, the panel statement
  // belongs with the rest of the sign-in strings in `auth`.
  const { t } = useTranslation(['common', 'auth']);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = `${title} · ${t('common:app.name')}`;
    headingRef.current?.focus();
  }, [title, t]);

  return (
    /*
     * Split screen, from the design reference: a large field photograph on one
     * side (roughly 70% on desktop — this is an editorial photo panel, not a
     * form column, so it earns the width), the form on the other, narrower and
     * generously padded. On a phone the photo collapses to a short band above
     * the form rather than disappearing — it is what tells a farmer at a
     * glance that this is an agriculture app and not a bank, before they have
     * read a word.
     */
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[7fr_3fr]">
      <FieldPanel
        message={panelMessage ?? t('auth:panelMessage')}
        imageAlt={t('auth:panelImageAlt')}
      />

      <div className="flex min-h-dvh flex-col lg:min-h-0">
        <header className="flex items-center justify-end px-4 py-3 sm:px-6">
          <LanguageToggle />
        </header>

        <main className="mx-auto flex w-full max-w-[24rem] flex-1 flex-col justify-center px-4 pb-10 sm:px-6">
          {/*
            The wordmark sits with the form on every width. It used to be
            `lg:invisible` on the assumption that the panel beside it carried the
            brand — but the panel is a wordless field, so on desktop the sign-in
            screen showed no product name at all.
          */}
          <p className="mb-6 flex items-center gap-2.5">
            <span
              className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-leaf-500 text-brand-900"
              aria-hidden="true"
            >
              <IconLeaf size={17} />
            </span>
            <span className="font-display text-lg font-extrabold tracking-[-0.03em]">
              {t('common:app.name')}
            </span>
          </p>

          <h1 ref={headingRef} tabIndex={-1} className="text-[2rem]">
            {title}
          </h1>
          <p className="mt-2 text-[0.938rem] text-ink-500">{subtitle}</p>
          <div className="mt-6">{children}</div>
          <div className="mt-5 text-sm text-ink-500">{footer}</div>
        </main>
      </div>
    </div>
  );
}

/**
 * The field.
 *
 * A real photograph (`public/images/auth/farmer-question.jpg`, self-hosted —
 * not hotlinked, so a broken CDN never breaks the sign-in screen) rather than
 * the earlier drawn gradient, per the design reference. A dark forest gradient
 * still rises from the bottom so the editorial line stays readable over
 * whatever the photo is doing at that edge.
 *
 * The design overlays a farmer's testimonial here. That quote is invented, and
 * an invented endorsement attributed to a named person is exactly what rule 7
 * forbids — so the panel carries a statement about the product instead, which
 * is a claim this system can actually stand behind.
 */
function FieldPanel({ message, imageAlt }: { message: ReactNode; imageAlt: string }) {
  return (
    <div className="relative h-40 overflow-hidden sm:h-64 lg:h-auto">
      <img
        src="/images/auth/farmer-question.jpg"
        alt={imageAlt}
        className="absolute inset-0 size-full object-cover"
        loading="eager"
      />

      {/* Decorative scrim — the photo carries no information text relies on. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-brand-900/92 via-brand-900/35 to-brand-900/5"
      />

      <p className="absolute inset-x-0 bottom-0 max-w-[20ch] p-6 font-display text-xl font-extrabold leading-tight text-white sm:p-8 lg:text-[1.625rem]">
        {message}
      </p>

      <div className="strata absolute inset-x-0 bottom-0" aria-hidden="true">
        <i className="bg-leaf-500" />
        <i className="bg-harvest-500" />
        <i className="bg-earth-600" />
        <i className="bg-earth-800" />
      </div>
    </div>
  );
}
