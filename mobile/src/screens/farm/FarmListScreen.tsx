/**
 * The farmer's land, as a list.
 *
 * This screen owns its own title because `FarmStack` renders it with the
 * navigation header off — a stack's first screen has nothing to go back to, so
 * a header bar would be a bar with a title and no function.
 *
 * `MAX_FARMS_PER_USER` is surfaced rather than discovered: the API answers a
 * eleventh farm with a 409, and a farmer should meet that ceiling as a sentence
 * next to a hidden button, not as an error after filling in a form.
 */
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { queryKeys } from '@shared/client/queryKeys';
import { formatNumber } from '@shared/client/format';
import { MAX_FARMS_PER_USER } from '@shared/types/api';

import { farmsApi } from '../../api/endpoints';
import { QueryBoundary } from '../../components/QueryBoundary';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { IconChevronRight, IconLocation, IconPlus } from '../../components/ui/icons';
import { Screen } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { EmptyState, Notice } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import type { FarmStackParamList } from '../../navigation/types';
import { useLanguage } from '../../store/LanguageContext';
import { colors, spacing } from '../../theme';

type Props = NativeStackScreenProps<FarmStackParamList, 'FarmList'>;

export function FarmListScreen({ navigation }: Props) {
  const { t } = useTranslation(['farm', 'common', 'agri']);
  const { language } = useLanguage();

  const query = useQuery({ queryKey: queryKeys.farms.list(), queryFn: farmsApi.list });

  const farms = query.data?.farms ?? [];
  const atLimit = farms.length >= MAX_FARMS_PER_USER;

  const addFarm = () => navigation.navigate('FarmForm');

  return (
    <Screen onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <SectionHeader
        title={t('farm:listTitle')}
        action={
          atLimit ? undefined : (
            <Button
              onPress={addFarm}
              leadingIcon={<IconPlus size={18} color={colors.surface} />}
              testID="farm-add"
            >
              {t('common:action.add')}
            </Button>
          )
        }
      />

      {atLimit ? (
        <Notice tone="info" testID="farm-limit">
          <Text variant="small" color="ink700">
            {t('farm:limitHint', { max: MAX_FARMS_PER_USER })}
          </Text>
        </Notice>
      ) : null}

      <QueryBoundary
        query={query}
        loadingLabel={t('farm:listTitle')}
        isEmpty={(data) => data.farms.length === 0}
        empty={
          <EmptyState
            title={t('farm:listEmpty')}
            action={
              <Button
                onPress={addFarm}
                leadingIcon={<IconPlus size={18} color={colors.surface} />}
                testID="farm-add-empty"
              >
                {t('farm:listEmptyCta')}
              </Button>
            }
            testID="farm-list-empty"
          />
        }
      >
        {(data) => (
          <View style={styles.list} testID="farm-list">
            {data.farms.map((farm) => (
              <Card
                key={farm.id}
                onPress={() => navigation.navigate('FarmDetail', { farmId: farm.id })}
                accessibilityLabel={farm.name}
                testID="farm-list-item"
              >
                <View style={styles.row}>
                  <View style={styles.body}>
                    <Text variant="subheading" numberOfLines={1}>
                      {farm.name}
                    </Text>

                    <View style={styles.location}>
                      <IconLocation size={15} color={colors.ink500} />
                      <Text
                        variant="small"
                        color="ink500"
                        numberOfLines={1}
                        style={styles.flexText}
                      >
                        {[farm.location.district, farm.location.state].filter(Boolean).join(', ')}
                      </Text>
                    </View>

                    <View style={styles.badges}>
                      <Badge>
                        {`${formatNumber(farm.sizeValue, language)} ${t(`common:unit.${farm.sizeUnit}`)}`}
                      </Badge>
                      <Badge>{t(`agri:soil.${farm.soilType}`)}</Badge>
                      <Badge>{t(`agri:irrigationMethod.${farm.irrigationMethod}`)}</Badge>
                    </View>
                  </View>

                  <IconChevronRight size={20} color={colors.ink500} />
                </View>
              </Card>
            ))}
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  body: { flex: 1, gap: spacing.sm },
  location: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  flexText: { flex: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
