/**
 * The icon set.
 *
 * Inline SVG rather than an icon package: the whole app needs about twenty
 * glyphs, and a font or component library for that would be dependency weight
 * with no payoff (dependency-security.md).
 *
 * Every icon here is decorative — `aria-hidden`, no title. Icons in this
 * product always sit beside a translated label, never instead of one
 * (accessibility.md: "priority/status never color-alone (icon+label always)"),
 * so announcing them would only duplicate the text next to them. The shapes
 * are chosen to be distinguishable in outline, not only by colour.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** CRITICAL — a triangle reads as "stop" even with no colour at all. */
export const IconAlertTriangle = (props: IconProps) => (
  <Svg {...props}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Svg>
);

/** HIGH — a filled-feel circle with a bang. */
export const IconAlertCircle = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </Svg>
);

/** MEDIUM — time-bounded, worth doing. */
export const IconClock = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

/** INFO — no action implied. */
export const IconInfo = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </Svg>
);

export const IconCheck = (props: IconProps) => (
  <Svg {...props}>
    <path d="m4 12 5 5L20 6" />
  </Svg>
);

export const IconX = (props: IconProps) => (
  <Svg {...props}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Svg>
);

export const IconChevronDown = (props: IconProps) => (
  <Svg {...props}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const IconChevronRight = (props: IconProps) => (
  <Svg {...props}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const IconArrowLeft = (props: IconProps) => (
  <Svg {...props}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </Svg>
);

export const IconHome = (props: IconProps) => (
  <Svg {...props}>
    <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <path d="M9 21v-7h6v7" />
  </Svg>
);

export const IconField = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 20h18" />
    <path d="M5 20V9l7-5 7 5v11" />
    <path d="M9 20v-5h6v5" />
  </Svg>
);

export const IconCamera = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);

export const IconChart = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 20V10" />
    <path d="M10 20V4" />
    <path d="M16 20v-7" />
    <path d="M22 20H2" />
  </Svg>
);

export const IconDroplet = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3Z" />
  </Svg>
);

export const IconCloud = (props: IconProps) => (
  <Svg {...props}>
    <path d="M7 18a4 4 0 0 1 .6-8A5.5 5.5 0 0 1 18 10.5a3.75 3.75 0 0 1-.4 7.5Z" />
  </Svg>
);

export const IconLeaf = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5 19c0-8 5-13 15-13 0 10-5 14-11 14a4 4 0 0 1-4-1Z" />
    <path d="M5 19c3-4 6-6 10-8" />
  </Svg>
);

export const IconUsers = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M17 5.2a3.5 3.5 0 0 1 0 6.6" />
    <path d="M18.5 14.2A6.5 6.5 0 0 1 21.5 20" />
  </Svg>
);

export const IconSettings = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </Svg>
);

export const IconHistory = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
    <path d="M12 8v4l3 2" />
  </Svg>
);

export const IconLocation = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </Svg>
);

export const IconSpeaker = (props: IconProps) => (
  <Svg {...props}>
    <path d="M11 5 6 9H3v6h3l5 4Z" />
    <path d="M16 9a4 4 0 0 1 0 6" />
    <path d="M19 6a8 8 0 0 1 0 12" />
  </Svg>
);

export const IconMic = (props: IconProps) => (
  <Svg {...props}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </Svg>
);

export const IconUpload = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </Svg>
);

export const IconPlus = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Svg>
);

export const IconTrash = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 7h16" />
    <path d="M9 7V5h6v2" />
    <path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" />
  </Svg>
);

export const IconSearch = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const IconTrendUp = (props: IconProps) => (
  <Svg {...props}>
    <path d="m3 17 6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </Svg>
);

export const IconTrendDown = (props: IconProps) => (
  <Svg {...props}>
    <path d="m3 7 6 6 4-4 8 8" />
    <path d="M15 17h6v-6" />
  </Svg>
);

export const IconTrendFlat = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 12h14" />
    <path d="m14 8 4 4-4 4" />
  </Svg>
);
