/**
 * Sign in.
 *
 * The validation here is deliberately looser than the register screen's, and
 * that is a security decision rather than an oversight: rejecting a short
 * password on the device would answer "invalid" where a real attempt answers
 * 401, which hands an attacker a free oracle for whether an account exists.
 * `backend/src/routes/auth.js` makes exactly the same choice, and the web login
 * page mirrors it — this client must not undo it by validating harder.
 *
 * Nothing here navigates on success. `useAuth().login` flips
 * `AuthContext.status`, and `RootNavigator` swaps the whole stack in response;
 * a manual `navigate` would race that swap and lose.
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
import { useApiErrorMessage } from '../../hooks/useApiError';
import { useNetworkStatus } from '../../hooks/useOnlineManager';
import type { AuthStackParamList } from '../../navigation/types';
import { useAuth } from '../../store/AuthContext';
import { spacing } from '../../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

/**
 * Presence and shape only — the authority is the server's own check. Anything
 * stricter here rejects addresses that are legal and in use.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Errors {
  email?: string;
  password?: string;
}

export function LoginScreen({ navigation }: Props) {
  const { t } = useTranslation(['auth', 'common', 'errors']);
  const { login } = useAuth();
  const toMessage = useApiErrorMessage();
  const { online, known } = useNetworkStatus();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = () => {
    if (isSubmitting) return;

    const trimmed = email.trim();
    const next: Errors = {};
    if (!trimmed || !EMAIL_PATTERN.test(trimmed)) next.email = t('common:validation.email');
    if (!password) next.password = t('common:validation.required');

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setFormError(null);
    setIsSubmitting(true);

    void (async () => {
      try {
        await login({ email: trimmed, password });
        // Deliberately no navigation — see the module comment.
      } catch (error) {
        // One message for every failure mode: wrong password, unknown account,
        // locked out. Splitting them would enumerate accounts (ST-02).
        setFormError(toMessage(error));
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
          {t('auth:loginTitle')}
        </Text>
        <Text variant="small" color="ink500">
          {t('auth:loginSubtitle')}
        </Text>
      </View>

      {/*
        Signing in is the one thing in this app that genuinely cannot be served
        from cache, so the offline state is stated up front rather than left to
        be discovered as a timeout. The button stays enabled: NetInfo can be
        wrong about a working radio, and refusing to even try would strand a
        farmer the app has misdiagnosed (docs/offline).
      */}
      {known && !online ? (
        <Notice tone="warning" testID="login-offline">
          <Text variant="small" color="ink700">
            {t('errors:network')}
          </Text>
        </Notice>
      ) : null}

      {formError ? (
        <Notice tone="danger" testID="login-error">
          <Text variant="small" color="ink700">
            {formError}
          </Text>
        </Notice>
      ) : null}

      <Input
        label={t('auth:emailLabel')}
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          if (errors.email) setErrors((previous) => ({ ...previous, email: undefined }));
        }}
        placeholder={t('auth:emailPlaceholder')}
        error={errors.email}
        required
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
            if (errors.password) setErrors((previous) => ({ ...previous, password: undefined }));
          }}
          error={errors.password}
          required
          secureTextEntry={!showPassword}
          textContentType="password"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={submit}
          testID="password-input"
        />
        {/*
          A separate control rather than an icon inside the field: an adornment
          small enough to sit in a 48dp input is not itself a 48dp target, and
          this is a phone held in one hand.
        */}
        <Button
          variant="ghost"
          onPress={() => setShowPassword((value) => !value)}
          style={styles.reveal}
          testID="password-reveal"
        >
          {showPassword ? t('auth:hidePassword') : t('auth:showPassword')}
        </Button>
      </View>

      <Button size="lg" fullWidth onPress={submit} loading={isSubmitting} testID="login-submit">
        {isSubmitting ? t('auth:loggingIn') : t('auth:loginCta')}
      </Button>

      <View style={styles.footer}>
        <Text variant="small" color="ink500" align="center">
          {t('auth:noAccount')}
        </Text>
        <Button
          variant="secondary"
          fullWidth
          onPress={() => navigation.navigate('Register')}
          disabled={isSubmitting}
          testID="go-to-register"
        >
          {t('auth:goToRegister')}
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
