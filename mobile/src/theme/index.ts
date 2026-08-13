/**
 * Design tokens.
 *
 * The palette is transcribed value-for-value from the web app's `@theme` block
 * (web/frontend/src/index.css) so the two surfaces are recognisably one
 * product. What is *not* copied is the scale: this is a thumb-operated device
 * held at arm's length in a field, so the type ramp starts larger, the touch
 * targets are bigger than the web's, and the spacing is looser.
 *
 * One light theme, deliberately — same reasoning as the web: the stated field
 * context is bright sunlight on a dusty screen, where a dark default is wrong,
 * and shipping an unreviewed dark palette is worse than shipping none.
 */

export const colors = {
  brand50: '#f0f9f2',
  brand100: '#dcf0e1',
  brand200: '#bbe1c6',
  brand300: '#8ecaa2',
  brand400: '#5aab78',
  brand500: '#388e5c',
  brand600: '#277249',
  brand700: '#1f5a3b',
  brand800: '#1b4831',
  brand900: '#163b2a',

  earth50: '#faf7f2',
  earth100: '#f2ebdf',
  earth200: '#e4d6c0',
  earth600: '#8a6c43',
  earth800: '#4b3a24',

  /** Feed priority. Ranked; each clears 4.5:1 on its own soft tint. */
  priorityCritical: '#b3261e',
  priorityCriticalSoft: '#fdeceb',
  priorityHigh: '#9a4a06',
  priorityHighSoft: '#fdf0e4',
  priorityMedium: '#7a5a00',
  priorityMediumSoft: '#fbf5e0',
  priorityInfo: '#1f5a3b',
  priorityInfoSoft: '#eef6f1',

  /** The four values `freshness.status` can carry. */
  freshLive: '#277249',
  freshCached: '#8a5a00',
  freshHistorical: '#5b5f6b',
  freshPending: '#6b7280',

  danger600: '#b3261e',
  danger50: '#fdeceb',

  ink900: '#16211c',
  ink700: '#33403a',
  ink500: '#5a6a62',
  line: '#d8e0da',
  surface: '#ffffff',
  canvas: '#f6f8f6',
  overlay: 'rgba(22, 33, 28, 0.55)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * Type ramp. `body` is 17pt rather than the mobile-conventional 15 because the
 * primary persona is a farmer who may be reading at arm's length in sunlight,
 * and because Devanagari conjuncts lose legibility below about 16pt on the
 * low-density panels this app targets.
 */
export const typography = {
  display: { fontSize: 30, lineHeight: 38, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 31, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 27, fontWeight: '700' },
  subheading: { fontSize: 18, lineHeight: 25, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 25, fontWeight: '400' },
  bodyStrong: { fontSize: 17, lineHeight: 25, fontWeight: '600' },
  small: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
} as const;

/**
 * Minimum touch target. Android's own guidance is 48dp; docs/mobile/*.md asks
 * for 48px targets, and nothing interactive in this app is allowed below it.
 */
export const TOUCH_TARGET = 48;

/** Standard press feedback, so every tappable surface reacts the same way. */
export const PRESSED_OPACITY = 0.65;

export const shadow = {
  card: {
    shadowColor: '#16211c',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;
