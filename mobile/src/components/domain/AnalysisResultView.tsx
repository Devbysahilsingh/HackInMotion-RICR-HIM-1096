/**
 * The photo-check result — the screen the whole product exists to reach.
 *
 * Section order is fixed by docs/frontend/ux-flows.md and is not cosmetic: it
 * is the order a farmer needs the answer in. Verdict, then how sure and from
 * where, then the photo they sent, then what we saw, then what to do, then
 * prevention, then when to call a human, then the two questions that sharpen
 * the severity, then history.
 *
 * ## Four designed branches, none of them an error page
 *
 * 1. **Confident** — a named condition with guidance from the knowledge base.
 * 2. **Uncertain** — no tier could name it. Retake advice and the guided-questions
 *    route, and deliberately *no* "diagnosis" with a small number beside it.
 *    An uncertain result is a real outcome, not a failure to be dressed up
 *    (ai-safety.md: "uncertain results are never forced into predictions").
 * 3. **Unusable photo** — `imageAssessment` says it was not a plant, was too
 *    unclear, or was not the crop that was selected. The farmer is told what to
 *    change rather than handed a verdict about a wall.
 * 4. **Healthy** — a named healthy class, a verdict in its own right, carrying
 *    prevention rather than treatment.
 *
 * ## What may and may not be rendered here (CLAUDE.md rule 6)
 *
 * `symptomKeys`, `inspectKeys`, `nextStepKeys` and `preventionKeys` are keys
 * into the sourced disease KB. They are the ONLY agronomic guidance on this
 * screen. `aiObservations` is free model text: it appears under its own
 * attributed heading, in its own card, never folded into a guidance list, and
 * no dosage is rendered from any source at all.
 *
 * Navigation is passed in rather than imported, so the history screen can
 * mount this component with its own destinations.
 */
import { useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import { formatDateTime, localizedName } from '@shared/client/format';
import { SPREAD_RATES, type HealthLog, type SourceRef, type SpreadRate } from '@shared/types/api';

import { cropsApi, healthApi } from '../../api/endpoints';
import { useApiErrorMessage } from '../../hooks/useApiError';
import { translateMessageKey } from '../../i18n/messageKey';
import { isLanguageAvailable, speak, stopSpeaking } from '../../services/voice';
import { useAuth } from '../../store/AuthContext';
import { useLanguage } from '../../store/LanguageContext';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { FreshnessDot } from '../ui/FreshnessDot';
import { IconCamera, IconLeaf, IconSpeaker } from '../ui/icons';
import { Input } from '../ui/Input';
import { SectionHeader } from '../ui/SectionHeader';
import { Notice } from '../ui/states';
import { Text } from '../ui/Text';
import { ConfidenceBar, type ConfidenceBand } from './ConfidenceBar';

// ── Disease names ───────────────────────────────────────────────────────────

/**
 * `diseaseCode` → the farmer's word for it.
 *
 * The health API returns a code and no name; names live in
 * `cropRegistry.diseases[].names`, which arrives attached to `GET /crops/:id`.
 * That request is already cached for this crop, so the lookup is free in
 * practice and no second endpoint is involved.
 */
export function useDiseaseNames(cropId: string | null | undefined): (code: string | null) => {
  text: string;
  isFallback: boolean;
} | null {
  const { language } = useLanguage();

  const cropQuery = useQuery({
    queryKey: queryKeys.crops.detail(cropId ?? ''),
    queryFn: () => cropsApi.get(cropId ?? ''),
    enabled: Boolean(cropId),
    staleTime: STALE_TIME.registry,
    retry: false,
  });

  const diseases = cropQuery.data?.registry?.diseases;

  return useMemo(
    () => (code: string | null) => {
      if (!code) return null;
      const entry = diseases?.find((disease) => disease.code === code);
      return localizedName(entry?.names ?? null, language);
    },
    [diseases, language],
  );
}

/**
 * A disease name, with the Hindi gap shown rather than papered over.
 *
 * Registry disease names carry `hi: null` wherever no Hindi-language official
 * source has been read, and CLAUDE.md rule 8 forbids translating an agronomic
 * term without one. So a Hindi screen shows the English name *labelled* as an
 * unverified fallback instead of quietly mixing scripts.
 */
export function DiseaseName({
  code,
  resolve,
}: {
  code: string | null;
  resolve: ReturnType<typeof useDiseaseNames>;
}) {
  const { t } = useTranslation(['health', 'agri']);

  if (!code || code === 'UNKNOWN') {
    return (
      <Text variant="body" color="ink700">
        {t('health:diseaseUnknownName')}
      </Text>
    );
  }

  const name = resolve(code);

  if (!name) {
    // The code itself, never an invented translation of it.
    return (
      <Text variant="body" color="ink700">
        {code}
      </Text>
    );
  }

  return (
    <View style={styles.nameBlock}>
      <Text variant="body" color="ink700">
        {name.text}
      </Text>
      {name.isFallback ? (
        <Text variant="caption" color="ink500">
          {t('agri:nameHindiMissing')}
        </Text>
      ) : null}
    </View>
  );
}

// ── Read aloud ──────────────────────────────────────────────────────────────

/**
 * Voice out, the piece docs/voice/voice-interface.md calls "highest-value,
 * lowest-risk" — it works in Expo Go, on the device's own engine, offline.
 *
 * Hidden entirely when the account has voice switched off, and disabled with a
 * reason when the handset has no voice pack for the active language: a control
 * that silently does nothing is worse than no control (voice R2).
 */
function SpeakButton({ text }: { text: string }) {
  const { t } = useTranslation(['common', 'mobile']);
  const { language } = useLanguage();
  const { user } = useAuth();
  const [speaking, setSpeaking] = useState(false);

  const availability = useQuery({
    queryKey: ['tts', 'available', language],
    queryFn: () => isLanguageAvailable(language),
    staleTime: STALE_TIME.registry,
  });

  if (user && !user.voiceEnabled) return null;

  const unavailable = availability.data === false;

  if (unavailable) {
    return (
      <Text variant="caption" color="ink500">
        {t('mobile:tts.unavailable')}
      </Text>
    );
  }

  return (
    <Button
      variant="secondary"
      leadingIcon={<IconSpeaker size={20} color={colors.brand600} />}
      accessibilityLabel={speaking ? t('common:action.stopSpeaking') : t('common:action.speak')}
      onPress={() => {
        if (speaking) {
          stopSpeaking();
          setSpeaking(false);
          return;
        }
        setSpeaking(true);
        speak(text, {
          language,
          onDone: () => setSpeaking(false),
          onError: () => setSpeaking(false),
        });
      }}
    >
      {speaking ? t('common:action.stopSpeaking') : t('common:action.speak')}
    </Button>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────

/**
 * A list of knowledge-base i18n keys. An empty array renders nothing at all —
 * a heading over no content would imply the KB had something to say when it
 * did not.
 */
export function KeyList({
  titleKey,
  keys,
  testID,
}: {
  titleKey: string;
  keys: readonly string[] | undefined;
  testID: string;
}) {
  const { t } = useTranslation(['health', 'disease', 'common']);

  if (!keys || keys.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title={t(titleKey)} />
      <Card>
        <View style={styles.bulletList} testID={testID}>
          {keys.map((key) => (
            <View key={key} style={styles.bulletRow}>
              <View style={styles.bullet} />
              <Text variant="small" color="ink700" style={styles.bulletText}>
                {translateMessageKey(t, key)}
              </Text>
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}

/** Provenance. Organisation and title are proper nouns and stay as sourced. */
function SourceList({ sources }: { sources: readonly SourceRef[] }) {
  return (
    <Card>
      <View style={styles.bulletList}>
        {sources.map((source, index) => (
          <View key={`${source.org}-${index}`} style={styles.sourceRow}>
            <Text variant="caption" color="ink700">
              {source.org}
            </Text>
            <Text variant="caption" color="ink500">
              {source.title}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const SEVERITY_LABEL_KEY: Readonly<Record<string, string>> = {
  MILD: 'health:severityMild',
  MODERATE: 'health:severityModerate',
  SEVERE: 'health:severitySevere',
  NOT_ASSESSED: 'health:severityNotAssessed',
};

// ── Severity follow-up ──────────────────────────────────────────────────────

/**
 * The two follow-up answers.
 *
 * They are not a second opinion: they are inputs to the *same* engine that ran
 * on the photo, re-run with more evidence server-side. Nothing here computes a
 * level, and `POST /crop-health/logs/:id/severity` could not accept one if this
 * form tried to send it (CLAUDE.md rule 9 — severity is engine-assessed).
 */
function SeverityFollowUp({
  logId,
  initialAffectedPct,
  initialSpread,
}: {
  logId: string;
  initialAffectedPct: number | null;
  initialSpread: SpreadRate | null;
}) {
  const { t } = useTranslation(['health', 'agri', 'common', 'mobile']);
  const queryClient = useQueryClient();
  const toMessage = useApiErrorMessage();

  const [affectedAreaPct, setAffectedAreaPct] = useState(
    initialAffectedPct != null ? String(initialAffectedPct) : '',
  );
  const [spreadRate, setSpreadRate] = useState<SpreadRate | null>(initialSpread);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = useMutation({
    mutationFn: () => {
      const pct = affectedAreaPct === '' ? undefined : Number(affectedAreaPct);
      return healthApi.severity(logId, {
        ...(pct !== undefined && Number.isFinite(pct) ? { affectedAreaPct: pct } : {}),
        ...(spreadRate ? { spreadRate } : {}),
      });
    },
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: queryKeys.health.all() });
    },
    onError: (mutationError) => setError(toMessage(mutationError)),
  });

  // The endpoint requires at least one of the two answers.
  const pctValue = Number(affectedAreaPct);
  const pctIsUsable =
    affectedAreaPct === '' || (Number.isFinite(pctValue) && pctValue >= 0 && pctValue <= 100);
  const canSubmit = (affectedAreaPct !== '' || spreadRate !== null) && pctIsUsable;

  return (
    <View style={styles.section}>
      <SectionHeader title={t('health:severityFollowUpHeading')} />
      <Card>
        <View style={styles.form}>
          {error ? (
            <Notice tone="danger">
              <Text variant="small" color="ink700">
                {error}
              </Text>
            </Notice>
          ) : null}
          {saved ? (
            <Notice tone="info">
              <Text variant="small" color="ink700">
                {t('mobile:result.severityUpdated')}
              </Text>
            </Notice>
          ) : null}

          <Input
            label={t('health:severityAffectedLabel')}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={3}
            value={affectedAreaPct}
            error={pctIsUsable ? undefined : t('common:validation.maxValue', { max: 100 })}
            onChangeText={(next) => {
              setSaved(false);
              setAffectedAreaPct(next.replace(/[^0-9]/g, ''));
            }}
            testID="severity-affected"
          />

          <View style={styles.optionGroup}>
            <Text variant="small" color="ink700">
              {t('health:severitySpreadLabel')}
            </Text>
            <View style={styles.optionRow}>
              {SPREAD_RATES.map((rate) => (
                <ChoiceChip
                  key={rate}
                  label={t(`agri:spread.${rate}`)}
                  selected={spreadRate === rate}
                  onPress={() => {
                    setSaved(false);
                    setSpreadRate(spreadRate === rate ? null : rate);
                  }}
                />
              ))}
            </View>
          </View>

          <Button
            onPress={() => {
              setError(null);
              if (canSubmit) submit.mutate();
            }}
            disabled={!canSubmit}
            loading={submit.isPending}
            fullWidth
            testID="severity-submit"
          >
            {t('health:severitySubmit')}
          </Button>
        </View>
      </Card>
    </View>
  );
}

/**
 * A large tappable choice. Used wherever a radio group would be on the web —
 * a 20dp radio dot is not a target a work-worn thumb can hit reliably, so the
 * whole card is the control.
 */
export function ChoiceChip({
  label,
  description,
  selected,
  onPress,
  testID,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Card
      onPress={onPress}
      padded={false}
      accessibilityLabel={label}
      accessibilityHint={description}
      testID={testID}
      style={[styles.choice, selected ? styles.choiceSelected : null]}
    >
      <View style={styles.choiceBody}>
        <Text variant={selected ? 'bodyStrong' : 'body'} color={selected ? 'brand600' : 'ink900'}>
          {label}
        </Text>
        {description ? (
          <Text variant="caption" color="ink500">
            {description}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

// ── The result ──────────────────────────────────────────────────────────────

export interface AnalysisResultViewProps {
  log: HealthLog;
  /** Sends the farmer back to the camera for this same crop. */
  onRetake?: () => void;
  /** Opens the no-photo guided route for this same crop. */
  onSymptomCheck?: () => void;
  onHistory?: () => void;
}

export function AnalysisResultView({
  log,
  onRetake,
  onSymptomCheck,
  onHistory,
}: AnalysisResultViewProps) {
  const { t } = useTranslation(['health', 'common', 'disease', 'agri', 'mobile']);
  const { language } = useLanguage();
  const resolveDiseaseName = useDiseaseNames(log.cropId);

  const analysis = log.analysis;
  const data = log.recommendation.data;

  const isUnknown = !analysis.diseaseCode || analysis.diseaseCode === 'UNKNOWN';
  const assessment = data.imageAssessment ?? null;
  const unusablePhoto = assessment !== null && assessment !== 'OK';

  const title = translateMessageKey(t, log.recommendation.titleKey);

  /*
   * What gets read aloud: the verdict and the KB guidance, in that order.
   * `aiObservations` is deliberately excluded — spoken text loses the visual
   * attribution that keeps model prose from sounding like advice.
   */
  const spokenSummary = [
    title,
    ...(data.symptomKeys ?? []).map((key) => translateMessageKey(t, key)),
    ...(data.nextStepKeys ?? []).map((key) => translateMessageKey(t, key)),
  ].join('. ');

  const severityLabelKey = analysis.severityAssessment
    ? SEVERITY_LABEL_KEY[analysis.severityAssessment]
    : null;

  return (
    <View style={styles.page} testID="analysis-result">
      {/* ── Verdict, confidence, provenance ──────────────────────────────── */}
      <Card>
        <View style={styles.verdict}>
          <Text variant="heading" accessibilityRole="header">
            {title}
          </Text>

          {!isUnknown ? (
            <DiseaseName code={analysis.diseaseCode} resolve={resolveDiseaseName} />
          ) : null}

          <View style={styles.badgeRow}>
            {analysis.sourceLabelKey ? (
              <Badge tone="brand">{translateMessageKey(t, analysis.sourceLabelKey)}</Badge>
            ) : null}
            {severityLabelKey ? (
              <Badge
                tone={analysis.severityAssessment === 'SEVERE' ? 'danger' : 'neutral'}
                testID="severity-badge"
              >
                {t(severityLabelKey)}
              </Badge>
            ) : null}
            {analysis.modelVersion ? <Badge>{analysis.modelVersion}</Badge> : null}
          </View>

          <ConfidenceBar
            confidence={analysis.confidence}
            kind={data.confidenceKind}
            band={(data.confidenceBand ?? null) as ConfidenceBand | null}
          />

          <View style={styles.metaRow}>
            <FreshnessDot
              status={log.freshness.status}
              fetchedAt={log.freshness.fetchedAt}
              latestDate={log.createdAt}
            />
            <Text variant="caption" color="ink500">
              {formatDateTime(log.createdAt, language)}
            </Text>
          </View>

          {/*
            A duplicate photograph is answered from the image-hash cache with a
            200 rather than a fresh 201. Saying so is the honest form of a
            result that did not cost a new analysis (rule 9).
          */}
          {log.freshness.status === 'cached' ? (
            <Notice tone="info" testID="cached-notice">
              <Text variant="small" color="ink700">
                {t('health:cachedNotice')}
              </Text>
            </Notice>
          ) : null}

          <SpeakButton text={spokenSummary} />
        </View>
      </Card>

      {log.imageUrl ? (
        <Image
          source={{ uri: log.imageUrl }}
          style={styles.photo}
          resizeMode="cover"
          accessibilityLabel={t('health:photoAlt')}
          accessible
          testID="analysis-photo"
        />
      ) : null}

      {/* ── Branch: the photograph itself could not be used ──────────────── */}
      {unusablePhoto ? (
        <View style={styles.section} testID="image-assessment">
          <Notice tone="warning">
            <Text variant="small" color="ink700">
              {t(`health:imageAssessment${assessment}`, {
                defaultValue: t('health:uncertainRetake'),
              })}
            </Text>
          </Notice>
          <RetakeGuidance onRetake={onRetake} onSymptomCheck={onSymptomCheck} />
        </View>
      ) : null}

      {/* ── Branch: nothing could be named ───────────────────────────────── */}
      {isUnknown && !unusablePhoto ? (
        <View style={styles.section} testID="uncertain-branch">
          <Notice tone="warning">
            <Text variant="small" color="ink700">
              {t('health:uncertainRetake')}
            </Text>
          </Notice>
          <RetakeGuidance onRetake={onRetake} onSymptomCheck={onSymptomCheck} />
        </View>
      ) : null}

      {/* ── Coverage honesty ─────────────────────────────────────────────── */}
      {log.coverageNoticeKey ? (
        <Notice tone="info" testID="coverage-notice">
          <Text variant="small" color="ink700">
            {translateMessageKey(t, log.coverageNoticeKey)}
          </Text>
        </Notice>
      ) : null}

      {/* ── Knowledge-base guidance. The only agronomic text on this screen ─ */}
      <KeyList titleKey="health:whatWeSawHeading" keys={data.symptomKeys} testID="symptoms" />
      <KeyList titleKey="health:inspectHeading" keys={data.inspectKeys} testID="inspect" />
      <KeyList titleKey="health:nextStepHeading" keys={data.nextStepKeys} testID="next-steps" />
      <KeyList titleKey="health:preventionHeading" keys={data.preventionKeys} testID="prevention" />

      {/*
        The model's own words, under their own heading, in their own card, and
        never merged into the lists above. On a Hindi screen these stay English
        — a stated limitation (docs/i18n/architecture.md) rather than a bug,
        and one the note below names.
      */}
      {data.aiObservations && data.aiObservations.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title={t('health:aiObservationsHeading')} />
          <Card>
            <View style={styles.bulletList} testID="ai-observations">
              {data.aiObservations.map((observation, index) => (
                <View key={`${index}-${observation.slice(0, 12)}`} style={styles.bulletRow}>
                  <View style={styles.bullet} />
                  <Text variant="small" color="ink700" style={styles.bulletText}>
                    {observation}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
          <Text variant="caption" color="ink500">
            {t('health:aiObservationsNote')}
          </Text>
        </View>
      ) : null}

      {/* ── When to call a human ─────────────────────────────────────────── */}
      {analysis.escalated || isUnknown ? (
        <Notice tone="warning" testID="expert-referral">
          <Text variant="small" color="ink700">
            {t('health:expertReferral')}
          </Text>
        </Notice>
      ) : null}

      {data.sourceRefs && data.sourceRefs.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title={t('health:sourcesHeading')} />
          <SourceList sources={data.sourceRefs} />
        </View>
      ) : null}

      {/*
        How we got here. `provider` and `reason` are engine identifiers and stay
        untranslated on purpose, so the path can be checked against the
        conductor that produced it.
      */}
      {analysis.escalationPath.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title={t('health:escalationHeading')} />
          <Card>
            <View style={styles.bulletList} testID="escalation-path">
              {analysis.escalationPath.map((step, index) => (
                <View key={`${step.provider}-${index}`} style={styles.sourceRow}>
                  <Text variant="caption" color="ink700">
                    {step.provider}
                  </Text>
                  <Text variant="caption" color="ink500">
                    {step.reason}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        </View>
      ) : null}

      {/* ── The two questions that sharpen severity ──────────────────────── */}
      {!isUnknown ? (
        <SeverityFollowUp
          logId={log.id}
          initialAffectedPct={log.severityFollowUp?.affectedAreaPct ?? null}
          initialSpread={log.severityFollowUp?.spreadRate ?? null}
        />
      ) : null}

      {onHistory ? (
        <Button variant="ghost" onPress={onHistory} fullWidth>
          {t('health:historyLink')}
        </Button>
      ) : null}
    </View>
  );
}

/**
 * The low-confidence way forward: what makes a better photograph, and the
 * no-photo route for a farmer who cannot take one.
 */
function RetakeGuidance({
  onRetake,
  onSymptomCheck,
}: {
  onRetake?: () => void;
  onSymptomCheck?: () => void;
}) {
  const { t } = useTranslation(['mobile', 'health']);

  return (
    <Card>
      <View style={styles.form}>
        <Text variant="bodyStrong">{t('mobile:result.retakeTipsTitle')}</Text>
        <Text variant="small" color="ink700">
          {t('mobile:camera.guidanceHint')}
        </Text>
        {onRetake ? (
          <Button
            variant="secondary"
            fullWidth
            leadingIcon={<IconCamera size={20} color={colors.brand600} />}
            onPress={onRetake}
          >
            {t('health:photoReplace')}
          </Button>
        ) : null}
        {onSymptomCheck ? (
          <Button
            fullWidth
            leadingIcon={<IconLeaf size={20} color={colors.surface} />}
            onPress={onSymptomCheck}
          >
            {t('health:symptomCheckCta')}
          </Button>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { gap: spacing.lg },
  section: { gap: spacing.sm },
  verdict: { gap: spacing.md },
  nameBlock: { gap: 2 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.canvas,
  },
  bulletList: { gap: spacing.sm },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brand500,
    marginTop: 8,
  },
  bulletText: { flex: 1 },
  sourceRow: { gap: 2 },
  form: { gap: spacing.lg },
  optionGroup: { gap: spacing.sm },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexGrow: 1,
    flexBasis: '30%',
  },
  choiceSelected: { borderColor: colors.brand500, backgroundColor: colors.brand50 },
  choiceBody: { gap: 2 },
});
