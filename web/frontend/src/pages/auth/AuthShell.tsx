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
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <p className="flex items-center gap-2 text-base font-semibold text-brand-700">
          <IconLeaf size={22} />
          {t('app.name')}
        </p>
        <LanguageToggle />
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-10 sm:px-0">
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h1 ref={headingRef} tabIndex={-1} className="text-xl">
            {title}
          </h1>
          <p className="mt-1 text-sm text-ink-500">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        <div className="mt-4 text-center text-sm text-ink-500">{footer}</div>
      </main>
    </div>
  );
}
