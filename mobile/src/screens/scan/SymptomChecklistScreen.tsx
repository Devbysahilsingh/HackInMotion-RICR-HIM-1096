/**
 * The no-photo route.
 *
 * Reachable on its own and from an uncertain photo result, and it is not a
 * consolation prize: a rule engine scoring four described symptoms against a
 * sourced knowledge base is a real answer, and it is the only answer available
 * to a farmer whose camera was refused, whose leaf is in the dark, or whose
 * signal will not carry 300KB.
 *
 * ## Why one question per screen
 *
 * The web asks all five at once in a column of selects. On a phone held in one
 * hand that is five small targets and a lot of scrolling, so the same five
 * questions become five screens of large tappable options
 * (accessibility.md — nothing below 48dp). Every axis stays optional: the
 * engine treats a skipped axis as neither evidence for nor against, so someone
 * who only knows two things about the problem still gets a scored answer
 * rather than a form that refuses to submit.
 *
 * ## Offline
 *
 * The vocabulary below is a *closed* list on the server — an answer outside it
 * is rejected and recorded in the trace rather than guessed at — so it is
 * transcribed as a client constant and the questionnaire works with the radio
 * off. Only the submit needs a network, and the crop's name comes from the
 * registry copy React Query has already persisted.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import { localizedName } from '@shared/client/format';
import { SPREAD_RATES, type SymptomAnswers, type SymptomCheckResponse } from '@shared/types/api';

import { cropsApi, healthApi } from '../../api/endpoints';
import {
  ChoiceChip,
  DiseaseName,
  KeyList,
  useDiseaseNames,
} from '../../components/domain/AnalysisResultView';
import { ConfidenceBar } from '../../components/domain/ConfidenceBar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { EmptyState, ErrorState, Notice } from '../../components/ui/states';
import { IconCamera, IconChevronLeft } from '../../components/ui/icons';
import { Text } from '../../components/ui/Text';
import { useApiErrorMessage } from '../../hooks/useApiError';
import { translateMessageKey } from '../../i18n/messageKey';
import { useLanguage } from '../../store/LanguageContext';
import { colors, spacing } from '../../theme';
import type { ScanStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ScanStackParamList, 'SymptomChecklist'>;

/**
 * The answer vocabulary, transcribed value-for-value from
 * `backend/src/engines/symptom/constants.js`. Adding a value here without
 * adding it there produces a request the validator rejects, which is the
 * intended failure mode: the two lists must never drift silently.
 */
const AXIS_VALUES = {
  part: ['LEAF', 'STEM', 'FRUIT', 'FLOWER', 'ROOT', 'WHOLE_PLANT'],
  pattern: [
    'SPOTS',
    'BLOTCHES',
    'POWDER',
    'CURL',
    'WILT',
    'HOLES',
    'YELLOWING',
    'STREAKS',
    'LESIONS',
    'MOSAIC',
    'ROT',
    'STUNTING',
    'WEBBING',
    'RINGS',
  ],
  color: ['YELLOW', 'BROWN', 'BLACK', 'WHITE', 'GREY', 'RED', 'ORANGE', 'PURPLE', 'TAN'],
  distribution: ['LOWER_LEAVES', 'UPPER_LEAVES', 'ALL_LEAVES', 'SCATTERED', 'MARGINS', 'VEINS'],
  spread: [...SPREAD_RATES],
} as const;

type Axis = keyof typeof AXIS_VALUES;

/**
 * Question order is the engine's own (`ANSWER_AXES`, then the spread question
 * the severity engine shares), which is also the order
 * docs/ai/fallback-strategy.md §1 asks them in.
 */
const STEPS: readonly { axis: Axis; labelKey: string }[] = [
  { axis: 'part', labelKey: 'health:symptomAxisPart' },
  { axis: 'pattern', labelKey: 'health:symptomAxisPattern' },
  { axis: 'color', labelKey: 'health:symptomAxisColor' },
  { axis: 'distribution', labelKey: 'health:symptomAxisDistribution' },
  { axis: 'spread', labelKey: 'health:symptomAxisSpread' },
];

/** The six ways the engine can decline to name anything. */
const NO_VERDICT_REASONS = new Set([
  'REGISTRY_CROP_UNAVAILABLE',
  'CROP_UNSUPPORTED',
  'DISEASE_KB_UNAVAILABLE',
  'NO_SYMPTOMS_ANSWERED',
  'KB_TAGS_UNAVAILABLE',
  'NO_CANDIDATE_MATCH',
]);

export function SymptomChecklistScreen({ navigation, route }: Props) {
  const { cropId } = route.params;
  const { t } = useTranslation(['health', 'agri', 'common', 'mobile', 'crop']);
  const { language } = useLanguage();
  const toMessage = useApiErrorMessage();

  const [answers, setAnswers] = useState<SymptomAnswers>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<SymptomCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cached and persisted, so the crop's name survives a cold start with no
  // signal — and so does the disease vocabulary the result needs.
  const cropQuery = useQuery({
    queryKey: queryKeys.crops.detail(cropId),
    queryFn: () => cropsApi.get(cropId),
    enabled: Boolean(cropId),
    staleTime: STALE_TIME.registry,
    retry: false,
  });

  const cropName =
    localizedName(cropQuery.data?.registry?.names ?? null, language)?.text ??
    cropQuery.data?.crop.cropCode ??
    null;

  const check = useMutation({
    mutationFn: () => healthApi.symptomCheck({ cropId, answers }),
    onSuccess: setResult,
    onError: (mutationError) => setError(toMessage(mutationError)),
  });

  const answeredCount = Object.values(answers).filter(Boolean).length;
  const step = STEPS[stepIndex];
  const onReview = stepIndex >= STEPS.length;

  const restart = () => {
    setAnswers({});
    setStepIndex(0);
    setResult(null);
    setError(null);
  };

  if (result) {
    return (
      <Screen scroll edges={['left', 'right']} testID="symptom-result">
        <SymptomResult result={result} cropId={cropId} />
        <Button variant="secondary" fullWidth onPress={restart}>
          {t('mobile:symptom.startOver')}
        </Button>
        <Button
          variant="ghost"
          fullWidth
          leadingIcon={<IconCamera size={20} color={colors.ink700} />}
          onPress={() => navigation.replace('Camera', { cropId })}
        >
          {t('health:photoReplace')}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['left', 'right']} testID="symptom-checklist">
      {cropName ? (
        <Text variant="small" color="ink500">
          {cropName}
        </Text>
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => check.mutate()} /> : null}

      {onReview || !step ? (
        <View style={styles.block}>
          <SectionHeader
            title={t('mobile:symptom.reviewTitle')}
            description={t('health:symptomCheckTitle')}
          />

          <Card>
            <View style={styles.reviewList}>
              {STEPS.map(({ axis, labelKey }) => {
                const value = answers[axis];
                return (
                  <View key={axis} style={styles.reviewRow}>
                    <Text variant="caption" color="ink500">
                      {t(labelKey)}
                    </Text>
                    <Text variant="body">
                      {value ? t(`agri:${axis}.${value}`) : t('health:symptomAxisSkip')}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Card>

          {answeredCount === 0 ? (
            <Notice tone="warning">
              <Text variant="small" color="ink700">
                {t('mobile:symptom.reasonNO_SYMPTOMS_ANSWERED')}
              </Text>
            </Notice>
          ) : null}

          <Button
            size="lg"
            fullWidth
            disabled={answeredCount === 0}
            loading={check.isPending}
            onPress={() => {
              setError(null);
              check.mutate();
            }}
            testID="symptom-submit"
          >
            {t('health:symptomCheckSubmit')}
          </Button>

          <Button variant="secondary" fullWidth onPress={() => setStepIndex(STEPS.length - 1)}>
            {t('common:action.back')}
          </Button>

          <Button variant="ghost" fullWidth onPress={restart}>
            {t('mobile:symptom.startOver')}
          </Button>
        </View>
      ) : (
        <View style={styles.block}>
          <SectionHeader
            title={t(step.labelKey)}
            description={t('mobile:symptom.stepOf', {
              current: stepIndex + 1,
              total: STEPS.length,
            })}
          />

          <View style={styles.options}>
            {AXIS_VALUES[step.axis].map((value) => (
              <ChoiceChip
                key={value}
                label={t(`agri:${step.axis}.${value}`)}
                selected={answers[step.axis] === value}
                onPress={() => {
                  setAnswers((current) => ({
                    ...current,
                    // Tapping the chosen answer again clears it — the farmer
                    // changed their mind, and there is no other way back to
                    // "I don't know" once an answer is in.
                    [step.axis]: current[step.axis] === value ? undefined : value,
                  }));
                  setStepIndex(stepIndex + 1);
                }}
                testID={`symptom-${step.axis}-${value}`}
              />
            ))}
          </View>

          <Button variant="secondary" fullWidth onPress={() => setStepIndex(stepIndex + 1)}>
            {t('health:symptomAxisSkip')}
          </Button>

          {stepIndex > 0 ? (
            <Button
              variant="ghost"
              fullWidth
              leadingIcon={<IconChevronLeft size={20} color={colors.ink700} />}
              onPress={() => setStepIndex(stepIndex - 1)}
            >
              {t('common:action.back')}
            </Button>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

// ── Result ──────────────────────────────────────────────────────────────────

function SymptomResult({ result, cropId }: { result: SymptomCheckResponse; cropId: string }) {
  const { t } = useTranslation(['health', 'agri', 'common', 'mobile']);
  const resolveDiseaseName = useDiseaseNames(cropId);

  const { guidance } = result;
  const noVerdictReason = NO_VERDICT_REASONS.has(guidance.reasonCode) ? guidance.reasonCode : null;

  return (
    <View style={styles.block}>
      <SectionHeader title={t('health:symptomCandidatesHeading')} />

      <Badge tone="brand">{translateMessageKey(t, guidance.sourceLabelKey)}</Badge>

      {guidance.coverageNoticeKey ? (
        <Notice tone="info" testID="symptom-coverage">
          <Text variant="small" color="ink700">
            {translateMessageKey(t, guidance.coverageNoticeKey)}
          </Text>
        </Notice>
      ) : null}

      {/*
        The engine's own reason for having nothing to say. Rendered rather than
        swallowed: "we have no knowledge of this crop" and "your answers match
        nothing we know" are different facts, and only one of them is worth
        re-answering the questions for.
      */}
      {noVerdictReason ? (
        <Notice tone="warning" testID="symptom-reason">
          <Text variant="small" color="ink700">
            {t(`mobile:symptom.reason${noVerdictReason}`)}
          </Text>
        </Notice>
      ) : null}

      {/*
        Below its own threshold the engine routes to a human instead of naming
        a low-scoring guess. That referral is the result, not a fallback.
      */}
      {guidance.expertReferral ? (
        <Notice tone="warning" testID="symptom-referral">
          <Text variant="small" color="ink700">
            {t('health:expertReferral')}
          </Text>
        </Notice>
      ) : null}

      {/*
        Weather the engine attached from the farm's snapshot — the one axis the
        farmer did not answer. Shown so the score is explainable.
      */}
      {guidance.weatherTags.length > 0 ? (
        <View style={styles.block}>
          <Text variant="small" color="ink700">
            {t('mobile:symptom.weatherHeading')}
          </Text>
          <View style={styles.options}>
            {guidance.weatherTags.map((tag) => (
              <Badge key={tag}>{t(`agri:weather.${tag.split(':').pop() ?? tag}`)}</Badge>
            ))}
          </View>
        </View>
      ) : null}

      {result.candidates.length === 0 ? (
        <EmptyState title={t('health:symptomNoCandidates')} testID="symptom-empty" />
      ) : (
        result.candidates.map((candidate) => (
          <CandidateCard
            key={candidate.diseaseCode}
            candidate={candidate}
            answeredCount={guidance.answeredAxes.length}
            resolve={resolveDiseaseName}
          />
        ))
      )}
    </View>
  );
}

function CandidateCard({
  candidate,
  answeredCount,
  resolve,
}: {
  candidate: SymptomCheckResponse['candidates'][number];
  answeredCount: number;
  resolve: ReturnType<typeof useDiseaseNames>;
}) {
  const { t } = useTranslation(['health', 'common', 'mobile', 'disease']);
  const [expanded, setExpanded] = useState(false);

  return (
    <Card testID="symptom-candidate">
      <View style={styles.candidate}>
        <DiseaseName code={candidate.diseaseCode} resolve={resolve} />

        <View style={styles.options}>
          {/* "Possible" or "Likely" — never "Diagnosed" (fallback-strategy.md). */}
          <Badge tone={candidate.band === 'LIKELY' ? 'warn' : 'neutral'}>
            {t(candidate.band === 'LIKELY' ? 'health:bandLikely' : 'health:bandPossible')}
          </Badge>
        </View>

        <ConfidenceBar confidence={candidate.matchScore} kind="MATCH_SCORE" />

        <Text variant="caption" color="ink500">
          {t('health:symptomMatchedAxes', {
            matched: candidate.matchedTags.length,
            total: Math.max(answeredCount, candidate.matchedTags.length),
          })}
        </Text>

        <Button variant="ghost" onPress={() => setExpanded(!expanded)}>
          {expanded ? t('mobile:symptom.hideGuidance') : t('mobile:symptom.showGuidance')}
        </Button>

        {expanded ? (
          <View style={styles.block}>
            <KeyList
              titleKey="health:whatWeSawHeading"
              keys={candidate.symptomKeys}
              testID="candidate-symptoms"
            />
            <KeyList
              titleKey="health:inspectHeading"
              keys={candidate.inspectKeys}
              testID="candidate-inspect"
            />
            <KeyList
              titleKey="health:nextStepHeading"
              keys={candidate.nextStepKeys}
              testID="candidate-next-steps"
            />
            <KeyList
              titleKey="health:preventionHeading"
              keys={candidate.preventionKeys}
              testID="candidate-prevention"
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.md },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reviewList: { gap: spacing.md },
  reviewRow: { gap: 2 },
  candidate: { gap: spacing.md },
});
