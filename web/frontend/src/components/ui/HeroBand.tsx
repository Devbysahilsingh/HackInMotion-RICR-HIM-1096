import type { ReactNode, Ref } from 'react';

import { cn } from '@/lib/cn';

/**
 * The design's page hero: a deep image band with the title laid over it, and a
 * strip of divided facts sitting underneath inside the same card.
 *
 * It opens the farm, crop and suitability screens. The pattern earns its place
 * by answering "where am I, and what is this thing" in one block — the title
 * names the subject, the strip carries the four constants a farmer checks
 * against every decision on the page (soil, water, weather, market).
 *
 * There is no photograph. `Crop` and `Farm` carry no image field, so the band
 * uses the design's own `.ph` gradient (see index.css) unless a caller passes a
 * real, farmer-supplied image — currently only a crop-health photo qualifies.
 * The gradient is deliberately not a stock photo of someone else's field.
 *
 * The overlay runs left-to-right rather than bottom-up, per the design: the text
 * sits bottom-left, so darkening the left edge protects legibility while leaving
 * the right side of the band open.
 */
export function HeroBand({
  title,
  subtitle,
  eyebrow,
  imageUrl,
  imageAlt,
  stats,
  footer,
  actions,
  className,
  titleRef,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small pill above the title — season, status, crop code. */
  eyebrow?: ReactNode;
  /** A real image the farmer supplied. Omitted → the `.ph` gradient. */
  imageUrl?: string | null;
  imageAlt?: string;
  /** The divided fact strip. Rendered only when at least one is given. */
  stats?: Array<{ label: string; value: ReactNode }>;
  /**
   * A full-width row inside the same card, under the band and any stat strip.
   * The crop screen puts its stage timeline here: the design keeps "where in
   * the season is this?" attached to the crop's own hero rather than floating
   * it as a separate widget, and a caller cannot achieve that by wrapping,
   * because the card's rounded corners and border belong to this component.
   */
  footer?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /**
   * Attach `usePageHeading()`'s ref so this hero's `<h1>` is the element route
   * changes move focus to. Without it a hero page is a focus dead-end.
   */
  titleRef?: Ref<HTMLHeadingElement>;
}) {
  const visible = (stats ?? []).filter((stat) => stat.value !== null && stat.value !== undefined);

  return (
    <section
      className={cn(
        'overflow-hidden rounded-card border border-line bg-surface shadow-card',
        className,
      )}
    >
      <div className={cn('relative h-[220px]', !imageUrl && 'ph')}>
        {imageUrl && <img src={imageUrl} alt={imageAlt ?? ''} className="size-full object-cover" />}

        {/*
          Decorative scrim. `aria-hidden` because it carries no information — it
          exists so white text clears contrast against whatever is behind it.
        */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-brand-800/[0.86] to-brand-800/10"
        />

        <div className="absolute bottom-[22px] left-5 right-5 sm:left-6">
          {eyebrow && (
            <span className="inline-flex items-center rounded-full bg-white/20 px-[11px] py-1 text-[0.719rem] font-semibold text-white">
              {eyebrow}
            </span>
          )}
          {/*
            `text-white` on the heading itself: the base layer gives h1–h4 an
            explicit colour, and an explicitly-coloured element does not inherit.
          */}
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="mt-2.5 text-[1.75rem] text-white sm:text-[2.25rem]"
          >
            {title}
          </h1>
          {subtitle && <p className="mt-1.5 text-[0.906rem] text-brand-100">{subtitle}</p>}
        </div>

        {/*
          Wraps, and is width-bounded. Three actions (harvest, photo, delete)
          at 360px would otherwise run off the right edge of the band and take
          the whole page into horizontal scroll — the one thing the documented
          mobile floor forbids.
        */}
        {actions && (
          <div className="absolute right-5 top-5 flex max-w-[calc(100%-2.5rem)] flex-wrap justify-end gap-2">
            {actions}
          </div>
        )}
      </div>

      {visible.length > 0 && (
        <dl className="grid grid-cols-2 border-t border-line lg:grid-cols-4">
          {visible.map((stat, index) => (
            <div
              key={stat.label}
              className={cn(
                'px-5 py-4',
                // Dividers between, never trailing — a border on the last cell
                // draws a line against the card's own edge.
                index % 2 === 0 && 'border-r border-line lg:border-r',
                index < visible.length - (visible.length % 2 === 0 ? 2 : 1) &&
                  'border-b border-line lg:border-b-0',
                'lg:border-r lg:last:border-r-0',
              )}
            >
              <dt className="kicker">{stat.label}</dt>
              <dd className="mt-1 text-base font-semibold">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {footer && <div className="border-t border-line px-5 py-4">{footer}</div>}
    </section>
  );
}
