import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { HealthLog } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { formatDateTime } from '@/lib/format';
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
 * Section order is fixed by ux-flows.md and is not cosmetic — it is the order
 * a farmer needs the answer in: verdict and confidence, then what we saw, then
 * what to do, then prevention, then when to call a human, then the history
 * link.
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
  const { t } = useTranslation(['health', 'common', 'disease', 'agri']);
  const { language } = useLanguage();

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
    <div className="space-y-6" data-testid="analysis-result" data-unknown={isUnknown}>
      {/* ── Verdict + confidence ─────────────────────────────────────── */}
      <Card>
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{title}</h2>
              {!isUnknown && (
                <p className="mt-1 text-base text-ink-700" data-testid="disease-name">
                  <DiseaseName code={analysis.diseaseCode} showFallbackNote />
                </p>
              )}
            </div>
            <SpeakButton text={spokenSummary} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SourceLabel sourceLabelKey={analysis.sourceLabelKey} />
            {analysis.severityAssessment && (
              <Badge
                tone={analysis.severityAssessment === 'SEVERE' ? 'danger' : 'neutral'}
                data-testid="severity-badge"
              >
                {t(`health:severity${titleCase(analysis.severityAssessment)}`)}
              </Badge>
            )}
            {analysis.modelVersion && <Badge>{analysis.modelVersion}</Badge>}
          </div>

          <ConfidenceBar
            confidence={analysis.confidence}
            kind={data.confidenceKind as ConfidenceKind}
            band={data.confidenceBand ?? null}
          />

          <div className="flex flex-wrap items-center gap-3">
            <FreshnessDot freshness={log.freshness} />
            <span className="text-xs text-ink-500">{formatDateTime(log.createdAt, language)}</span>
          </div>

          {log.freshness.status === 'cached' && (
            <Notice tone="info" data-testid="cached-notice">
              {t('health:cachedNotice')}
            </Notice>
          )}
        </div>
      </Card>

      {log.imageUrl && (
        <img
          src={log.imageUrl}
          alt={t('health:photoAlt')}
          className="w-full max-w-sm rounded-xl border border-line object-contain"
          data-testid="analysis-photo"
        />
      )}

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

      {/* ── What we saw ──────────────────────────────────────────────── */}
      <KeyList titleKey="health:whatWeSawHeading" keys={data.symptomKeys} testId="symptoms" />
      <KeyList titleKey="health:inspectHeading" keys={data.inspectKeys} testId="inspect" />

      {/* ── What to do ───────────────────────────────────────────────── */}
      <KeyList titleKey="health:nextStepHeading" keys={data.nextStepKeys} testId="next-steps" />
      <KeyList titleKey="health:preventionHeading" keys={data.preventionKeys} testId="prevention" />

      {/*
        AI observations, under their own heading and never mixed into the
        guidance above. These are free English strings the model produced about
        the photo; on a Hindi screen they stay English, which is a stated
        limitation rather than a bug (docs/i18n/architecture.md).
      */}
      {data.aiObservations && data.aiObservations.length > 0 && (
        <Section title={t('health:aiObservationsHeading')} as="h2">
          <Card>
            <ul className="list-disc space-y-1.5 p-4 pl-8 text-sm text-ink-700">
              {data.aiObservations.map((observation, index) => (
                <li key={index} lang="en">
                  {observation}
                </li>
              ))}
            </ul>
          </Card>
          <p className="text-xs text-ink-500">{t('health:aiObservationsNote')}</p>
        </Section>
      )}

      {/* ── When to call a human ─────────────────────────────────────── */}
      {(analysis.escalated || isUnknown) && (
        <Notice tone="warning" data-testid="expert-referral">
          {t('health:expertReferral')}
        </Notice>
      )}

      {/* ── Provenance ───────────────────────────────────────────────── */}
      {data.sourceRefs && data.sourceRefs.length > 0 && (
        <Section title={t('health:sourcesHeading')} as="h2">
          <SourceList sources={data.sourceRefs} />
        </Section>
      )}

      {/* ── How we got here ──────────────────────────────────────────── */}
      {analysis.escalationPath.length > 0 && (
        <Section title={t('health:escalationHeading')} as="h2">
          {/*
            The escalation path names the provider that declined rather than an
            engine step, so it is relabelled here rather than teaching WhyTrace
            a second shape. The remaining fields — `reason`, and `status` when
            the hop failed with an HTTP code — become the step's rows.
          */}
          <WhyTrace
            trace={analysis.escalationPath.map(({ provider, ...rest }) => ({
              step: provider,
              ...rest,
            }))}
          />
        </Section>
      )}

      {data.severityTrace && data.severityTrace.length > 0 && (
        <Section title={t('health:severityHeading')} as="h2">
          <WhyTrace trace={data.severityTrace} />
        </Section>
      )}

      <Link
        to={`/crops/${log.cropId}?tab=health`}
        className="inline-block text-sm font-semibold text-brand-700 underline underline-offset-2"
      >
        {t('health:historyLink')}
      </Link>
    </div>
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
    <Section title={t(titleKey)} as="h2">
      <Card>
        <ul className="list-disc space-y-1.5 p-4 pl-8 text-sm text-ink-700" data-testid={testId}>
          {keys.map((key) => (
            <li key={key}>{translateMessageKey(t, key)}</li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}

const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
