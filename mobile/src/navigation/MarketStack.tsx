import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { CommodityDetailScreen } from '../screens/market/CommodityDetailScreen';
import { MarketOverviewScreen } from '../screens/market/MarketOverviewScreen';
import { useStackScreenOptions } from './screenOptions';
import type { MarketStackParamList } from './types';

const Stack = createNativeStackNavigator<MarketStackParamList>();

export function MarketStack() {
  const { t } = useTranslation(['common', 'market']);
  const screenOptions = useStackScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="MarketOverview"
        component={MarketOverviewScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CommodityDetail"
        component={CommodityDetailScreen}
        options={{ title: t('market:pageTitle') }}
      />
    </Stack.Navigator>
  );
}
