/**
 * Schema fragments reused across models.
 *
 * Collection names are set explicitly on every model rather than left to
 * Mongoose's pluraliser: the names in docs/database/schema.md are the contract
 * that seed scripts, index assertions and Atlas dashboards all share, and
 * `cropRegistry` would otherwise become `cropregistries`.
 */
import { Schema } from 'mongoose';

/**
 * Provenance for any sourced value.
 *
 * The docs use two idioms — a bare `sourceRef` on agronomic fields and a
 * `source{org,title,url,accessed}` object in the fertilizer KB. This one shape
 * satisfies both, and `confidence` carries the P/S grading the crop-rec
 * scoring model defines (P = primary/government verified, S = secondary).
 */
export const sourceRefSchema = new Schema(
  {
    org: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    /**
     * Optional because some references are to documents inside this repository
     * (a curated terminology table, a decision record), which have a path
     * rather than a URL. The fertilizer KB's stricter rule — "no number
     * without source.url" — is enforced in that data, not by this schema,
     * which also carries non-numeric provenance such as crop names.
     */
    url: { type: String, trim: true },
    /** Which registry field this reference justifies, where it is per-field. */
    field: { type: String, trim: true },
    accessed: { type: String, trim: true },
    confidence: { type: String, enum: ['P', 'S'] },
    note: { type: String, trim: true },
  },
  { _id: false },
);

/** Bilingual label. `hi` is required so no surface can fall back silently. */
export const localizedNameSchema = new Schema(
  {
    en: { type: String, required: true, trim: true },
    hi: { type: String, required: true, trim: true },
  },
  { _id: false },
);

/**
 * Applied to every model. `versionKey` stays on (optimistic concurrency is the
 * only collision control available — ADR-002 rules out transactions), and the
 * default `toJSON` is replaced so `_id`/`__v` never reach a client verbatim.
 */
export const baseOptions = (collection) => ({
  collection,
  timestamps: true,
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform(doc, ret) {
      ret.id = ret._id?.toString();
      delete ret._id;
      return ret;
    },
  },
});
