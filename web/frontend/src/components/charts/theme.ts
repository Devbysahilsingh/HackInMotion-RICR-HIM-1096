/**
 * Chart parameters.
 *
 * The series hues are **not** the brand tokens. `#277249` (brand-600) fails the
 * chroma floor on a white surface — the validator reports it as reading gray —
 * so the categorical slots below come from the validated default palette
 * instead, and the brand colour stays where it belongs: on buttons, chips and
 * headings.
 *
 * Validated with `dataviz/scripts/validate_palette.js`:
 *
 *   node scripts/validate_palette.js "#2a78d6,#eb6834" --mode light --surface "#ffffff"
 *     [PASS] lightness band · chroma floor · contrast ≥3:1
 *     [PASS] CVD separation   worst adjacent ΔE 24.7 (protan), 32.7 (tritan)
 *     [PASS] normal-vision    worst adjacent ΔE 33.6
 *
 * Light surface only, deliberately: the app ships one light theme (see
 * `index.css`), so there is no dark step to select and none is invented.
 */
export const CHART = {
  /** Categorical slot 1. Single-series charts use this. */
  series1: '#2a78d6',
  /** Categorical slot 2. Only ever paired with slot 1. */
  series2: '#eb6834',
  surface: '#ffffff',
  /** One step off the surface — recessive, hairline, solid, never dashed. */
  grid: '#d8e0da',
  axisText: '#5a6a62',
  /** Area washes sit at ~10% opacity: a wash, never a saturated block. */
  areaOpacity: 0.1,
  lineWidth: 2,
  markerRadius: 4,
  /** Bars are capped rather than filling their band; the leftover is air. */
  maxBarSize: 24,
} as const;

/** Recharts axis props shared by every chart, so tick styling cannot drift. */
export const AXIS_PROPS = {
  stroke: CHART.grid,
  tick: { fill: CHART.axisText, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: CHART.grid },
} as const;
