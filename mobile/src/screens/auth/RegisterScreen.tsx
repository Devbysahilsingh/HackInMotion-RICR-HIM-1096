/**
 * Create an account.
 *
 * The schema mirrors `registerSchema` in `backend/src/routes/auth.js` bound for
 * bound — the same lengths, the same required set — so a value the server will
 * refuse is refused here first, in the farmer's own language, without a round
 * trip on a connection that may not have one to spare. The server still
 * validates: this is a courtesy, never the control.
 *
 * A 422 that arrives anyway is placed back onto the field that caused it rather
 * than dropped into a banner the farmer has to map by hand; only a failure with
 * no field attached (a duplicate email, a rate limit) becomes the banner.
 *
 * As with login, success does not navigate — `AuthContext` flips status and
 * `RootNavigator` swaps the stack.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Notice } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import { Screen } from '../../components/ui/Screen';
import { useApiErrorMessage, useServerFieldErrors } from '../../hooks/useApiError';
import { useNetworkStatus } from '../../hooks/useOnlineManager';
import type { AuthStackParamList } from '../../navigation/types';
import { useAuth } from '../../store/AuthContext';
import { useLanguage } from '../../store/LanguageContext';
import { spacing } from '../../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `backend/src/routes/auth.js` — registerSchema. */
const NAME_MIN = 2;
const NAME_MAX = 60;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

const FIELDS = ['name', 'email', 'password'] as const;

type FieldName = (typeof FIELDS)[number];
type Errors = Partial<Record<FieldName, string>>;

export function RegisterScreen({ navigation }: Props) {
  const { t } = useTranslation(['auth', 'common', 'errors']);
  const { register: createAccount } = useAuth();
  const { language } = useLanguage();
  const toMessage = useApiErrorMessage();
  const placeServerErrors = useServerFieldErrors();
  const { online, known } = useNetworkStatus();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const clearFieldError = (field: FieldName) => {
    setErrors((previous) => (previous[field] ? { ...previous, [field]: undefined } : previous));
  };

  const submit = () => {
    if (isSubmitting) return;

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const next: Errors = {};

    if (trimmedName.length < NAME_MIN) next.name = t('common:validation.min', { min: NAME_MIN });
    else if (trimmedName.length > NAME_MAX)
      next.name = t('common:validation.max', { max: NAME_MAX });

    if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail) || trimmedEmail.length > EMAIL_MAX) {
      next.email = t('common:validation.email');
    }

    if (password.length < PASSWORD_MIN) {
      next.password = t('common:validation.min', { min: PASSWORD_MIN });
    } else if (password.length > PASSWORD_MAX) {
      next.password = t('common:validation.max', { max: PASSWORD_MAX });
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setFormError(null);
    setIsSubmitting(true);

    void (async () => {
      try {
        // The language on screen becomes the account's language: this is the
        // only moment it can be recorded at creation, and a farmer who picked
        // Hindi on the intro screen should not receive an English account.
        await createAccount({
          name: trimmedName,
          email: trimmedEmail,
          password,
          language,
        });
      } catch (error) {
        const placed = placeServerErrors(error, FIELDS);
        if (Object.keys(placed).length > 0) setErrors(placed);
        else setFormError(toMessage(error));
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <Screen
      keyboardAvoiding
      edges={['top', 'left', 'right', 'bottom']}
      contentContainerStyle={styles.content}
    >
      <View style={styles.heading}>
        <Text variant="title" accessibilityRole="header">
          {t('auth:registerTitle')}
        </Text>
        <Text variant="small" color="ink500">
          {t('auth:registerSubtitle')}
        </Text>
      </View>

      {/* Creating an account is a write. There is no offline path for it. */}
      {known && !online ? (
        <Notice tone="warning" testID="register-offline">
          <Text variant="small" color="ink700">
            {t('errors:network')}
          </Text>
        </Notice>
      ) : null}

      {formError ? (
        <Notice tone="danger" testID="register-error">
          <Text variant="small" color="ink700">
            {formError}
          </Text>
        </Notice>
      ) : null}

      <Input
        label={t('auth:nameLabel')}
        value={name}
        onChangeText={(value) => {
          setName(value);
          clearFieldError('name');
        }}
        placeholder={t('auth:namePlaceholder')}
        error={errors.name}
        required
        maxLength={NAME_MAX}
        textContentType="name"
        autoComplete="name"
        autoCapitalize="words"
        returnKeyType="next"
        testID="name-input"
      />

      <Input
        label={t('auth:emailLabel')}
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          clearFieldError('email');
        }}
        placeholder={t('auth:emailPlaceholder')}
        error={errors.email}
        required
        maxLength={EMAIL_MAX}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        testID="email-input"
      />

      <View style={styles.passwordBlock}>
        <Input
          label={t('auth:passwordLabel')}
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            clearFieldError('password');
          }}
          hint={t('auth:passwordHint')}
          error={errors.password}
          required
          maxLength={PASSWORD_MAX}
          secureTextEntry={!showPassword}
          textContentType="newPassword"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={submit}
          testID="password-input"
        />
        <Button
          variant="ghost"
          onPress={() => setShowPassword((value) => !value)}
          style={styles.reveal}
          testID="password-reveal"
        >
          {showPassword ? t('auth:hidePassword') : t('auth:showPassword')}
        </Button>
      </View>

      <Button size="lg" fullWidth onPress={submit} loading={isSubmitting} testID="register-submit">
        {isSubmitting ? t('auth:registering') : t('auth:registerCta')}
      </Button>

      <View style={styles.footer}>
        <Text variant="small" color="ink500" align="center">
          {t('auth:haveAccount')}
        </Text>
        <Button
          variant="secondary"
          fullWidth
          onPress={() => navigation.navigate('Login')}
          disabled={isSubmitting}
          testID="go-to-login"
        >
          {t('auth:goToLogin')}
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  heading: { gap: spacing.xs, paddingTop: spacing.lg },
  passwordBlock: { gap: spacing.xs },
  reveal: { alignSelf: 'flex-end' },
  footer: { gap: spacing.sm, marginTop: spacing.md },
});
