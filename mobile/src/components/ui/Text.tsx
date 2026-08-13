/**
 * The one text primitive.
 *
 * Every visible string in the app goes through here so the type ramp in
 * `theme/index.ts` is the only place a size or a weight is decided — a screen
 * that reached for a raw `<Text>` would silently opt out of the larger,
 * Devanagari-legible scale that ramp exists to guarantee.
 *
 * Font scaling is deliberately *not* disabled. A farmer who has turned the
 * system font up has told the device something, and `allowFontScaling={false}`
 * would override it; accessibility.md requires this app to stay usable at 1.3×,
 * which is why the layouts around this component size to content rather than to
 * fixed heights.
 */
import { Text as RNText, type TextProps } from 'react-native';

import { colors, typography } from '../../theme';

export type TextVariant = keyof typeof typography;
export type TextColor = 'ink900' | 'ink700' | 'ink500' | 'brand600' | 'danger600' | 'inverse';

const COLOR: Record<TextColor, string> = {
  ink900: colors.ink900,
  ink700: colors.ink700,
  ink500: colors.ink500,
  brand600: colors.brand600,
  danger600: colors.danger600,
  /** For text sitting on a brand or danger fill. */
  inverse: colors.surface,
};

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: TextColor;
  align?: 'auto' | 'left' | 'right' | 'center';
}

export function Text({
  variant = 'body',
  color = 'ink900',
  align,
  style,
  children,
  ...rest
}: AppTextProps) {
  return (
    <RNText
      style={[
        typography[variant],
        { color: COLOR[color] },
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </RNText>
  );
}
