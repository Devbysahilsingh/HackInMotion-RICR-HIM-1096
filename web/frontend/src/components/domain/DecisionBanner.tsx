import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { FeedItem, Freshness, Priority } from '@/api/types';
import { translateMessageKey } from '@/i18n/messageKey';
import { Button } from '@/components/ui/Button';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { SpeakButton } from '@/components/ui/SpeakButton';
import { IconAlertTriangle, IconCheck, IconChevronRight, IconInfo } from '@/components/ui/icons';
import { localizeCropParams, useCropNames } from '@/hooks/useCropNames';
import { cn } from '@/lib/cn';
import { feedTarget } from '@/lib/feedTarget';
import { WhyTrace } from './WhyTrace';

/**
 * The answer to "what do I need to do today?".
 *
 * This is the design reference's single strongest idea. Its dashboard does not
 * open with a grid of metrics — it opens with one sentence, set large, on a
 * coloured field: *"Skip irrigation today"*. Everything else on the page is
 * supporting evidence for that sentence.
 *
 * So this component is deliberately **not** a card. It is a full-bleed band in
 * a tone taken from the item's own priority, and it renders exactly one feed
 * item — the highest-priority one the API returned. The rest of the feed stays
 * below as ordinary cards. The hierarchy is the feature: a farmer who reads
 * nothing else has still read the thing that mattered.
 *
 * Nothing here is authored locally. The headline is the item's `titleKey` and
 * the sentence under it is its `bodyKey`, both resolved through the same
 * knowledge-base translation path every other surface uses (rule 8), with the
 * item's `data` as interpolation params. If the engine had nothing to say,
 * there is no banner.
 */

/**
 * Tone per priority. CRITICAL and HIGH get their own grounds; MEDIUM and INFO
 * share the calm forest, because "here is something worth knowing" should not
 * look like an alarm — the reference reserves the warm grounds for genuine
 * urgency and this keeps that discipline.
 */
const TONE: Record<Priority, { band: string; Icon: typeof IconInfo }> = {
  CRITICAL: { band: 'bg-danger-600', Icon: IconAlertTriangle },
  HIGH: { band: 'bg-[#9a6b12]', Icon: IconAlertTriangle },
  MEDIUM: { band: 'bg-brand-600', Icon: IconInfo },
  INFO: { band: 'bg-brand-600', Icon: IconInfo },
};

export function DecisionBanner({
  item,
  onAcknowledge,
  isAcknowledging = false,
}: {
  item: FeedItem;
  onAcknowledge?: (item: FeedItem) => void;
  isAcknowledging?: boolean;
}) {
  const { t } = useTranslation(['common', 'irrigation', 'weather', 'market', 'health']);
  const cropName = useCropNames();

  const params = localizeCropParams(item.data, cropName);
  const title = translateMessageKey(t, item.titleKey, params);
  const body = translateMessageKey(t, item.bodyKey, params);
  const trace = item.data?.trace ?? null;
  const freshness = isFreshness(item.data?.freshness) ? item.data.freshness : null;

  const tone = TONE[item.priority] ?? TONE.INFO;
  const { Icon } = tone;
  const target = feedTarget(item);

  return (
    <section
      data-testid="decision-banner"
      data-priority={item.priority}
      aria-labelledby="decision-banner-title"
      className={cn('furrow relative overflow-hidden rounded-[18px] text-white', tone.band)}
    >
      <div className="px-5 py-6 sm:px-[30px] sm:py-7">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.6875rem] font-semibold uppercase tracking-[0.13em] text-white/70">
          <Icon size={14} />
          {/*
            The priority word, not a decorative label: it is the accessible
            equivalent of the band's colour, so the meaning survives greyscale
            and screen readers alike (accessibility.md — never colour-alone).
          */}
          <span>{t(`common:priority.${item.priority}`)}</span>
          {freshness && (
            <FreshnessDot
              freshness={freshness}
              className="text-white/70"
              data-testid="decision-freshness"
            />
          )}
        </p>

        {/*
          `text-white` sits on the heading itself, not on the section. The base
          layer sets an explicit colour on h1–h4, and an explicitly-coloured
          element does not inherit — so a `text-white` on the parent loses and
          the headline renders in near-black on a coloured ground.
        */}
        <h2
          id="decision-banner-title"
          className="mt-3 max-w-3xl text-[1.75rem] leading-[1.06] text-white sm:text-[2.125rem]"
        >
          {title}
        </h2>

        {body && <p className="mt-3 max-w-2xl text-[0.9375rem] text-white/85">{body}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {target && (
            /*
             * A link, not a button: it navigates, so the browser's own
             * middle-click, open-in-new-tab and status bar have to keep
             * working. It is styled as the banner's primary action because on
             * a coloured ground a white pill is the only thing with enough
             * contrast to read as one.
             */
            <Link
              to={target}
              className="touch-target inline-flex items-center justify-center gap-2 rounded-full bg-white px-[18px] py-2.5 font-display text-sm font-semibold text-brand-600 transition-colors hover:bg-leaf-tint"
            >
              {t('common:action.viewAll')}
              <IconChevronRight size={16} />
            </Link>
          )}

          {onAcknowledge && item.acknowledgedAt === null && (
            <Button
              variant="ghost"
              className="text-white hover:bg-white/15"
              data-testid="decision-ack"
              onClick={() => onAcknowledge(item)}
              isLoading={isAcknowledging}
              leadingIcon={<IconCheck size={16} />}
            >
              {t('common:action.done')}
            </Button>
          )}

          <SpeakButton text={`${title}. ${body}`} className="text-white hover:bg-white/15" />
        </div>

        {/*
          The explanation, inline. The reference's own caption for this screen is
          "One answer, with the working shown" — putting the reasoning a
          navigation away would make it something nobody reads.
        */}
        {/*
          The trace keeps its own cream panel rather than being recoloured to
          match the band. Forcing white text onto it made a light surface carry
          white type — invisible. A pale panel on the coloured ground also reads
          correctly as "this is the evidence, not the verdict".
        */}
        {trace != null && (
          <div className="mt-5 border-t border-white/20 pt-4">
            <WhyTrace trace={trace} />
          </div>
        )}
      </div>

      {/*
        Soil strata — decorative only, hence aria-hidden. It gives the band a
        ground to sit on, which is what stops a large flat colour field from
        reading as an error state.
      */}
      <div className="strata" aria-hidden="true">
        <i className="bg-leaf-500" />
        <i className="bg-harvest-500" />
        <i className="bg-earth-600" />
        <i className="bg-earth-800" />
      </div>
    </section>
  );
}

function isFreshness(value: unknown): value is Freshness {
  return (
    typeof value === 'object' && value !== null && typeof (value as Freshness).status === 'string'
  );
}
