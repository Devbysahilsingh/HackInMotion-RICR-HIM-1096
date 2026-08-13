/**
 * One header style for every stack.
 *
 * Declared once so the four feature stacks cannot drift apart visually, and so
 * the back-button label — which Android renders as a tooltip and screen
 * readers announce — comes from the translation table like everything else.
 */
import { useTranslation } from 'react-i18next';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

import { colors, typography } from '../theme';

export function useStackScreenOptions(): NativeStackNavigationOptions {
  const { t } = useTranslation('common');

  return {
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.ink900,
    headerTitleStyle: { fontSize: typography.subheading.fontSize, fontWeight: '600' },
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal',
    headerBackButtonMenuEnabled: false,
    headerBackTitle: t('action.back'),
    contentStyle: { backgroundColor: colors.canvas },
  };
}
