/**
 * The four questions, as four tabs.
 *
 * Order is the daily loop, not alphabetical: Home is today's verdicts, Scan is
 * one tap from anywhere because it is the hero flow, and Market and Farm close
 * the set. Icons always ship with their label — an icon-only tab bar is a
 * literacy barrier, which is precisely the user this product is for.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';

import { IconCamera, IconHome, IconLeaf, IconMarket } from '../components/ui/icons';
import { colors, TOUCH_TARGET, typography } from '../theme';
import { FarmStack } from './FarmStack';
import { HomeStack } from './HomeStack';
import { MarketStack } from './MarketStack';
import { ScanStack } from './ScanStack';
import type { MainTabsParamList } from './types';

const Tabs = createBottomTabNavigator<MainTabsParamList>();

export function MainTabs() {
  const { t } = useTranslation('common');

  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand600,
        tabBarInactiveTintColor: colors.ink500,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          // Comfortably above the 48dp floor: this bar is hit with a thumb,
          // often by someone standing in a field.
          height: TOUCH_TARGET + 26,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarLabelStyle: {
          fontSize: typography.caption.fontSize,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="HomeTab"
        component={HomeStack}
        options={{
          title: t('nav.dashboard'),
          tabBarIcon: ({ color }) => <IconHome size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="ScanTab"
        component={ScanStack}
        options={{
          title: t('nav.scan'),
          tabBarIcon: ({ color }) => <IconCamera size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="MarketTab"
        component={MarketStack}
        options={{
          title: t('nav.market'),
          tabBarIcon: ({ color }) => <IconMarket size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="FarmTab"
        component={FarmStack}
        options={{
          title: t('nav.farms'),
          tabBarIcon: ({ color }) => <IconLeaf size={26} color={color} />,
        }}
      />
    </Tabs.Navigator>
  );
}
