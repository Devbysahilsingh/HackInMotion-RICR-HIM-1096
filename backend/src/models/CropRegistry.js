import { Schema, model } from 'mongoose';

import { GROWTH_STAGES, SEASONS, SOIL_TYPES, SUPPORT_LEVELS } from '../config/constants.js';
import { baseOptions, localizedNameSchema, sourceRefSchema } from './shared.js';

/**
 * The crop knowledge base (ADR-004).
 *
 * Engines read this and nothing else — `if (cropCode === 'TOMATO')` is banned,
 * so anything an engine needs to vary per crop has to be a field here. That is
 * why fields the older "authoritative shape" omits (tempOpt, durationDays,
 * droughtSensitivity, paddyFlooding, simplifiedIntervals) are present: the
 * crop-rec and irrigation engines name them in their input contracts.
 *
 * Disease and fertilizer knowledge are embedded rather than separate
 * collections because they are always fetched with the crop and never queried
 * independently; revisit only past ~100 crops (docs/database/schema.md).
 */

const kcStageSchema = new Schema(
  {
    stage: { type: String, enum: GROWTH_STAGES, required: true },
    days: { type: Number, required: true, min: 1 },
    /**
     * Null through DEVELOPMENT: FAO-56 publishes Kc for initial, mid and end
     * only, and the development stage is defined as the linear transition
     * between them. Storing a fabricated midpoint would invent a number.
     */
    kc: { type: Number, default: null, min: 0, max: 2 },
    /**
     * Plural: a single stage routinely needs two citations, because FAO-56
     * publishes stage lengths (Table 11) and Kc values (Table 12) separately.
     * Collapsing them to one would drop half the provenance.
     */
    sourceRefs: { type: [sourceRefSchema], default: [] },
  },
  { _id: false },
);

/**
 * Disease names, deliberately NOT `localizedNameSchema`.
 *
 * That schema requires both languages, which is right for a crop name — those
 * came from a bilingual Government of India document. Disease names did not:
 * the sourced KB is TNAU/ICAR/NIPHM extension material published in English,
 * and CLAUDE.md rule 8 forbids translating agronomic terms without human
 * verification. Requiring `hi` here would leave exactly two options, both bad —
 * drop the entire disease KB, or invent Hindi disease names.
 *
 * So `hi` is nullable and `hiVerified` travels with it. A null is a visible,
 * queryable gap that the seed prints and `dataGaps` records; a fabricated
 * translation would be invisible and wrong. ADR-021 already gates cotton's
 * *ship* on bilingual KB entries, and that gate now has something to read.
 */
const diseaseNameSchema = new Schema(
  {
    en: { type: String, required: true, trim: true },
    hi: { type: String, default: null, trim: true },
    hiVerified: { type: Boolean, default: false },
  },
  { _id: false },
);

const diseaseSchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    names: { type: diseaseNameSchema, required: true },
    /** i18n key arrays — the API never returns display prose. */
    symptoms: { type: [String], default: [] },
    inspect: { type: [String], default: [] },
    nextSteps: { type: [String], default: [] },
    prevention: { type: [String], default: [] },
    /**
     * Feature tags consumed by the rule-based symptom engine's weighted match
     * (docs/ai/fallback-strategy.md). Absent until the KB is authored.
     */
    symptomTags: { type: [String], default: [] },
    /** Below this match score the farmer is routed to a human expert. */
    expertThreshold: { type: Number, min: 0, max: 1, default: 0.4 },
    sourceRefs: { type: [sourceRefSchema], default: [] },
  },
  { _id: false },
);

const fertilizerRecommendationSchema = new Schema(
  {
    source: { type: sourceRefSchema, required: true },
    /**
     * Which variety class the published dose applies to — "short_duration",
     * "hybrid", "varieties" and so on, exactly as the source labels its rows.
     *
     * Missing until P2-8, which meant Mongoose stripped it during the seed and
     * the guidance endpoint could only ever emit `null`. TNAU publishes three
     * distinct rice doses (120–150 / 150 / 175 kg N per hectare) and two cotton
     * doses, so without this field a farmer saw an unlabelled list of doses
     * with nothing to say which row was theirs — the single most consequential
     * ambiguity this surface can produce.
     */
    varietyClass: { type: String },
    basis: {
      type: String,
      enum: ['blanket_no_soil_test', 'stcr_soil_test'],
      required: true,
    },
    /**
     * Doses are published in several shapes (single figure, variety/hybrid
     * split, range), so the parsed numbers travel with their published text.
     * `unit` is preserved exactly as printed — kg/ha and kg/acre both occur,
     * and silently normalising them would change the dose a farmer applies.
     */
    totalNpk: { type: Schema.Types.Mixed },
    /**
     * Free-form because published recommendations vary in structure — some
     * give a single figure, others a per-nutrient breakdown, and several print
     * a quantity with no unit at all. The knowledge files keep the published
     * text alongside any parsed value, and flattening that to a string here
     * would throw away exactly the provenance the fertilizer rules require.
     */
    organics: { type: Schema.Types.Mixed },
    micronutrients: { type: Schema.Types.Mixed },
    schedule: {
      type: [
        new Schema(
          {
            stage: { type: String },
            timing: { type: String },
            fractionKey: { type: String },
            note: { type: String },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { _id: false },
);

const cropRegistrySchema = new Schema(
  {
    /** Uniqueness declared once, as a named index below. */
    cropCode: { type: String, required: true, uppercase: true, trim: true },
    names: { type: localizedNameSchema, required: true },
    /** Alternative and regional names, reused by the voice keyword matcher. */
    altNames: { type: [String], default: [] },

    supportLevel: { type: String, enum: SUPPORT_LEVELS, required: true },

    seasons: { type: [{ type: String, enum: SEASONS }], default: [] },

    /** [min, max] mm per season. */
    waterNeedMm: {
      type: [Number],
      validate: {
        validator: (v) => v == null || v.length === 0 || v.length === 2,
        message: 'waterNeedMm must be a [min, max] pair',
      },
    },

    /** 0–3 suitability per soil type. Absent keys mean "not sourced", not zero. */
    soilSuitability: {
      type: Map,
      of: { type: Number, min: 0, max: 3 },
      default: undefined,
    },

    tempOpt: { min: { type: Number }, max: { type: Number } },
    durationDays: { min: { type: Number }, max: { type: Number } },
    droughtSensitivity: {
      type: String,
      enum: ['LOW', 'LOW_MED', 'MEDIUM', 'MED_HIGH', 'HIGH'],
    },

    // ── Irrigation engine inputs (docs/irrigation/calculation-rules.md) ────
    kcStages: { type: [kcStageSchema], default: [] },
    rootDepthM: { type: Number, min: 0 },
    depletionFraction: { type: Number, min: 0, max: 1 },
    /** Rice: verdicts become standing-water guidance rather than depletion. */
    paddyFlooding: { type: Boolean, default: false },
    /** Fallback interval table used when ET₀ is unavailable (simplified mode). */
    simplifiedIntervals: {
      type: [
        new Schema(
          {
            stage: { type: String, enum: GROWTH_STAGES },
            intervalDays: { type: Number, min: 1 },
            sourceRef: { type: sourceRefSchema },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    /** Weather-risk thresholds; engine defaults apply where absent. */
    sensitivity: {
      frostTminC: { type: Number },
      heatTmaxC: { type: Number },
      heavyRainMm24h: { type: Number },
      humidityDiseasePct: { type: Number },
      highWindKmh: { type: Number },
    },

    mlSupported: { type: Boolean, required: true, default: false },
    /** Sourced from datasets/manifest.json — the classes that actually have data. */
    mlClassCodes: { type: [String], default: [] },

    diseases: { type: [diseaseSchema], default: [] },

    fertilizer: {
      context: {
        region: { type: String },
        condition: { type: String },
        varietyClass: { type: String },
      },
      recommendations: { type: [fertilizerRecommendationSchema], default: [] },
      deficiencySymptoms: {
        type: [
          new Schema(
            {
              nutrient: { type: String },
              symptomKey: { type: String },
              sourceUrl: { type: String },
            },
            { _id: false },
          ),
        ],
        default: [],
      },
      /** True where a published number still needs primary-PDF verification. */
      verificationPending: { type: Boolean, default: false },
    },

    market: {
      commodityCode: { type: String, uppercase: true, trim: true },
      aliases: { type: [String], default: [] },
      /** Storage caution surfaced for perishables (tomato, onion). */
      perishabilityKey: { type: String },
    },

    yield: { apyCropName: { type: String } },

    /** Agronomic references that apply to the document as a whole. */
    sourceRefs: { type: [sourceRefSchema], default: [] },

    /**
     * Stamped by the seed so a served document can self-report its provenance;
     * seedMeta records the run, this records the document.
     */
    seedVersion: { type: String },

    /** Fields deliberately absent because no credible source was found. */
    dataGaps: { type: [String], default: [] },
  },
  baseOptions('cropRegistry'),
);

cropRegistrySchema.index({ cropCode: 1 }, { unique: true, name: 'cropCode_unique' });

/** Summary projection served by the public list endpoint. */
cropRegistrySchema.methods.toSummaryJSON = function toSummaryJSON() {
  return {
    cropCode: this.cropCode,
    names: { en: this.names.en, hi: this.names.hi },
    supportLevel: this.supportLevel,
    seasons: this.seasons,
  };
};

export const CropRegistry = model('CropRegistry', cropRegistrySchema);
export { SOIL_TYPES };
