import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { CommunityScreen } from '../screens/home/CommunityScreen';
import { CropRecommendationScreen } from '../screens/home/CropRecommendationScreen';
import { DashboardScreen } from '../screens/home/DashboardScreen';
import { HistoryDetailScreen } from '../screens/home/HistoryDetailScreen';
import { HistoryScreen } from '../screens/home/HistoryScreen';
import { RecommendationDetailScreen } from '../screens/home/RecommendationDetailScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { useStackScreenOptions } from './screenOptions';
import type { HomeStackParamList } from './types';

const Stack = createNativeStackNavigator<HomeStackParamList>();

/**
 * Today's verdicts, plus the surfaces a farmer reaches *from* them: why an
 * alert was raised, what was advised before, and the settings gear. Settings
 * lives here rather than in a tab of its own — see navigation/types.ts.
 */
export function HomeStack() {
  const { t } = useTranslation(['common', 'health', 'cropRec', 'community']);
  const screenOptions = useStackScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="RecommendationDetail"
        component={RecommendationDetailScreen}
        options={{ title: t('common:why.heading') }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t('common:nav.settings') }}
      />
      <Stack.Screen
        name="History"
        component={HistoryScreen}
        options={{ title: t('common:nav.history') }}
      />
      <Stack.Screen
        name="HistoryDetail"
        component={HistoryDetailScreen}
        options={{ title: t('health:resultTitle') }}
      />
      <Stack.Screen
        name="CropRecommendation"
        component={CropRecommendationScreen}
        options={{ title: t('cropRec:pageTitle') }}
      />
      <Stack.Screen
        name="Community"
        component={CommunityScreen}
        options={{ title: t('common:nav.community') }}
      />
    </Stack.Navigator>
  );
}
