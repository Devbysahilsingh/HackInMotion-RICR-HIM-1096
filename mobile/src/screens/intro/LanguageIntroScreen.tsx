/**
 * First run, and only first run.
 *
 * Two jobs, in this order: let the farmer pick a language, and say what the app
 * is for. Language comes first because everything below it is unreadable until
 * that choice is made — a screen that explains the product in English to a
 * Hindi speaker has already failed before its argument starts.
 *
 * The three value slides are stacked rather than paged. A carousel hides two
 * thirds of its content behind a gesture that has to be discovered, and the
 * whole point of this screen is that nothing on it needs discovering; scrolling
 * is the one interaction every phone user already has.
 *
 * Skipping is real, not decorative: it navigates on without storing a choice,
 * so `loadStoredLanguage()` still returns null and the screen appears again on
 * the next cold start. A farmer who did not decide has not decided.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { LANGUAGES, type Language } from '@shared/types/api';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { IconCheck, IconLeaf } from '../../components/ui/icons';
import { Text } from '../../components/ui/Text';
import { Screen } from '../../components/ui/Screen';
import type { AuthStackParamList } from '../../navigation/types';
import { useLanguage } from '../../store/LanguageContext';
import { PRESSED_OPACITY, colors, radius, spacing } from '../../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'LanguageIntro'>;

/** Well above `TOUCH_TARGET`: this is the largest decision on the screen. */
const LANGUAGE_CARD_HEIGHT = 72;

const SLIDES = [
  { title: 'intro.slide1Title', body: 'intro.slide1Body' },
  { title: 'intro.slide2Title', body: 'intro.slide2Body' },
  { title: 'intro.slide3Title', body: 'intro.slide3Body' },
] as const;

export function LanguageIntroScreen({ navigation }: Props) {
  const { t } = useTranslation(['mobile', 'common']);
  const { language, setLanguage } = useLanguage();

  // Only to keep the pressed card from looking inert while the write to
  // AsyncStorage and the i18next swap complete — both are fast, but not free.
  const [choosing, setChoosing] = useState<Language | null>(null);

  const choose = (next: Language) => {
    if (choosing) return;
    setChoosing(next);

    void (async () => {
      // No `sync: true` — there is no session yet to mirror the choice onto.
      // `RegisterScreen` sends the chosen language with the account instead.
      await setLanguage(next);
      navigation.replace('Login');
    })();
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} contentContainerStyle={styles.content}>
      <View style={styles.masthead}>
        <IconLeaf size={40} color={colors.brand600} />
        <Text variant="title" align="center">
          {t('common:app.name')}
        </Text>
        <Text variant="small" color="ink500" align="center">
          {t('common:app.tagline')}
        </Text>
      </View>

      <View style={styles.section}>
        <Text variant="heading" accessibilityRole="header" align="center">
          {t('mobile:intro.chooseLanguage')}
        </Text>

        <View style={styles.languages}>
          {LANGUAGES.map((code) => {
            const label = t(`common:language.${code}`);
            const isCurrent = code === language;

            return (
              <Pressable
                key={code}
                onPress={() => choose(code)}
                disabled={choosing !== null}
                accessibilityRole="button"
                // The label is in its own script, so a screen reader set to the
                // other language would mispronounce it on its own. The spoken
                // form names the action instead.
                accessibilityLabel={t('common:language.switchTo', { language: label })}
                accessibilityState={{ selected: isCurrent, disabled: choosing !== null }}
                testID={`language-${code}`}
                style={({ pressed }) => [
                  styles.languageCard,
                  isCurrent && styles.languageCardCurrent,
                  pressed && { opacity: PRESSED_OPACITY },
                  choosing !== null && choosing !== code && styles.languageCardDimmed,
                ]}
              >
                <Text variant="heading" style={styles.languageLabel}>
                  {label}
                </Text>
                {isCurrent ? <IconCheck size={22} color={colors.brand600} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        {SLIDES.map((slide) => (
          <Card key={slide.title}>
            <View style={styles.slide}>
              <Text variant="subheading" accessibilityRole="header">
                {t(`mobile:${slide.title}`)}
              </Text>
              <Text variant="small" color="ink700">
                {t(`mobile:${slide.body}`)}
              </Text>
            </View>
          </Card>
        ))}
      </View>

      <Button
        variant="ghost"
        fullWidth
        onPress={() => navigation.replace('Login')}
        disabled={choosing !== null}
        testID="intro-skip"
      >
        {t('common:action.skip')}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  masthead: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.lg },
  section: { gap: spacing.md },
  languages: { gap: spacing.md },
  languageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: LANGUAGE_CARD_HEIGHT,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  languageCardCurrent: { borderColor: colors.brand600, backgroundColor: colors.brand50 },
  languageCardDimmed: { opacity: 0.5 },
  languageLabel: { flex: 1 },
  slide: { gap: spacing.xs },
});
