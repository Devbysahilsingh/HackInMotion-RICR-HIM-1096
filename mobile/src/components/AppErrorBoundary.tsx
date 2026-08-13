/**
 * Last line of defence.
 *
 * A render error anywhere below this becomes a white screen on Android with no
 * way out, which for a farmer standing in a field is indistinguishable from
 * "the app is broken forever". This catches it and offers a way back, in their
 * language.
 *
 * The error itself is logged, never shown: a stack trace is not information a
 * farmer can act on, and it can carry data from the props that produced it.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { withTranslation, type WithTranslation } from 'react-i18next';

import { Button } from './ui/Button';
import { Text } from './ui/Text';
import { colors, spacing } from '../theme';

interface Props extends WithTranslation {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

class ErrorBoundaryBase extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // `console.error` survives the production console strip (babel.config.js)
    // precisely so a crash is still visible in `adb logcat` during the demo.
    console.error('[AppErrorBoundary]', error.message, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    const { t } = this.props;

    return (
      <View style={styles.container}>
        <Text variant="heading" align="center">
          {t('mobile:errorBoundary.title')}
        </Text>
        <Text variant="body" color="ink500" align="center">
          {t('mobile:errorBoundary.body')}
        </Text>
        <Button onPress={this.reset}>{t('mobile:errorBoundary.restart')}</Button>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    backgroundColor: colors.canvas,
  },
});

export const AppErrorBoundary = withTranslation(['mobile'])(ErrorBoundaryBase);
