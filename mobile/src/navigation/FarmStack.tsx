import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { CropDetailScreen } from '../screens/farm/CropDetailScreen';
import { CropFormScreen } from '../screens/farm/CropFormScreen';
import { FarmDetailScreen } from '../screens/farm/FarmDetailScreen';
import { FarmFormScreen } from '../screens/farm/FarmFormScreen';
import { FarmListScreen } from '../screens/farm/FarmListScreen';
import { WeatherScreen } from '../screens/farm/WeatherScreen';
import { useStackScreenOptions } from './screenOptions';
import type { FarmStackParamList } from './types';

const Stack = createNativeStackNavigator<FarmStackParamList>();

/**
 * The land: fields, what is planted in them, and the weather over them.
 *
 * Weather sits in this stack rather than in a tab because it is never asked in
 * the abstract — it is always "the weather over *this* field", and the farm is
 * what carries the coordinates.
 */
export function FarmStack() {
  const { t } = useTranslation(['common', 'farm', 'crop', 'weather']);
  const screenOptions = useStackScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="FarmList" component={FarmListScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="FarmForm"
        component={FarmFormScreen}
        options={({ route }) => ({
          title: route.params?.farmId ? t('farm:editTitle') : t('farm:newTitle'),
        })}
      />
      <Stack.Screen name="FarmDetail" component={FarmDetailScreen} options={{ title: '' }} />
      <Stack.Screen
        name="CropForm"
        component={CropFormScreen}
        options={{ title: t('crop:addTitle') }}
      />
      <Stack.Screen name="CropDetail" component={CropDetailScreen} options={{ title: '' }} />
      <Stack.Screen
        name="Weather"
        component={WeatherScreen}
        options={{ title: t('weather:pageTitle') }}
      />
    </Stack.Navigator>
  );
}
