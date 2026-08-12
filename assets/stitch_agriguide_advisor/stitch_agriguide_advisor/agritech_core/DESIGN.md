---
name: AgriTech Core
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#404943'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#707973'
  outline-variant: '#bfc9c1'
  surface-tint: '#2c694e'
  primary: '#0f5238'
  on-primary: '#ffffff'
  primary-container: '#2d6a4f'
  on-primary-container: '#a8e7c5'
  inverse-primary: '#95d4b3'
  secondary: '#765749'
  on-secondary: '#ffffff'
  secondary-container: '#fed4c2'
  on-secondary-container: '#795a4c'
  tertiary: '#713638'
  on-tertiary: '#ffffff'
  tertiary-container: '#8d4d4e'
  on-tertiary-container: '#ffcfce'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#b1f0ce'
  primary-fixed-dim: '#95d4b3'
  on-primary-fixed: '#002114'
  on-primary-fixed-variant: '#0e5138'
  secondary-fixed: '#ffdbcc'
  secondary-fixed-dim: '#e6bead'
  on-secondary-fixed: '#2c160b'
  on-secondary-fixed-variant: '#5c4033'
  tertiary-fixed: '#ffdad9'
  tertiary-fixed-dim: '#ffb3b3'
  on-tertiary-fixed: '#390b0e'
  on-tertiary-fixed-variant: '#6f3537'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-sm:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  touch-target-min: 48px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
  container-max: 1280px
---

## Brand & Style
The design system is rooted in the intersection of organic vitality and industrial precision. It targets agricultural professionals who require high-utility tools that perform reliably in varied lighting conditions and high-pressure environments. 

The visual direction follows a **Corporate / Modern** aesthetic with a **Tactile** lean. It prioritizes clarity and high-contrast accessibility to accommodate users with varying levels of digital literacy. The emotional response should be one of "stable growth"—conveying that the technology is an extension of the field, not a distraction from it. Heavy use of whitespace and purposeful movement ensures that the most critical data is never obscured by interface noise.

## Colors
This design system utilizes a palette inspired by the natural lifecycle of a crop. 

- **Primary (Earthy Green):** Used for primary actions, success states, and branding elements to represent growth and health.
- **Secondary (Soil Brown):** Reserved for grounded structural elements, specialized categories, or "earth-moving" actions.
- **Background (Off-white):** A soft, non-glare surface that reduces eye strain during outdoor use.
- **Semantic Palette:** High-chroma tones are used for alerts to ensure they are unmistakable against the naturalistic primary palette. Use **Red** for urgent crop health alerts or equipment failure, **Orange** for weather warnings, and **Blue** for irrigation or general data insights.

## Typography
The system employs **Inter** for its exceptional legibility and neutral, professional tone. 

To support users with low digital literacy, the type scale is intentionally generous. **Headlines** use a bold weight and tight letter-spacing to create a strong visual anchor for each section. **Body text** utilizes a high line-height (1.5x minimum) to ensure that technical instructions and data are easily digestible. Avoid using light font weights; stick to Regular (400), Medium (500), and Bold (700) to maintain contrast against the neutral background.

## Layout & Spacing
The layout follows a **Fluid Grid** model with a standard 8px baseline rhythm.

- **Mobile:** 4-column grid with 16px margins. Primary interactions should be placed in the bottom two-thirds of the screen for easy thumb reach.
- **Tablet/Desktop:** 12-column grid with 24px-32px gutters.
- **Touch Targets:** A strict minimum of 48x48px for all interactive elements to accommodate outdoor use, gloves, or varying motor precision.
- **Negative Space:** Use generous padding (minimum 24px) inside cards to prevent data density from becoming overwhelming.

## Elevation & Depth
Depth is conveyed through **Tonal Layers** and **Ambient Shadows**. 

1.  **Level 0 (Base):** Off-white background (#F8F9FA).
2.  **Level 1 (Cards/Surface):** Pure white surfaces with a very soft, diffused shadow (0px 4px 12px rgba(0,0,0,0.05)). This differentiates content from the background without creating visual clutter.
3.  **Level 2 (Active/Floating):** Used for floating action buttons or active menus. Shadows are deeper and slightly more opaque (0px 8px 24px rgba(0,0,0,0.1)).

Avoid heavy borders or harsh shadows. Use 1px interior strokes in a light neutral gray to define boundaries between list items or table rows.

## Shapes
This design system uses a **Rounded** shape language to evoke a friendly yet professional feel. 

- **Cards and Containers:** Use `rounded-lg` (16px) for main content blocks to create a soft, approachable structure.
- **Buttons and Inputs:** Use a standard 12px radius to balance modernity with high touch-target visibility.
- **Status Badges:** Use a fully rounded (pill) shape to distinguish status indicators from clickable buttons.

## Components
- **Buttons:** Primary buttons use Earthy Green with white text. They must be 48px tall minimum. Ensure "Disabled" states use a clear gray-out to prevent confusion.
- **Status Badges:** Large, clear badges with high-contrast text. Use the semantic color palette (e.g., a green badge for "Healthy", a red badge for "Action Required"). Include an icon within the badge for redundant signaling.
- **Data Cards:** Content should be grouped logically with a clear Title (Headline-sm). Use "Big Number" formatting for primary metrics (e.g., Soil Moisture: 42%).
- **Input Fields:** Use 12px rounded corners with a clear 2px border on focus using the Primary color. Labels must always be visible (avoid placeholder-only labels).
- **Navigation:** A bottom navigation bar on mobile with large icons and text labels to ensure clear paths for navigation.
- **List Items:** High-profile rows with 16px vertical padding and chevron indicators to suggest "drill-down" capability.