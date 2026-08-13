/**
 * The icon set.
 *
 * Inline `react-native-svg` rather than an icon package, for the same reason
 * the web set is inline SVG (web/frontend/src/components/ui/icons.tsx): about
 * twenty glyphs do not justify a font or a component library
 * (dependency-security.md).
 *
 * The exported names mirror the web set so a screen written for one surface
 * reads the same on the other. Where mobile navigation needs a glyph the web
 * never did (a back chevron, a pull-to-refresh arrow) the name is new; where
 * mobile idiom spells an existing glyph differently, the web name stays
 * canonical and the mobile spelling is an alias, so neither surface has to
 * remember two names for one shape.
 *
 * Every icon here is decorative. Icons in this product always sit beside a
 * translated label, never instead of one (accessibility.md: "priority/status
 * never color-alone (icon+label always)"), so they are removed from the
 * accessibility tree — announcing them would only duplicate the text next to
 * them. The shapes are chosen to be distinguishable in outline, not by colour.
 */
import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '../../theme';

export interface IconProps {
  size?: number;
  color?: string;
}

function Glyph({
  size = 20,
  color = colors.ink700,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {children}
    </Svg>
  );
}

/** CRITICAL — a triangle reads as "stop" even with no colour at all. */
export const IconAlertTriangle = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <Path d="M12 9v4" />
    <Path d="M12 17h.01" />
  </Glyph>
);

/** HIGH — a circle with a bang. */
export const IconAlertCircle = (props: IconProps) => (
  <Glyph {...props}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M12 8v4" />
    <Path d="M12 16h.01" />
  </Glyph>
);

/** The generic "something is wrong" glyph. Same shape as CRITICAL by design. */
export const IconAlert = IconAlertTriangle;

/** MEDIUM — time-bounded, worth doing. */
export const IconClock = (props: IconProps) => (
  <Glyph {...props}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M12 7v5l3 2" />
  </Glyph>
);

/** INFO — no action implied. */
export const IconInfo = (props: IconProps) => (
  <Glyph {...props}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M12 11v5" />
    <Path d="M12 8h.01" />
  </Glyph>
);

export const IconCheck = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="m4 12 5 5L20 6" />
  </Glyph>
);

export const IconX = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M18 6 6 18" />
    <Path d="m6 6 12 12" />
  </Glyph>
);

/** Mobile spelling of `IconX`; sheets and modals dismiss rather than "x out". */
export const IconClose = IconX;

export const IconChevronDown = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="m6 9 6 6 6-6" />
  </Glyph>
);

export const IconChevronRight = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="m9 6 6 6-6 6" />
  </Glyph>
);

export const IconChevronLeft = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="m15 6-6 6 6 6" />
  </Glyph>
);

export const IconHome = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <Path d="M9 21v-7h6v7" />
  </Glyph>
);

export const IconField = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M3 20h18" />
    <Path d="M5 20V9l7-5 7 5v11" />
    <Path d="M9 20v-5h6v5" />
  </Glyph>
);

export const IconCamera = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <Circle cx="12" cy="13" r="3.5" />
  </Glyph>
);

export const IconChart = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M4 20V10" />
    <Path d="M10 20V4" />
    <Path d="M16 20v-7" />
    <Path d="M22 20H2" />
  </Glyph>
);

/** The market surface's glyph. Prices are what the chart is *of*. */
export const IconMarket = IconChart;

export const IconDroplet = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3Z" />
  </Glyph>
);

export const IconCloud = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M7 18a4 4 0 0 1 .6-8A5.5 5.5 0 0 1 18 10.5a3.75 3.75 0 0 1-.4 7.5Z" />
  </Glyph>
);

export const IconLeaf = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M5 19c0-8 5-13 15-13 0 10-5 14-11 14a4 4 0 0 1-4-1Z" />
    <Path d="M5 19c3-4 6-6 10-8" />
  </Glyph>
);

export const IconUsers = (props: IconProps) => (
  <Glyph {...props}>
    <Circle cx="9" cy="8" r="3.5" />
    <Path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <Path d="M17 5.2a3.5 3.5 0 0 1 0 6.6" />
    <Path d="M18.5 14.2A6.5 6.5 0 0 1 21.5 20" />
  </Glyph>
);

export const IconSettings = (props: IconProps) => (
  <Glyph {...props}>
    <Circle cx="12" cy="12" r="3" />
    <Path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </Glyph>
);

export const IconHistory = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M3 12a9 9 0 1 0 3-6.7" />
    <Path d="M3 4v5h5" />
    <Path d="M12 8v4l3 2" />
  </Glyph>
);

/** Manual refresh. Distinct from `IconHistory` — no clock hands. */
export const IconRefresh = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <Path d="M20 3v5h-5" />
  </Glyph>
);

export const IconLocation = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Z" />
    <Circle cx="12" cy="10" r="2.5" />
  </Glyph>
);

export const IconSpeaker = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M11 5 6 9H3v6h3l5 4Z" />
    <Path d="M16 9a4 4 0 0 1 0 6" />
    <Path d="M19 6a8 8 0 0 1 0 12" />
  </Glyph>
);

export const IconMic = (props: IconProps) => (
  <Glyph {...props}>
    <Rect x="9" y="3" width="6" height="11" rx="3" />
    <Path d="M5 11a7 7 0 0 0 14 0" />
    <Path d="M12 18v3" />
  </Glyph>
);

export const IconUpload = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M12 16V4" />
    <Path d="m7 9 5-5 5 5" />
    <Path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </Glyph>
);

export const IconPlus = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M12 5v14" />
    <Path d="M5 12h14" />
  </Glyph>
);

export const IconTrash = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M4 7h16" />
    <Path d="M9 7V5h6v2" />
    <Path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" />
  </Glyph>
);

export const IconSearch = (props: IconProps) => (
  <Glyph {...props}>
    <Circle cx="11" cy="11" r="7" />
    <Path d="m20 20-3.5-3.5" />
  </Glyph>
);

export const IconTrendUp = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="m3 17 6-6 4 4 8-8" />
    <Path d="M15 7h6v6" />
  </Glyph>
);

export const IconTrendDown = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="m3 7 6 6 4-4 8 8" />
    <Path d="M15 17h6v-6" />
  </Glyph>
);

export const IconTrendFlat = (props: IconProps) => (
  <Glyph {...props}>
    <Path d="M3 12h14" />
    <Path d="m14 8 4 4-4 4" />
  </Glyph>
);
