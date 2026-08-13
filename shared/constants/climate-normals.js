/**
 * District climate normals for the crop-recommendation engine.
 *
 * docs/crop-recommendation/engine.md:31, verbatim:
 *   "District rainfall/temperature normals: small constant table in
 *    `shared/constants/climate-normals` for demo states [DECISION REQUIRED:
 *    which 2–3 demo states — recommend MP, Maharashtra, UP]."
 *
 * ── THIS TABLE IS DELIBERATELY EMPTY ─────────────────────────────────────────
 *
 * The repository contains **zero** climate-normal values. The only rainfall
 * figures anywhere in it are per-crop seasonal water *needs* from FAO Chapter 3
 * (`crops.base.json` → `waterNeedMm`), which are a different quantity entirely:
 * what a crop consumes, not what a district receives. `crops.base.json` records
 * the sourcing task as still open — "Demo-state rainfall normals table sourced
 * (IMD normals)" — and it has not been done.
 *
 * Populating this file with plausible numbers would fabricate the single input
 * that decides whether a farmer is told to plant a crop their rainfall cannot
 * support. CLAUDE.md rule 7 forbids exactly that, so the table stays empty and
 * the engine degrades honestly: any scoring factor that needs a normal is
 * reported as `MISSING_EVIDENCE`, excluded from the weighted score, and named
 * in the response's `limitations` so the farmer can see what was not considered.
 *
 * Two things are needed to fill it, and both are external:
 *   1. **OD-7** — which demo states. The spec recommends MP / Maharashtra / UP;
 *      the golden cases in engine.md:34 instead name Nagpur (MH), Raipur (CG)
 *      and "Punjab-like", so the two lists disagree and someone must choose.
 *   2. **A sourced IMD normals extract** for whichever districts result —
 *      seasonal rainfall (mm) and seasonal mean min/max temperature (°C).
 *      `DATAGOVIN_API_KEY` (open decision OD-5) would make this fetchable.
 *
 * The shape below is the contract the engine reads, so populating this file is
 * the only change needed once the data exists — no engine change.
 */

/**
 * @typedef {object} SeasonNormal
 * @property {number} rainfallMm            seasonal total, mm
 * @property {number} tMinC                 seasonal mean daily minimum, °C
 * @property {number} tMaxC                 seasonal mean daily maximum, °C
 * @property {object} sourceRef             {org, title, url, accessed, confidence}
 */

/**
 * Keyed `"<STATE>|<DISTRICT>"`, upper-cased, then by season.
 * @type {Record<string, Partial<Record<'KHARIF'|'RABI'|'ZAID', SeasonNormal>>>}
 */
export const DISTRICT_CLIMATE_NORMALS = Object.freeze({});

/** Same shape, used when a district has no entry but its state does. */
export const STATE_CLIMATE_NORMALS = Object.freeze({});

export const climateKey = (state, district) =>
  `${String(state ?? '')
    .trim()
    .toUpperCase()}|${String(district ?? '')
    .trim()
    .toUpperCase()}`;

/**
 * Looks a normal up, district first then state.
 * @returns {SeasonNormal|null} null means "not sourced", never "zero rainfall".
 */
export function lookupNormal({ state, district, season }) {
  if (!season) return null;
  const byDistrict = DISTRICT_CLIMATE_NORMALS[climateKey(state, district)];
  if (byDistrict?.[season]) return byDistrict[season];

  const byState =
    STATE_CLIMATE_NORMALS[
      String(state ?? '')
        .trim()
        .toUpperCase()
    ];
  return byState?.[season] ?? null;
}

/** True while the table is unpopulated — surfaced by the engine, not hidden. */
export const CLIMATE_NORMALS_AVAILABLE =
  Object.keys(DISTRICT_CLIMATE_NORMALS).length > 0 || Object.keys(STATE_CLIMATE_NORMALS).length > 0;
