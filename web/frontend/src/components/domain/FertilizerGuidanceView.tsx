import { useTranslation } from 'react-i18next';

import { safeExternalUrl } from '@shared/client/url';

import type { FertilizerGuidance, FertilizerRecommendation, SourceRef } from '@/api/types';
import { translateMessageKey } from '@/i18n/messageKey';
import { EMPTY_VALUE } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { IconClock } from '@/components/ui/icons';
import { Notice } from '@/components/ui/states';
import { EmptyState } from '@/components/ui/states';

/**
 * Published fertilizer guidance.
 *
 * Everything on this screen is a number somebody else published, shown in the
 * unit they published it in, with a link back to where it came from. Three
 * pieces are mandatory and unconditional (`fertilizerService.js` attaches them
 * before any early return): the disclaimer, the "general recommendation, not a
 * prescription" framing, and the soil-test nudge. They are rendered here for
 * the uncovered case too, which is exactly when a farmer is most likely to go
 * looking for a number somewhere less careful.
 */
export function FertilizerGuidanceView({ guidance }: { guidance: FertilizerGuidance }) {
  const { t } = useTranslation(['fertilizer', 'common', 'agri']);

  if (!guidance.covered) {
    return (
      <div className="space-y-4">
        <EmptyState title={translateMessageKey(t, guidance.reasonKey ?? 'fertilizer.notCovered')} />
        <Notice tone="info" data-testid="fertilizer-disclaimer">
          {translateMessageKey(t, guidance.disclaimerKey)}
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {guidance.stage && <Badge tone="brand">{t(`agri:stage.${guidance.stage}`)}</Badge>}
        {guidance.guidanceTypeKey && (
          <Badge>{translateMessageKey(t, guidance.guidanceTypeKey)}</Badge>
        )}
      </div>

      {/*
        Three crops carry doses still awaiting a check against the original
        publication. Surfaced, never hidden — a farmer reading a number is
        entitled to know which tier of confidence it sits in.
      */}
      {guidance.verificationPending && guidance.verificationNoteKey && (
        <Notice tone="warning" data-testid="fertilizer-verification-pending">
          {translateMessageKey(t, guidance.verificationNoteKey)}
        </Notice>
      )}

      {guidance.recommendations.map((recommendation, index) => (
        <RecommendationCard key={index} recommendation={recommendation} />
      ))}

      {/*
        The design names this panel outright — "What we do not tell you" — and
        gives it the danger accent rather than the quiet info tone the limits
        used to carry. That is the right weight: on a screen full of doses, the
        boundary of what these numbers cover is the most consequential thing a
        farmer can read, and an info-blue note reads as a footnote.

        The text itself is unchanged and still comes from the guidance payload's
        own keys — this changes the framing, never the claim.
      */}
      {(guidance.limitationsKey || guidance.soilTestCtaKey) && (
        <section
          className="rounded-card border border-danger-600/30 bg-danger-50 p-5"
          data-testid="fertilizer-limits"
        >
          <h3 className="kicker text-danger-600">{t('fertilizer:limitsHeading')}</h3>

          {guidance.limitationsKey && (
            <p className="mt-2.5 text-sm leading-relaxed text-ink-700">
              {translateMessageKey(t, guidance.limitationsKey)}
            </p>
          )}

          {guidance.soilTestCtaKey && (
            <p
              className="mt-2.5 text-sm leading-relaxed text-ink-700"
              data-testid="fertilizer-soil-test-cta"
            >
              {translateMessageKey(t, guidance.soilTestCtaKey)}
            </p>
          )}
        </section>
      )}

      {/*
        This heading used to read `fertilizer:scheduleHeading` — "When to
        apply" — over the citation list, which labelled the provenance as a
        timing instruction. It now names what the list actually is.
      */}
      {guidance.sources.length > 0 && (
        <section className="space-y-2">
          <h3 className="kicker">{t('fertilizer:sourcesHeading')}</h3>
          <SourceList sources={guidance.sources} />
        </section>
      )}

      <Notice tone="warning" data-testid="fertilizer-disclaimer">
        {translateMessageKey(t, guidance.disclaimerKey)}
      </Notice>
    </div>
  );
}

function RecommendationCard({ recommendation }: { recommendation: FertilizerRecommendation }) {
  const { t } = useTranslation(['fertilizer', 'common']);

  return (
    <Card data-testid="fertilizer-recommendation">
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">
            {recommendation.basis === 'stcr_soil_test'
              ? t('fertilizer:basisSoilTest')
              : t('fertilizer:basisBlanket')}
          </Badge>
          <span className="text-sm text-ink-500">
            {recommendation.varietyClass
              ? t('fertilizer:varietyClassLabel', { varietyClass: recommendation.varietyClass })
              : t('fertilizer:varietyClassUnspecified')}
          </span>
        </div>

        <DoseBlock title={t('fertilizer:npkHeading')} dose={recommendation.totalNpk} />
        <DoseBlock title={t('fertilizer:organicsHeading')} dose={recommendation.organics} />
        <DoseBlock
          title={t('fertilizer:micronutrientsHeading')}
          dose={recommendation.micronutrients}
        />

        {recommendation.schedule.length > 0 && (
          <section className="space-y-2">
            <h4 className="kicker">{t('fertilizer:scheduleHeading')}</h4>
            <ol className="overflow-hidden rounded-control border border-line">
              {recommendation.schedule.map((step, index) => (
                <li
                  key={`${step.stage}-${index}`}
                  className="flex gap-3 border-b border-line px-4 py-3.5 last:border-b-0"
                  data-testid="fertilizer-schedule-step"
                >
                  {/*
                    A step number rather than the stored stage code. `BASAL`,
                    `TOPDRESS_1`, `PANICLE_INITIATION` are engine identifiers,
                    and translating them would mean inventing Hindi agronomic
                    vocabulary with no source behind it (rule 8). The order is
                    the part a farmer actually needs, and the sentence beside it
                    already says what the application is.
                  */}
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 font-display text-xs font-bold text-brand-600"
                  >
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      {/* `fractionKey` is the only i18n key on a schedule step. */}
                      <p className="min-w-0 text-sm font-semibold">
                        <span className="sr-only">
                          {t('fertilizer:stepNumber', { index: index + 1 })}:{' '}
                        </span>
                        {translateMessageKey(t, step.fractionKey)}
                      </p>
                      {step.isCurrent && <Badge tone="warning">{t('fertilizer:dueNow')}</Badge>}
                    </div>

                    {/*
                      The published timing is the source's own words, carried
                      through untranslated the way every other published figure
                      on this screen is — `lang="en"` so a Hindi screen reader
                      does not attempt "30 DAS" in Hindi.
                    */}
                    {step.timing && (
                      <p
                        className="inline-flex items-center gap-1.5 rounded-full bg-mute px-2.5 py-0.5 text-xs font-medium text-ink-700"
                        lang="en"
                        data-testid="fertilizer-timing"
                      >
                        <IconClock size={13} aria-hidden="true" />
                        {step.timing}
                      </p>
                    )}

                    {/*
                      An entry whose published timing could not be resolved to a
                      day window is never highlighted as due. Saying so is the
                      difference between "not now" and "we cannot tell when".
                    */}
                    {step.timingUnknown && (
                      <p className="text-xs text-ink-500" data-testid="fertilizer-timing-unknown">
                        {t('fertilizer:timingNotPublished')}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/*
          The source's own words, one disclosure away.

          They used to sit inline under every figure, which put editorial notes
          written for whoever maintains the knowledge base ("gap F1", "not added
          into totalNpk") straight onto a farmer's screen — the dense, unreadable
          block this replaces. The provenance is not dropped, because a farmer
          checking a dose against the PDF needs the exact printed string; it is
          simply behind a summary, labelled as a quotation, and only the quoted
          `published` text is shown. The maintenance notes are not farmer-facing
          content and are not rendered at all.
        */}
        <AsPublished recommendation={recommendation} />

        <SourceList sources={[recommendation.source]} />
      </div>
    </Card>
  );
}

/**
 * Keys on a dose object that describe the dose rather than name a nutrient.
 *
 * `unit`, `published` and `unitNote` come from the knowledge base;
 * `unitUnknown` and `unitNoteKey` are added by `presentDose` in
 * `fertilizerService.js`. Iterating a dose blindly — which is what this view
 * used to do — rendered all five as though they were nutrients, so a farmer
 * saw a row reading `unitNoteKey  fertilizer.unitNotPublished` next to the
 * nitrogen figure. The nutrient rows are whatever is left after these.
 */
const DOSE_METADATA_KEYS = new Set([
  'unit',
  'unitNote',
  'unitUnknown',
  'unitNoteKey',
  'published',
  'note',
]);

/**
 * Chemical notation for the keys the knowledge base uses.
 *
 * A map over *field names*, not crop codes — rule 4 is untouched. The formulas
 * are script-neutral and are not translated; the two word-shaped labels are the
 * source's own English and are tagged as such at the render site. An unmapped
 * key falls back to its own name upper-cased rather than being hidden, so a
 * nutrient added to the knowledge base still reaches the farmer.
 */
const NUTRIENT_LABEL: Record<string, string> = {
  n: 'N',
  p2o5: 'P₂O₅',
  k2o: 'K₂O',
  znso4: 'ZnSO₄',
  mgso4: 'MgSO₄',
  fym: 'FYM',
  sulphur: 'S',
  borax: 'Borax',
};

/**
 * One published dose, as a row of figures.
 *
 * Every number is shown exactly as published — nothing here converts, rounds or
 * recombines one, because the published figure is the whole authority for it. A
 * dose the source printed with no unit says so in its own sentence
 * (`unitNoteKey`) instead of borrowing a unit from a neighbouring row.
 */
function DoseBlock({ title, dose }: { title: string; dose: Record<string, unknown> | null }) {
  const { t } = useTranslation(['fertilizer', 'common']);

  const nutrients = dose
    ? Object.entries(dose).filter(([key, value]) => !DOSE_METADATA_KEYS.has(key) && value != null)
    : [];

  if (nutrients.length === 0) return null;

  const sharedUnit = typeof dose?.unit === 'string' ? dose.unit : null;
  const unitNoteKey = typeof dose?.unitNoteKey === 'string' ? dose.unitNoteKey : null;

  return (
    <section className="space-y-2" data-testid="fertilizer-dose">
      <h4 className="kicker">{title}</h4>

      <div className="flex flex-wrap gap-2.5">
        {nutrients.map(([nutrient, value]) => {
          const amount = doseAmount(value);
          const unit = doseUnit(value) ?? sharedUnit;
          const label = NUTRIENT_LABEL[nutrient];

          return (
            <div
              key={nutrient}
              className="min-w-[5.5rem] rounded-control border border-line bg-canvas px-4 py-3"
            >
              <p className="font-display text-2xl font-extrabold leading-none tracking-[-0.03em] tabular-nums">
                {amount}
                {unit && <span className="ml-1 text-sm font-semibold">{unit}</span>}
              </p>
              {/* Unmapped keys keep the source's own spelling, hence `lang="en"`. */}
              <p className="kicker mt-2" lang={label ? undefined : 'en'}>
                {label ?? nutrient.toUpperCase()}
              </p>
            </div>
          );
        })}
      </div>

      {/*
        Rule 9 in one line: a figure whose unit the source never printed is
        labelled as such rather than being quietly given the unit its
        neighbours use.
      */}
      {!sharedUnit && unitNoteKey && (
        <p className="text-xs text-ink-500" data-testid="fertilizer-unit-note">
          {translateMessageKey(t, unitNoteKey)}
        </p>
      )}
    </section>
  );
}

/** Narrows an unknown dose entry to the record shape, or null for a scalar. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** A dose value is a number, a published `[min, max]` range, or `{value, unit}`. */
function doseAmount(value: unknown): string {
  const record = asRecord(value);
  const raw = record ? (record.value ?? record.amount) : value;

  if (Array.isArray(raw)) return raw.map((entry) => String(entry)).join('–');
  if (raw === null || raw === undefined) return EMPTY_VALUE;
  if (typeof raw === 'object') return EMPTY_VALUE;
  return String(raw);
}

function doseUnit(value: unknown): string | null {
  const unit = asRecord(value)?.unit;
  return typeof unit === 'string' ? unit : null;
}

/**
 * The exact strings the source printed, for a farmer checking a figure against
 * the original — collapsed by default so the readable version above stays the
 * page. Only `published` text is quoted; the knowledge base's own maintenance
 * notes are not shown, because they are written for whoever verifies the PDF.
 */
function AsPublished({ recommendation }: { recommendation: FertilizerRecommendation }) {
  const { t } = useTranslation(['fertilizer', 'common']);

  const quotes = [
    recommendation.totalNpk,
    recommendation.organics,
    recommendation.micronutrients,
  ].flatMap((dose) => publishedStrings(dose));

  if (quotes.length === 0) return null;

  return (
    <details className="rounded-control bg-canvas px-4 py-3" data-testid="fertilizer-as-published">
      <summary className="cursor-pointer text-sm font-medium text-brand-700">
        {t('fertilizer:asPublishedHeading')}
      </summary>
      <ul className="mt-2.5 space-y-1.5">
        {quotes.map((quote, index) => (
          <li key={index} className="text-xs leading-relaxed text-ink-700" lang="en">
            “{quote}”
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The `published` strings on a dose and on any nested per-nutrient object. */
function publishedStrings(dose: Record<string, unknown> | null): string[] {
  if (!dose) return [];

  const found: string[] = [];
  if (typeof dose.published === 'string') found.push(dose.published);

  for (const [key, value] of Object.entries(dose)) {
    if (DOSE_METADATA_KEYS.has(key) || value === null || typeof value !== 'object') continue;
    const nested = asRecord(value)?.published;
    if (typeof nested === 'string') found.push(nested);
  }

  return found;
}

/**
 * Attribution.
 *
 * The citation URL is a *data* field on an API response, so it is passed
 * through `safeExternalUrl` before it can become an `href`: React copies
 * `javascript:` into the attribute verbatim, and a citation is exactly the kind
 * of low-attention link a farmer clicks. A refused URL still renders — as text
 * beside the citation, the way the mobile client renders every URL — because
 * losing the provenance would be a worse outcome than not linking it.
 */
export function SourceList({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) return null;

  return (
    <ul className="space-y-1 text-xs text-ink-500" data-testid="source-list">
      {sources.map((source, index) => {
        const href = safeExternalUrl(source.url);

        return (
          <li key={`${source.org}-${index}`}>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2 hover:text-brand-700"
              >
                {source.org} — {source.title}
              </a>
            ) : (
              <span>{[source.org, source.title, source.url].filter(Boolean).join(' — ')}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
