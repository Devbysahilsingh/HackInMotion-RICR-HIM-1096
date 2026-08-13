/**
 * Signed-out flow.
 *
 * The language screen leads on first launch and is skipped forever after — a
 * persona requirement (docs/mobile/navigation.md: "First-run: language screen
 * before auth"). It is reachable again from Settings, so nothing is lost by
 * not showing it twice.
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { LanguageIntroScreen } from '../screens/intro/LanguageIntroScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack({ languageChosen }: { languageChosen: boolean }) {
  return (
    <Stack.Navigator
      initialRouteName={languageChosen ? 'Login' : 'LanguageIntro'}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="LanguageIntro" component={LanguageIntroScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
    </Stack.Navigator>
  );
}
