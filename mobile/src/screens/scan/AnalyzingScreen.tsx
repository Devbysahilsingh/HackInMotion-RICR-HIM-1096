/**
 * The wait.
 *
 * This screen owns the upload — not the camera before it and not the result
 * after it. That is the whole reason `Analyzing` takes a local `imageUri`
 * rather than an upload id: when the signal drops halfway through, the bytes
 * are still here, and the farmer gets a Try-again button instead of a walk
 * back to the plant (docs/mobile/camera-and-upload.md RES-10).
 *
 * ## Honest waiting
 *
 * The copy tracks what is genuinely happening — the photo is being
 * re-encoded, the bytes are on the wire, the server's chain is running — and
 * the bar is determinate for exactly the part we can measure. Nothing advances
 * on a timer. A progress bar that fills on a `setInterval` is a lie told
 * politely, and this is the screen where a farmer is most inclined to believe
 * it.
 *
 * ## Failure is a fork, not a message
 *
 * A dropped connection and a photograph of a wall are not the same problem.
 * `useAnalyze` classifies them; this screen renders the remedy that matches:
 * the same bytes may be re-sent, or a new photograph is needed, or the only
 * thing left is to wait out a rate limit. The photo stays on screen throughout
 * so it is obvious it has not been lost.
 */
import { useEffect } from 'react';
import { Alert, BackHandler, Image, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { queryKeys } from '@shared/client/queryKeys';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { Notice } from '../../components/ui/states';
import { IconCamera, IconRefresh } from '../../components/ui/icons';
import { Text } from '../../components/ui/Text';
import { useAnalyze, type AnalyzeFailure } from '../../hooks/useAnalyze';
import { translateMessageKey } from '../../i18n/messageKey';
import { colors, radius, spacing } from '../../theme';
import type { ScanStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ScanStackParamList, 'Analyzing'>;

export function AnalyzingScreen({ navigation, route }: Props) {
  const { cropId, imageUri, description, shareToCommunity } = route.params;
  const { t } = useTranslation(['mobile', 'health', 'common', 'errors']);
  const queryClient = useQueryClient();

  const { state, labelKey, retry, cancel } = useAnalyze({
    cropId,
    imageUri,
    description,
    shareToCommunity,
  });

  const inFlight =
    state.stage === 'compressing' || state.stage === 'uploading' || state.stage === 'analyzing';

  const confirmCancel = () => {
    Alert.alert(t('mobile:upload.cancelConfirmTitle'), t('mobile:upload.cancelConfirmBody'), [
      { text: t('mobile:upload.cancelConfirmKeep'), style: 'cancel' },
      {
        text: t('mobile:upload.cancel'),
        style: 'destructive',
        onPress: () => {
          cancel();
          navigation.goBack();
        },
      },
    ]);
  };

  /*
   * The stack already hides the back button and disables the swipe; this is
   * the third way out — Android's own back gesture — and letting it through
   * would abandon an upload that is already costing radio time, silently.
   */
  useEffect(() => {
    if (!inFlight) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmCancel();
      return true;
    });

    return () => subscription.remove();
    // `confirmCancel` closes over `t` and `cancel`, both stable for this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlight]);

  // Success: seed the result before navigating, so the next screen renders the
  // answer immediately instead of re-fetching a log it was just handed.
  useEffect(() => {
    if (state.stage !== 'done' || !state.log) return;

    const log = state.log;
    queryClient.setQueryData(queryKeys.health.log(log.id), { log });
    void queryClient.invalidateQueries({ queryKey: queryKeys.health.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });

    navigation.replace('AnalysisResult', { logId: log.id });
  }, [navigation, queryClient, state.log, state.stage]);

  const percent = Math.round(state.progress * 100);

  return (
    <Screen scroll edges={['left', 'right', 'bottom']} testID="analyzing">
      <View style={styles.photoFrame}>
        <Image source={{ uri: imageUri }} style={styles.photo} resizeMode="cover" />
      </View>

      {state.stage === 'failed' && state.failure ? (
        <FailurePanel
          failure={state.failure}
          onRetry={retry}
          onNewPhoto={() => navigation.replace('Camera', { cropId })}
          onBack={() => navigation.goBack()}
        />
      ) : (
        <Card>
          <View style={styles.progressBlock}>
            <Text variant="bodyStrong" accessibilityLiveRegion="polite" testID="analyzing-stage">
              {labelKey ? t(labelKey) : t('common:state.loading')}
            </Text>

            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={
                state.stage === 'uploading'
                  ? t('mobile:upload.progress', { percent })
                  : t('mobile:upload.analyzing')
              }
              accessibilityValue={
                state.stage === 'uploading' ? { min: 0, max: 100, now: percent } : undefined
              }
            >
              <View style={styles.track}>
                {/*
                  Determinate only while there is something real to measure.
                  Once the bytes are delivered the server's chain has no
                  progress to report, so the bar sits full rather than
                  pretending to creep.
                */}
                <View
                  style={[
                    styles.fill,
                    { width: state.stage === 'compressing' ? '8%' : `${Math.max(percent, 4)}%` },
                  ]}
                />
              </View>
            </View>

            {state.stage === 'uploading' ? (
              <Text variant="caption" color="ink500">
                {t('mobile:upload.progress', { percent })}
              </Text>
            ) : null}

            <Button
              variant="ghost"
              onPress={confirmCancel}
              disabled={!inFlight}
              testID="analyzing-cancel"
            >
              {t('mobile:upload.cancel')}
            </Button>
          </View>
        </Card>
      )}
    </Screen>
  );
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * 60;

/**
 * `Retry-After` seconds → the sentence that names the wait.
 *
 * Three units because the two limiters answer on different scales: the 3/minute
 * burst returns tens of seconds, the 10/day cap returns hours. Rounded up so the
 * app never sends a farmer back before the window has actually reopened — the
 * only direction in which rounding cannot produce a second refusal.
 *
 * Returns null when there is nothing honest to say, and the caller falls back to
 * the generic copy rather than naming a duration nobody measured.
 */
export function rateLimitWait(seconds: number | null): { key: string; count: number } | null {
  if (seconds === null || seconds <= 0) return null;

  if (seconds < SECONDS_PER_MINUTE) {
    return { key: 'mobile:upload.rateLimitedWaitSeconds', count: seconds };
  }
  if (seconds < SECONDS_PER_HOUR) {
    return {
      key: 'mobile:upload.rateLimitedWaitMinutes',
      count: Math.ceil(seconds / SECONDS_PER_MINUTE),
    };
  }
  return {
    key: 'mobile:upload.rateLimitedWaitHours',
    count: Math.ceil(seconds / SECONDS_PER_HOUR),
  };
}

/**
 * The five ways this can end badly, each with the one action that helps.
 *
 * `cancelled` never reaches here — cancelling navigates away — but it is still
 * handled rather than falling through to a scary title for something the
 * farmer chose.
 */
function FailurePanel({
  failure,
  onRetry,
  onNewPhoto,
  onBack,
}: {
  failure: AnalyzeFailure;
  onRetry: () => void;
  onNewPhoto: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation(['mobile', 'common', 'errors']);

  const title =
    failure.kind === 'photoRejected'
      ? t('mobile:upload.photoRejectedTitle')
      : failure.kind === 'prepareFailed'
        ? t('mobile:upload.prepareFailedTitle')
        : failure.kind === 'rateLimited'
          ? t('mobile:upload.rateLimitedTitle')
          : t('mobile:upload.failedTitle');

  const body =
    failure.kind === 'prepareFailed'
      ? t('mobile:upload.prepareFailedBody')
      : translateMessageKey(t, failure.messageKey);

  const wait = failure.kind === 'rateLimited' ? rateLimitWait(failure.retryAfterSeconds) : null;

  return (
    <Card>
      <View style={styles.failure} accessibilityLiveRegion="assertive" testID="analyzing-failed">
        <Text variant="subheading" color="danger600">
          {title}
        </Text>
        <Text variant="small" color="ink700">
          {body}
        </Text>

        {/*
          The photo is still on this screen and still on the device. Saying so
          is the difference between "try again" and "go back to the field".
        */}
        {failure.canRetrySameImage ? (
          <Notice tone="info">
            <Text variant="small" color="ink700" testID="analyzing-retry-hint">
              {failure.kind === 'rateLimited'
                ? wait
                  ? t(wait.key, { count: wait.count })
                  : t('mobile:upload.rateLimitedBody')
                : t('mobile:upload.failedBody')}
            </Text>
          </Notice>
        ) : null}

        {failure.canRetrySameImage ? (
          <Button
            fullWidth
            leadingIcon={<IconRefresh size={20} color={colors.surface} />}
            onPress={onRetry}
            testID="analyzing-retry"
          >
            {t('common:action.retry')}
          </Button>
        ) : null}

        <Button
          variant={failure.canRetrySameImage ? 'secondary' : 'primary'}
          fullWidth
          leadingIcon={
            <IconCamera
              size={20}
              color={failure.canRetrySameImage ? colors.brand600 : colors.surface}
            />
          }
          onPress={onNewPhoto}
          testID="analyzing-new-photo"
        >
          {t('mobile:upload.newPhotoCta')}
        </Button>

        <Button variant="ghost" fullWidth onPress={onBack}>
          {t('common:action.back')}
        </Button>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  photoFrame: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.canvas,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
  progressBlock: { gap: spacing.md },
  track: {
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.brand600 },
  failure: { gap: spacing.md },
});
