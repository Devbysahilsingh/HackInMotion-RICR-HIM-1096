/**
 * Which world the farmer is in: signed out, or signed in.
 *
 * The swap is driven by `AuthContext.status` alone. No screen navigates
 * between the two stacks by hand — that is what produces the classic bug where
 * a logged-out user can still press Back into the dashboard, because the
 * authenticated stack was never unmounted.
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../store/AuthContext';
import { colors } from '../theme';
import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator({ languageChosen }: { languageChosen: boolean }) {
  const { status } = useAuth();

  if (status === 'bootstrapping') {
    // Resuming a stored session. Wordless on purpose: this frame lasts about
    // as long as one network round-trip, and a message would flash.
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={colors.brand600} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {status === 'authenticated' ? (
        <Stack.Screen name="Main" component={MainTabs} />
      ) : (
        <Stack.Screen name="Auth">
          {() => <AuthStack languageChosen={languageChosen} />}
        </Stack.Screen>
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
});
