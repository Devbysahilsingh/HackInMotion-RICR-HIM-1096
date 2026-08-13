import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { AnalysisResultScreen } from '../screens/scan/AnalysisResultScreen';
import { AnalyzingScreen } from '../screens/scan/AnalyzingScreen';
import { CameraScreen } from '../screens/scan/CameraScreen';
import { CropPickScreen } from '../screens/scan/CropPickScreen';
import { SymptomChecklistScreen } from '../screens/scan/SymptomChecklistScreen';
import { useStackScreenOptions } from './screenOptions';
import type { ScanStackParamList } from './types';

const Stack = createNativeStackNavigator<ScanStackParamList>();

/**
 * The hero flow. Two screens deviate from the stack defaults on purpose:
 *
 * - **Camera** is full-bleed with no header — the viewfinder is the interface,
 *   and a header would eat the frame the farmer is trying to fill with a leaf.
 * - **Analyzing** disables the back gesture and hides the back button. An
 *   accidental swipe there cancels an upload that is already on the wire; the
 *   screen offers an explicit Cancel with a confirmation instead
 *   (docs/mobile/navigation.md: "analyzing screen blocks accidental back").
 */
export function ScanStack() {
  const { t } = useTranslation(['common', 'health', 'mobile']);
  const screenOptions = useStackScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="CropPick" component={CropPickScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="Camera"
        component={CameraScreen}
        options={{ headerShown: false, animation: 'fade' }}
      />
      <Stack.Screen
        name="Analyzing"
        component={AnalyzingScreen}
        options={{
          title: t('mobile:upload.analyzing'),
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="AnalysisResult"
        component={AnalysisResultScreen}
        options={{ title: t('health:resultTitle') }}
      />
      <Stack.Screen
        name="SymptomChecklist"
        component={SymptomChecklistScreen}
        options={{ title: t('health:symptomTitle') }}
      />
    </Stack.Navigator>
  );
}
