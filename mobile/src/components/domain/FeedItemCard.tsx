/**
 * One row of the action feed.
 *
 * Everything visible comes from the item's own `titleKey`/`bodyKey` plus its
 * `data` as interpolation params — the API never sends prose (rule 8), so this
 * card cannot render anything the knowledge base did not author.
 *
 * Shape, deliberately, is verdict-first: the priority chip says how much this
 * matters, the title says what to do, the body says why, and the derivation is
 * one tap away. The "why?" expander sits inline rather than on a separate
 * screen — it is the explainability promise, and putting it a navigation away
 * would make it something nobody reads.
 *
 * The card is **not** itself a press target. It carries up to three controls
 * (open, read aloud, done) and a disclosure, and a farmer aiming for one of
 * them on a moving bus must not be able to trigger a navigation by missing.
 */
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, type NavigationProp } from '@react-navigation/native';

import type { FeedItem, Freshness } from '@shared/types/api';

import { localizeCropParams, useCropNames } from '../../hooks/useCropNames';
import { translateMessageKey } from '../../i18n/messageKey';
import type { CropDetailTab, RootStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { FreshnessDot } from '../ui/FreshnessDot';
import { PriorityChip } from '../ui/PriorityChip';
import { IconCheck } from '../ui/icons';
import { Text } from '../ui/Text';
import { SpeakButton, WhyTrace } from './WhyTrace';

export interface FeedItemCardProps {
  item: FeedItem;
  onAcknowledge?: (item: FeedItem) => void;
  isAcknowledging?: boolean;
  /** Off on the detail screen, which *is* the destination. */
  showOpenAction?: boolean;
  testID?: string;
}

export function FeedItemCard({
  item,
  onAcknowledge,
  isAcknowledging = false,
  showOpenAction = true,
  testID,
}: FeedItemCardProps) {
  const { t } = useTranslation([
    'common',
    'irrigation',
    'weather',
    'market',
    'health',
    'fertilizer',
    'community',
    'cropRec',
  ]);
  const cropName = useCropNames();
  const openTarget = useFeedNavigator();

  /*
   * `data` is interpolation params. A `cropCode` inside it is a canonical id
   * (`COTTON`), and ids never reach a farmer's screen — the community strings
   * say "reported this on {{cropCode}}", which must read कपास in Hindi.
   */
  const params = localizeCropParams(item.data, cropName);
  const title = translateMessageKey(t, item.titleKey, params);
  const body = translateMessageKey(t, item.bodyKey, params);

  /*
   * Irrigation items carry the freshness of the weather their verdict was
   * computed from. Showing it is not decoration: rule 9 requires cached
   * content to be labelled, and "water this crop today" derived from a
   * three-day-old forecast is exactly when a farmer needs to know.
   */
  const freshness = isFreshness(item.data?.freshness) ? item.data.freshness : null;

  const open = openTarget(item);
  const acknowledged = item.acknowledgedAt !== null;

  return (
    <Card
      testID={testID ?? 'feed-item'}
      style={[
        item.priority === 'CRITICAL' ? styles.critical : null,
        acknowledged ? styles.acknowledged : null,
      ]}
    >
      <View style={styles.body}>
        <View style={styles.headRow}>
          <PriorityChip priority={item.priority} />
          <SpeakButton text={`${title}. ${body}`} />
        </View>

        <View style={styles.copy}>
          <Text variant="subheading" testID="feed-item-title">
            {title}
          </Text>
          <Text variant="body" color="ink700">
            {body}
          </Text>
        </View>

        {freshness ? (
          <FreshnessDot
            status={freshness.status}
            fetchedAt={freshness.fetchedAt}
            ageHours={freshness.ageHours}
            staleWarning={freshness.staleWarning}
          />
        ) : null}

        <WhyTrace trace={item.data?.trace ?? null} />

        {(showOpenAction && open) || (onAcknowledge && !acknowledged) ? (
          <View style={styles.actions}>
            {showOpenAction && open ? (
              <Button variant="secondary" onPress={open} style={styles.action} testID="feed-open">
                {t('common:action.viewAll')}
              </Button>
            ) : null}

            {onAcknowledge && !acknowledged ? (
              <Button
                variant="primary"
                onPress={() => onAcknowledge(item)}
                loading={isAcknowledging}
                leadingIcon={<IconCheck size={18} color={colors.surface} />}
                style={styles.action}
                testID="feed-ack"
              >
                {t('common:action.done')}
              </Button>
            ) : null}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/**
 * The feed's `data` is an open bag, so the freshness block is checked rather
 * than cast — a malformed one must render nothing, not a broken dot.
 */
function isFreshness(value: unknown): value is Freshness {
  return (
    typeof value === 'object' && value !== null && typeof (value as Freshness).status === 'string'
  );
}

/**
 * Where "view" goes, by feed type.
 *
 * Returns null when the item has no natural destination, so the button is
 * absent rather than dead. The jumps are cross-stack — a weather risk raised
 * on the Home feed lives on the Farm tab — which is why every one of them goes
 * through the root navigator rather than the local stack.
 *
 * Three of the feed types name the same question one of the crop screen's tabs
 * answers, so they carry `tab` and the crop opens on it — an irrigation alert
 * that landed on whichever tab happens to be first would make the farmer find
 * the answer they were just shown. `market` is not among them despite having a
 * tab: market items are raised per commodity and carry no `cropId` at all
 * (`marketCandidate` in the feed composer never sets one), so there is no crop
 * to open and the overview stays the honest destination.
 */
function useFeedNavigator(): (item: FeedItem) => (() => void) | null {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  return (item: FeedItem) => {
    const toCrop = (cropId: string, tab: CropDetailTab) => () =>
      navigation.navigate('Main', {
        screen: 'FarmTab',
        params: { screen: 'CropDetail', params: { cropId, tab } },
      });

    switch (item.type) {
      case 'irrigation':
      case 'fertilizer':
      case 'health':
        // The three type names are also the three tab names, so the mapping is
        // the identity rather than a table that could drift out of step.
        return item.cropId ? toCrop(item.cropId, item.type) : null;

      case 'weather-risk':
        return item.farmId
          ? () =>
              navigation.navigate('Main', {
                screen: 'FarmTab',
                params: { screen: 'Weather', params: { farmId: item.farmId as string } },
              })
          : null;

      case 'market':
        return () =>
          navigation.navigate('Main', {
            screen: 'MarketTab',
            params: { screen: 'MarketOverview' },
          });

      case 'community':
        return () =>
          navigation.navigate('Main', {
            screen: 'HomeTab',
            params: { screen: 'Community' },
          });

      case 'crop-suggestion':
        return () =>
          navigation.navigate('Main', {
            screen: 'HomeTab',
            params: { screen: 'CropRecommendation', params: {} },
          });

      default:
        return null;
    }
  };
}

const styles = StyleSheet.create({
  critical: { borderColor: colors.priorityCritical },
  acknowledged: { opacity: 0.6 },
  body: { gap: spacing.md },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  copy: { gap: spacing.xs, flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: { flexGrow: 1, flexBasis: 140, borderRadius: radius.md },
});
