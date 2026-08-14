import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

/**
 * Document title + route-change focus.
 *
 * Extracted from `PageHeader` because the design gives several screens a
 * full-bleed hero band instead of a plain page header, and those still owe the
 * same two guarantees: the document title follows the route, and focus moves to
 * the page's heading on every navigation (accessibility.md, routes.md). A hero
 * that quietly dropped both would be an accessibility regression dressed as a
 * visual improvement.
 *
 * It lives in `hooks/` rather than beside `PageHeader` because a component file
 * that also exports a plain function breaks Fast Refresh — the same reason
 * `feedTarget` has its own module.
 *
 * Returns the ref to attach to the `<h1>`; the caller gives that heading
 * `tabIndex={-1}` so it can receive programmatic focus.
 */
export function usePageHeading(title: string) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { t } = useTranslation('common');
  const location = useLocation();

  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`;
    headingRef.current?.focus();
  }, [title, location.key, t]);

  return headingRef;
}
