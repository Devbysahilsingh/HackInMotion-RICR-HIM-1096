import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { cropsApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { HealthLog } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { formatDateTime, localizedName } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Card';
import { FreshnessDot, SourceLabel } from '@/components/ui/FreshnessDot';
import { SpeakButton } from '@/components/ui/SpeakButton';
import { Notice } from '@/components/ui/states';
import { ConfidenceBar, type ConfidenceKind } from './ConfidenceBar';
import { DiseaseName } from './DiseaseName';
import { SourceList } from './FertilizerGuidanceView';
import { WhyTrace } from './WhyTrace';

/**
 * The photo-check result.
 *
 * Section order is fixed by ux-flows.md and is not cosmetic — it is the order a
 * farmer needs the answer in: the leaf they photographed beside the verdict and
 * its confidence, then what we saw, then what to do, then what to watch, then
 * when to call a human. The technical account of *how* the answer was reached
 * is the only thing behind a disclosure, because it is the only part a farmer
 * does not need in order to act.
 *
 * ## Every branch is a designed state
 *
 * There are four, and none of them is an error page:
 *
 * 1. **Confident** — a named condition with guidance from the knowledge base.
 * 2. **Uncertain** — no tier could name it. This renders the retake advice and
 *    the guided-questions route, and deliberately does **not** show a
 *    "diagnosis" with a low number beside it. An uncertain result is a real
 *    outcome, not a failure to be dressed up (ai-safety: "uncertain results are
 *    never forced into predictions").
 * 3. **Unusable photo** — `imageAssessment` says the image was not a plant, was
 *    too unclear, or was the wrong crop. The farmer is told what to change.
 * 4. **Healthy** — a named healthy class. Treated as a verdict in its own
 *    right, with prevention guidance rather than treatment.
 *
 * Nothing on this page is authored by a model. Guidance renders from the
 * registry's i18n keys; the AI's own words appear only under their own
 * attributed heading, clearly marked as observations.
 */
export function AnalysisResult({ log }: { log: HealthLog }) {
  const { t } = useTranslation(['health', 'common', 'disease', 'agri', 'crop']);

  const data = log.recommendation.data;
  const analysis = log.analysis;

  const isUnknown = !analysis.diseaseCode || analysis.diseaseCode === 'UNKNOWN';
  const unusablePhoto = data.imageAssessment != null && data.imageAssessment !== 'OK';

  const title = translateMessageKey(t, log.recommendation.titleKey);

  const spokenSummary = [
    title,
    ...(data.symptomKeys ?? []).map((key) => translateMessageKey(t, key)),
    ...(data.nextStepKeys ?? []).map((key) => translateMessageKey(t, key)),
  ].join('. ');

  return (
    <div className="space-y-5" data-testid="analysis-result" data-unknown={isUnknown}>
      {/* ── The leaf, the verdict, the confidence ────────────────────── */}
      <div className="grid items-start gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Card className="overflow-hidden">
          <div className="grid sm:grid-cols-[minmax(0,15rem)_1fr]">
            {/*
              The farmer's own photograph, at the size of evidence. This is the
              stored copy of the exact file they submitted — never a stock
              image, never a placeholder — so "which photo was analysed?" is
              never a question the page leaves open.
            */}
            <div className="flex items-center justify-center border-line bg-canvas p-3 sm:border-r">
              {log.imageUrl ? (
                <img
                  src={log.imageUrl}
                  alt={t('health:photoAlt')}
                  className="max-h-64 w-full rounded-lg object-contain"
                  data-testid="analysis-photo"
                />
              ) : (
                <div className="ph h-48 w-full rounded-lg" aria-hidden="true" />
              )}
            </div>

            <div className="space-y-3.5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <SourceLabel sourceLabelKey={analysis.sourceLabelKey} />
                  {analysis.severityAssessment && (
                    <Badge
                      tone={analysis.severityAssessment === 'SEVERE' ? 'danger' : 'warning'}
                      data-testid="severity-badge"
                    >
                      {t(`health:severity${titleCase(analysis.severityAssessment)}`)}
                    </Badge>
                  )}
                </div>
                <SpeakButton text={spokenSummary} />
              </div>

              {/*
                The diagnosis at display scale — it is the answer the farmer
                photographed a leaf to get. The registry's own name for the
                condition stays secondary underneath rather than competing.
              */}
              <div className="min-w-0">
                <h2 className="text-[1.5rem] leading-tight sm:text-[1.875rem]">{title}</h2>
                {!isUnknown && (
                  <p className="mt-1.5 text-base text-ink-500" data-testid="disease-name">
                    <DiseaseName code={analysis.diseaseCode} showFallbackNote />
                  </p>
                )}
              </div>

              <ConfidenceBar
                confidence={analysis.confidence}
                kind={data.confidenceKind as ConfidenceKind}
                band={data.confidenceBand ?? null}
              />

              <ScanMeta log={log} />

              <div className="flex flex-wrap items-center gap-3">
                <FreshnessDot freshness={log.freshness} />
                {analysis.modelVersion && <Badge>{analysis.modelVersion}</Badge>}
                {/*
                  Through to the full knowledge-base entry. The result carries
                  the few lines that matter now; the rest — what to inspect, how
                  to keep it out next season — lives on the disease's own page.
                */}
                {!isUnknown && analysis.diseaseCode && (
                  <Link
                    to={`/health/disease/${encodeURIComponent(analysis.diseaseCode)}`}
                    className="text-sm font-semibold text-brand-600 underline underline-offset-2"
                    data-testid="disease-detail-link"
                  >
                    {t('health:fullGuidanceCta')}
                  </Link>
                )}
              </div>

              {log.freshness.status === 'cached' && (
                <Notice tone="info" data-testid="cached-notice">
                  {t('health:cachedNotice')}
                </Notice>
              )}
            </div>
          </div>
        </Card>

        {/* ── What we saw ────────────────────────────────────────────── */}
        <WhatWeSaw log={log} />
      </div>

      {/* ── Branch: the photo itself could not be used ───────────────── */}
      {unusablePhoto && (
        <Notice tone="warning" data-testid="image-assessment">
          {t(`health:imageAssessment${data.imageAssessment}`, {
            defaultValue: t('health:uncertainRetake'),
          })}
        </Notice>
      )}

      {/* ── Branch: nothing could be named ───────────────────────────── */}
      {isUnknown && (
        <div className="space-y-3" data-testid="uncertain-branch">
          <Notice tone="warning">{t('health:uncertainRetake')}</Notice>
          <div className="flex flex-wrap gap-2">
            <ButtonLink to={`/scan?cropId=${log.cropId}`} variant="secondary">
              {t('health:photoReplace')}
            </ButtonLink>
            <ButtonLink to={`/scan/symptoms?cropId=${log.cropId}`}>
              {t('health:symptomCheckCta')}
            </ButtonLink>
          </div>
        </div>
      )}

      {/* ── Coverage honesty ─────────────────────────────────────────── */}
      {log.coverageNoticeKey && (
        <Notice tone="info" data-testid="coverage-notice">
          {translateMessageKey(t, log.coverageNoticeKey)}
        </Notice>
      )}

      {/* ── What to do now, as numbered actions ──────────────────────── */}
      <ActionSteps titleKey="health:actionsHeading" keys={data.nextStepKeys} testId="next-steps" />

      <div className="grid items-start gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-5">
          {/* ── What to watch ────────────────────────────────────────── */}
          <WatchList keys={data.inspectKeys} />

          <KeyList
            titleKey="health:preventionHeading"
            keys={data.preventionKeys}
            testId="prevention"
          />

          {/* ── When to call a human ─────────────────────────────────── */}
          {(analysis.escalated || isUnknown) && (
            <Notice tone="danger" data-testid="expert-referral">
              {t('health:expertReferral')}
            </Notice>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {/*
            The technical account, and the only thing folded away — a farmer who
            has read the verdict, the observations and the steps has what they
            need to act; which tier answered and why is the auditor's question.
          */}
          <WhyThisResult log={log} />

          <ResultActions log={log} />
        </div>
      </div>
    </div>
  );
}

/**
 * The scan's context line: when it was taken, and against which planting.
 *
 * The crop's name, stage and area come from `GET /crops/:id` — the record the
 * scan is filed against — rather than from the analysis, which carries none of
 * them. A crop that has since been deleted simply drops the line rather than
 * rendering "undefined".
 */
function ScanMeta({ log }: { log: HealthLog }) {
  const { t } = useTranslation(['health', 'agri', 'common']);
  const { language } = useLanguage();

  const cropQuery = useQuery({
    queryKey: queryKeys.crops.detail(log.cropId),
    queryFn: () => cropsApi.get(log.cropId),
    enabled: Boolean(log.cropId),
    staleTime: STALE_TIME.slowMoving,
    retry: false,
  });

  const crop = cropQuery.data?.crop ?? null;

  const parts = [
    t('health:scanMetaLine', { when: formatDateTime(log.createdAt, language) }),
    crop ? (localizedName(crop.registry.names, language)?.text ?? crop.cropCode) : null,
    crop?.stage.stage ? t(`agri:stage.${crop.stage.stage}`) : null,
    crop?.areaValue != null
      ? `${crop.areaValue} ${t(`common:unit.${crop.areaUnit ?? 'acre'}`)}`
      : null,
  ].filter(Boolean);

  return (
    <p className="text-sm text-ink-500" data-testid="scan-meta">
      {parts.join(' · ')}
    </p>
  );
}

/**
 * What the check actually observed.
 *
 * Two genuinely different sources, kept apart. The knowledge base's symptom
 * lines describe the *named condition* and are translated; the AI tier's
 * observations are free English text about *this photograph* and stay English
 * under their own attributed heading (docs/i18n/architecture.md), because
 * translating a model's prose would be inventing agronomic Hindi.
 *
 * When neither exists the card says so rather than disappearing — a farmer
 * should be able to tell "we saw nothing worth listing" from "this section is
 * broken".
 */
function WhatWeSaw({ log }: { log: HealthLog }) {
  const { t } = useTranslation(['health', 'disease']);

  const data = log.recommendation.data;
  const symptoms = data.symptomKeys ?? [];
  const observations = data.aiObservations ?? [];

  return (
    <Card className="h-full border-harvest-500/30 bg-harvest-tint p-5" data-testid="what-we-saw">
      <h2 className="kicker text-harvest-700">{t('health:whatWeSawHeading')}</h2>

      {symptoms.length === 0 && observations.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-700">{t('health:noGuidance')}</p>
      ) : (
        <>
          {symptoms.length > 0 && (
            <ul
              className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-700"
              data-testid="symptoms"
            >
              {symptoms.map((key) => (
                <li key={key}>{translateMessageKey(t, key)}</li>
              ))}
            </ul>
          )}

          {observations.length > 0 && (
            <div className="mt-4 border-t border-harvest-500/30 pt-3">
              <p className="kicker text-harvest-700">{t('health:aiObservationsHeading')}</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-700">
                {observations.map((observation, index) => (
                  <li key={index} lang="en">
                    {observation}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-500">{t('health:aiObservationsNote')}</p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * The steps, numbered.
 *
 * The design's strongest idea on this screen: a farmer holding a phone at the
 * edge of a field needs an ordered list of things to do, not a bulleted
 * paragraph. The order is the knowledge base's own — the numbers are a
 * rendering of `nextStepKeys`' sequence, not a ranking invented here — and the
 * text is entirely the sourced KB's. No dose, product name or chemical appears
 * unless the knowledge base published it.
 */
function ActionSteps({
  titleKey,
  keys,
  testId,
}: {
  titleKey: string;
  keys: string[] | undefined;
  testId: string;
}) {
  const { t } = useTranslation(['health', 'disease']);

  if (!keys || keys.length === 0) return null;

  return (
    <Card className="p-5" data-testid="actions-card">
      <h2 className="kicker">{t(titleKey)}</h2>
      <ol className="mt-3 grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3" data-testid={testId}>
        {keys.map((key, index) => (
          <li key={key} className="border-l-2 border-brand-600 pl-4">
            <span className="font-display text-[1.25rem] font-extrabold leading-none text-brand-600">
              {index + 1}
            </span>
            <p className="mt-2 text-sm leading-relaxed text-ink-700">
              {translateMessageKey(t, key)}
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * What to watch over the coming week.
 *
 * These are the knowledge base's `inspect` lines — what to go back and look at
 * — which is exactly the design's "what to watch" section. They are rendered as
 * rows rather than bullets so each reads as a separate thing to check.
 *
 * The design puts an urgency chip beside each row ("Act fast" / "Spreading" /
 * "Holding"). The knowledge base publishes no such ranking, and assigning one
 * here would be this component grading agronomic urgency — so the rows carry no
 * chip rather than a guessed one.
 */
function WatchList({ keys }: { keys: string[] | undefined }) {
  const { t } = useTranslation(['health', 'disease']);

  if (!keys || keys.length === 0) return null;

  return (
    <Card className="p-5">
      <h2 className="kicker">{t('health:watchHeading')}</h2>
      <ul className="mt-2" data-testid="inspect">
        {keys.map((key) => (
          <li
            key={key}
            className="border-b border-line py-3 text-sm leading-relaxed text-ink-700 last:border-b-0"
          >
            {translateMessageKey(t, key)}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Why this result — the tier walk, the severity working and the citations.
 *
 * A `<details>`, and the only one on the page. Everything a farmer acts on is
 * already visible above; this is the provenance an auditor (or a sceptical
 * farmer) opens. `WhyTrace` keeps its own toggle inside, which is why the
 * heading text the suite looks for still renders when this is closed.
 */
function WhyThisResult({ log }: { log: HealthLog }) {
  const { t } = useTranslation(['health', 'common']);

  const analysis = log.analysis;
  const data = log.recommendation.data;

  const hasSources = Boolean(data.sourceRefs && data.sourceRefs.length > 0);
  const hasEscalation = analysis.escalationPath.length > 0;
  const hasSeverity = Boolean(data.severityTrace && data.severityTrace.length > 0);

  if (!hasSources && !hasEscalation && !hasSeverity) return null;

  return (
    <Card className="p-5" data-testid="why-this-result">
      <h2 className="kicker">{t('health:whyResultHeading')}</h2>

      <div className="mt-3 space-y-4">
        {/*
          The escalation path names the provider that declined rather than an
          engine step, so it is relabelled here rather than teaching WhyTrace a
          second shape. The remaining fields — `reason`, and `status` when the
          hop failed with an HTTP code — become the step's rows.
        */}
        {hasEscalation && (
          <Section title={t('health:escalationHeading')} as="h3">
            <WhyTrace
              trace={analysis.escalationPath.map(({ provider, ...rest }) => ({
                step: provider,
                ...rest,
              }))}
            />
          </Section>
        )}

        {hasSeverity && (
          <Section title={t('health:severityHeading')} as="h3">
            <WhyTrace trace={data.severityTrace!} />
          </Section>
        )}

        {hasSources && (
          <Section title={t('health:sourcesHeading')} as="h3">
            <SourceList sources={data.sourceRefs!} />
          </Section>
        )}
      </div>
    </Card>
  );
}

/**
 * What to do with the result.
 *
 * There is deliberately no "save to crop record" button: the scan is already in
 * the record. `POST /crop-health/analyze` persists a `CropHealthLog` against
 * the user, the crop *and* the farm before it responds, so a save control would
 * be a button that did nothing — worse, it would imply the farmer could lose
 * the scan by not pressing it. The link says where it went instead.
 */
function ResultActions({ log }: { log: HealthLog }) {
  const { t } = useTranslation(['health', 'common']);

  return (
    <Card className="p-5" data-testid="result-actions">
      <div className="flex flex-wrap gap-3">
        <ButtonLink to={`/crops/${log.cropId}?tab=health`}>{t('health:openCropRecord')}</ButtonLink>
        <ButtonLink to={`/scan?cropId=${log.cropId}`} variant="secondary">
          {t('health:scanAgain')}
        </ButtonLink>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-500">{t('health:historyLink')}</p>
    </Card>
  );
}

/**
 * Renders an array of knowledge-base i18n keys. Empty arrays render nothing —
 * a heading over no content would imply the KB had something to say when it
 * did not.
 */
function KeyList({
  titleKey,
  keys,
  testId,
}: {
  titleKey: string;
  keys: string[] | undefined;
  testId: string;
}) {
  const { t } = useTranslation(['health', 'disease']);

  if (!keys || keys.length === 0) return null;

  return (
    <Card className="p-5">
      <h2 className="kicker">{t(titleKey)}</h2>
      <ul
        className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-700"
        data-testid={testId}
      >
        {keys.map((key) => (
          <li key={key}>{translateMessageKey(t, key)}</li>
        ))}
      </ul>
    </Card>
  );
}

const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
