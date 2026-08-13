/**
 * A crop at a glance: stage, today's watering verdict, the market direction,
 * and how fresh the weather behind all of it is.
 *
 * Every value is read from the dashboard payload — this card refetches nothing,
 * which is what keeps a dashboard with twelve crops down to one request.
 *
 * ## What is deliberately absent
 *
 * `healthFlag` is on the wire and is **always null today**: nothing in
 * `feedService.js` ever populates it. A chip that can never appear is not a
 * feature, it is a promise the API does not keep, so it is not rendered. When
 * the field starts carrying a value this is the place to add it.
 */
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, type NavigationProp } from '@react-navigation/native';

import { localizedName } from '@shared/client/format';
import type { CropCard as CropCardData, MarketTrend } from '@shared/types/api';

import { titleCaseCode } from '../../hooks/useCropNames';
import type { RootStackParamList } from '../../navigation/types';
import { useLanguage } from '../../store/LanguageContext';
import { colors, spacing } from '../../theme';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { FreshnessDot } from '../ui/FreshnessDot';
import {
  IconChevronRight,
  IconDroplet,
  IconTrendDown,
  IconTrendFlat,
  IconTrendUp,
} from '../ui/icons';
import { Text } from '../ui/Text';

const TREND_ICON = {
  RISING: IconTrendUp,
  FALLING: IconTrendDown,
  STABLE: IconTrendFlat,
} as const;

export function CropCard({ card }: { card: CropCardData }) {
  const { t } = useTranslation(['crop', 'agri', 'irrigation', 'market', 'common']);
  const { language } = useLanguage();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const name = localizedName(card.names, language)?.text ?? titleCaseCode(card.cropCode);

  const verdictLabel = card.irrigationVerdict
    ? t(`irrigation:title${card.irrigationVerdict}`, {
        days: 0,
        defaultValue: '',
      })
    : '';

  return (
    <Card
      onPress={() =>
        navigation.navigate('Main', {
          screen: 'FarmTab',
          params: { screen: 'CropDetail', params: { cropId: card.cropId } },
        })
      }
      accessibilityLabel={name}
      testID="crop-card"
    >
      <View style={styles.row}>
        <View style={styles.main}>
          <Text variant="subheading">{name}</Text>

          {card.stage ? (
            <Badge tone="brand">{t(`agri:stage.${card.stage}`)}</Badge>
          ) : (
            <Text variant="caption" color="ink500">
              {t('crop:noStage')}
            </Text>
          )}

          {verdictLabel || card.marketSignal ? (
            <View style={styles.chips}>
              {verdictLabel ? (
                <Badge
                  tone={card.irrigationVerdict === 'IRRIGATE_TODAY' ? 'warn' : 'neutral'}
                  icon={<IconDroplet size={14} color={colors.ink700} />}
                  testID="crop-card-irrigation"
                >
                  {verdictLabel}
                </Badge>
              ) : null}

              {card.marketSignal ? <MarketBadge signal={card.marketSignal} /> : null}
            </View>
          ) : null}

          <FreshnessDot
            status={card.freshness.status}
            fetchedAt={card.freshness.fetchedAt}
            ageHours={card.freshness.ageHours}
            staleWarning={card.freshness.staleWarning}
          />
        </View>

        <IconChevronRight size={22} color={colors.ink500} />
      </View>
    </Card>
  );
}

function MarketBadge({ signal }: { signal: MarketTrend }) {
  const { t } = useTranslation('market');
  const Icon = TREND_ICON[signal] ?? IconTrendFlat;

  return (
    <Badge tone="neutral" icon={<Icon size={14} color={colors.ink700} />} testID="crop-card-market">
      {t(`title${signal}`)}
    </Badge>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  main: { flex: 1, gap: spacing.sm, alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
