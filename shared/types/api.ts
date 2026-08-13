/**
 * Wire types.
 *
 * These mirror what the Express layer actually serialises — they are
 * transcribed from `backend/src/routes/*.js` and the presenters those routes
 * call, not from the prose in `docs/api/`, because where the two disagree the
 * code is what a browser receives.
 *
 * Nothing here is a display string: every farmer-facing word arrives as an
 * i18n key plus structured `data` (CLAUDE.md rule 8), so this file is full of
 * `*Key` fields and enum codes and contains no prose at all.
 */

// ── Envelope (docs/api/error-codes.md) ──────────────────────────────────────

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'AI_ERROR'
  | 'ML_ERROR'
  | 'UPLOAD_ERROR'
  | 'DATABASE_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  success: false;
  error: {
    code: ApiErrorCode;
    messageKey: string;
    details?: unknown[];
  };
  /** `errorHandler.js` stamps every failure with the correlation id. */
  meta?: { requestId?: string };
}

// ── Enumerations (backend/src/config/constants.js) ──────────────────────────

export const LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LAND_UNITS = ['acre', 'hectare', 'bigha'] as const;
export type LandUnit = (typeof LAND_UNITS)[number];

export const SOIL_TYPES = [
  'alluvial',
  'black',
  'red',
  'laterite',
  'sandy',
  'loamy',
  'clay',
  'unknown',
] as const;
export type SoilType = (typeof SOIL_TYPES)[number];

export const IRRIGATION_METHODS = [
  'canal',
  'borewell',
  'rainfed',
  'drip',
  'sprinkler',
  'unknown',
] as const;
export type IrrigationMethod = (typeof IRRIGATION_METHODS)[number];

export const LOCATION_SOURCES = ['gps', 'manual'] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

export const CROP_STATUSES = ['planned', 'active', 'harvested'] as const;
export type CropStatus = (typeof CROP_STATUSES)[number];

export const SEASONS = ['KHARIF', 'RABI', 'ZAID'] as const;
export type Season = (typeof SEASONS)[number];

export const SPREAD_RATES = ['NONE', 'SLOW', 'RAPID'] as const;
export type SpreadRate = (typeof SPREAD_RATES)[number];

export type SupportLevel = 'SPECIALIZED' | 'GENERAL' | 'LIMITED' | 'UNSUPPORTED';
export type GrowthStage = 'INITIAL' | 'DEVELOPMENT' | 'MID' | 'LATE';
export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FreshnessStatus = 'live' | 'cached' | 'historical' | 'pending';
export type HealthSource = 'ml' | 'gemini' | 'rules';
export type SeverityLevel = 'MILD' | 'MODERATE' | 'SEVERE' | 'NOT_ASSESSED';
export type MarketTrend = 'RISING' | 'FALLING' | 'STABLE';

export type IrrigationVerdict =
  | 'IRRIGATE_TODAY'
  | 'IRRIGATE_IN_N_DAYS'
  | 'WAIT_RAIN_EXPECTED'
  | 'NO_IRRIGATION_NEEDED'
  | 'MAINTAIN_WATER_LEVEL'
  | 'UNAVAILABLE';

export type WeatherRiskType =
  'HEAVY_RAIN' | 'HEAT' | 'FROST' | 'WIND' | 'HUMIDITY_DISEASE' | 'DRY_SPELL';

export const INDIA_BOUNDS = { minLat: 6, maxLat: 37.5, minLon: 68, maxLon: 97.5 } as const;

/** Per-user ceilings the API enforces; surfaced so forms can warn ahead of a 409. */
export const MAX_FARMS_PER_USER = 10;
export const MAX_ACTIVE_CROPS_PER_FARM = 12;

// ── Shared fragments ────────────────────────────────────────────────────────

export interface LocalizedName {
  en: string;
  hi: string;
}

export interface SourceRef {
  org: string;
  title: string;
  url?: string;
  field?: string;
  accessed?: string;
  confidence?: 'P' | 'S';
  note?: string;
}

/**
 * The honesty block that rides on every data-bearing response.
 *
 * The optional fields are not decoration — each is present on exactly one
 * family of endpoints, and the differences are real:
 *
 * - weather carries `fetchedAt` + `ageHours` + `staleWarning`, because a
 *   snapshot has a fetch time and the server decides when it is old enough to
 *   warn about (the 48h threshold lives in `WEATHER_STALE_WARNING_MS`);
 * - the pending weather branch carries `retryAfterSeconds` and a `reason`
 *   distinguishing "not fetched yet" from "cannot be fetched";
 * - market carries `latestDate` + `ageDays` instead of `fetchedAt`, because
 *   what matters is how old the newest *price* is, not when we last looked.
 */
export interface Freshness {
  status: FreshnessStatus;
  source: string | null;
  fetchedAt?: string | null;
  /** Weather. The server's own staleness verdict — authoritative over ours. */
  ageHours?: number;
  staleWarning?: boolean;
  /** Weather, pending branch only. */
  retryAfterSeconds?: number;
  reason?: 'awaiting_first_fetch' | 'no_coordinates';
  /** Market. */
  latestDate?: string | null;
  ageDays?: number;
}

/**
 * An engine trace step (R12). Steps are heterogeneous by design — each engine
 * names its own fields — so `WhyTrace` renders whatever numbers it is given
 * rather than a fixed schema it would have to keep in sync.
 */
export interface TraceStep {
  step: string;
  [field: string]: unknown;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  language: Language;
  units: { land: LandUnit };
  voiceEnabled: boolean;
  communityConsent: boolean;
  createdAt: string;
}

export interface SessionResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

// ── Farms ───────────────────────────────────────────────────────────────────

export interface FarmLocation {
  lat?: number;
  lon?: number;
  state: string;
  district: string;
  /** As the farmer wrote it. Optional, and free text — there is no canonical list. */
  village?: string;
  /**
   * `geocoded` is server-derived: coordinates looked up from the farmer's
   * district rather than measured on their device. A client never sends it.
   */
  source: LocationSource | 'geocoded';
}

export interface Farm {
  id: string;
  userId: string;
  name: string;
  /** Present on the list projection only — the detail route returns crops. */
  cropCount?: number;
  location: FarmLocation;
  sizeValue: number;
  sizeUnit: LandUnit;
  soilType: SoilType;
  irrigationMethod: IrrigationMethod;
  locationKey?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** What a create/update body may carry — server-derived fields excluded. */
export type FarmInput = Omit<
  Farm,
  'id' | 'userId' | 'locationKey' | 'cropCount' | 'createdAt' | 'updatedAt'
>;

// ── Crops ───────────────────────────────────────────────────────────────────

export interface StageResult {
  stage: GrowthStage | null;
  stageIndex: number | null;
  kc: number | null;
  daysSinceSowing: number | null;
  dayInStage: number | null;
  stageStartDay: number | null;
  stageEndDay: number | null;
  totalStageDays: number | null;
  harvestApproaching: boolean;
  hasVerdict: boolean;
  reasonCode: string;
  trace: TraceStep[];
}

export interface Crop {
  id: string;
  userId: string;
  farmId: string;
  cropCode: string;
  freeTextLabel?: string;
  variety?: string;
  sowingDate: string;
  areaValue?: number;
  areaUnit?: LandUnit;
  status: CropStatus;
  waterBalance: {
    depletionMm: number;
    lastComputedAt?: string;
    initialized: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

/** What `withStages()` adds on top of a stored crop. */
export interface CropWithStage extends Crop {
  registry: { supportLevel: SupportLevel; names: LocalizedName | null };
  stage: StageResult;
}

export interface CreateCropInput {
  cropCode: string;
  freeTextLabel?: string;
  sowingDate: string;
  variety?: string;
  areaValue?: number;
  areaUnit?: LandUnit;
}

// ── Crop registry ───────────────────────────────────────────────────────────

export interface RegistrySummary {
  cropCode: string;
  names: LocalizedName;
  supportLevel: SupportLevel;
  seasons: Season[];
  mlSupported: boolean;
}

export interface FertilizerDose {
  [nutrient: string]: unknown;
}

/**
 * The full registry document, served by `GET /registry/crops?code=`.
 * Only the fields the web client actually renders are typed; the rest of the
 * document is preserved but left opaque rather than half-described.
 */
export interface RegistryCrop {
  cropCode: string;
  names: LocalizedName;
  supportLevel: SupportLevel;
  seasons?: Season[];
  mlSupported?: boolean;
  kcStages?: { stage: GrowthStage; days: number; kc: number | null }[];
  diseases?: RegistryDisease[];
  dataGaps?: string[];
  [field: string]: unknown;
}

/**
 * A registry disease sub-document (`backend/src/models/CropRegistry.js`).
 *
 * `names.hi` is nullable and travels with `hiVerified` — a Hindi disease name
 * the registry does not carry stays null: a visible, queryable gap where a
 * fabricated translation would be an invisible lie. (The i18n disease *guidance*
 * strings are 408/408 in Hindi, pending human sign-off — see
 * `shared/i18n/hi/_verification.json`.)
 */
export interface RegistryDisease {
  code: string;
  names?: { en: string; hi: string | null; hiVerified?: boolean };
  symptoms?: string[];
  inspect?: string[];
  nextSteps?: string[];
  prevention?: string[];
  symptomTags?: string[];
  sourceRefs?: SourceRef[];
  expertThreshold?: number;
}

// ── Weather ─────────────────────────────────────────────────────────────────

export interface WeatherDay {
  date: string;
  tMinC: number | null;
  tMaxC: number | null;
  humidityPct: number | null;
  windKmh: number | null;
  rainMm: number | null;
  rainProbPct: number | null;
  et0Mm: number | null;
}

export interface WeatherRisk {
  type: WeatherRiskType;
  level: RiskLevel;
  daysAhead: number;
  date: string | null;
  thresholdSource: string;
  data: Record<string, unknown>;
  cropId: string;
  cropCode: string;
}

export interface FarmWeather {
  daily: WeatherDay[];
  risks: WeatherRisk[];
  freshness: Freshness;
}

// ── Irrigation ──────────────────────────────────────────────────────────────

export interface IrrigationAdvice {
  /**
   * Null when the engine declined to reach any verdict at all — a crop that is
   * not in the ground yet is the common case. `reasonCode` says why, and the
   * UI must not compose an i18n key out of a null.
   */
  verdict: IrrigationVerdict | null;
  hasVerdict: boolean;
  reasonCode: string;
  mode: 'full' | 'simplified' | null;
  amountMm: number | null;
  amountLitersPerAcre: number | null;
  days: number | null;
  targetDepthCm?: number;
  stage?: GrowthStage | null;
  kc?: number | null;
  depletionMm?: number;
  rawMm?: number;
  tawMm?: number;
  splitAdvised?: boolean;
  uncappedMm?: number;
  /**
   * True when the soil's available-water figure is a wide published range, so
   * the depletion arithmetic carries more uncertainty than the single number
   * suggests. The soil inputs themselves are not returned at the top level —
   * they are only in the `SOIL` trace step.
   */
  soilUncertaintyWide?: boolean;
  /** Days until the next check, on the `NO_IRRIGATION_NEEDED` branch. */
  nextCheckDays?: number;
  /** Set on the no-verdict branch taken when the crop is near harvest. */
  harvestApproaching?: boolean;
  rain?: { date: string; mm: number; probPct: number };
  trace: TraceStep[];
  freshness: Freshness;
}

export interface IrrigationLogEntry {
  id: string;
  date: string;
  amountMm: number | null;
  source: string;
}

// ── Fertilizer ──────────────────────────────────────────────────────────────

/**
 * Transcribed from `services/fertilizerService.js`. Only `stage` survived from
 * the earlier guess at this shape.
 *
 * `timing` and `note` are strings from the knowledge base rather than i18n
 * keys because they are quoted source text; `timingUnknown` marks an entry
 * whose published timing was too ambiguous to encode, and the UI has to say so
 * rather than render an empty slot.
 */
export interface FertilizerScheduleStep {
  stage: string;
  timing: string | null;
  fractionKey: string;
  note: string | null;
  window: { fromDay: number; toDay: number; basis: string } | null;
  isCurrent: boolean;
  timingUnknown: boolean;
}

export interface FertilizerRecommendation {
  varietyClass: string | null;
  basis: string;
  totalNpk: Record<string, unknown> | null;
  organics: Record<string, unknown> | null;
  micronutrients: Record<string, unknown> | null;
  schedule: FertilizerScheduleStep[];
  source: SourceRef;
}

export interface FertilizerGuidance {
  cropCode: string;
  names: LocalizedName | null;
  stage: GrowthStage | null;
  daysSinceSowing: number | null;
  disclaimerKey: string;
  covered: boolean;
  reasonKey?: string;
  guidanceTypeKey?: string;
  context?: unknown;
  verificationPending?: boolean;
  verificationNoteKey?: string | null;
  recommendations: FertilizerRecommendation[];
  deficiencySymptoms: unknown[];
  sources: SourceRef[];
  limitationsKey?: string;
  soilTestCtaKey?: string;
}

// ── Dashboard & feed ────────────────────────────────────────────────────────

/**
 * The stored `recommendations.type` enum, verbatim.
 *
 * Hyphenated, not snake-cased — transcribed from the Mongoose enum in
 * `backend/src/models/Recommendation.js` rather than guessed at, because a
 * near-miss here silently disables the per-type deep links in `FeedItemCard`
 * with nothing failing loudly.
 */
export type FeedType =
  | 'irrigation'
  | 'weather-risk'
  | 'health'
  | 'market'
  | 'fertilizer'
  | 'community'
  | 'crop-suggestion';

export interface FeedItem {
  id: string;
  type: FeedType;
  priority: Priority;
  source: string;
  titleKey: string;
  bodyKey: string;
  data: Record<string, unknown> & { trace?: TraceStep[] | Record<string, unknown> | null };
  confidence: number | null;
  farmId: string | null;
  cropId: string | null;
  validUntil: string;
  acknowledgedAt: string | null;
  createdAt: string;
}

export interface CropCard {
  cropId: string;
  farmId: string;
  cropCode: string;
  names: LocalizedName | null;
  stage: GrowthStage | null;
  stageReason: string;
  irrigationVerdict: IrrigationVerdict | null;
  healthFlag: string | null;
  marketSignal: MarketTrend | null;
  freshness: Freshness;
}

export interface DashboardResponse {
  onboarding?: { stepKey: string; ctaKey: string };
  feed: FeedItem[];
  cropCards: CropCard[];
  farmSummary: { farmCount: number; activeCropCount: number; districts: string[] };
  systemStatus: { weather: FreshnessStatus; market: FreshnessStatus; ml: string };
}

/** History rows carry no `confidence` — see `recommendationsRouter.get('/')`. */
export type RecommendationHistoryItem = Omit<FeedItem, 'confidence'>;

// ── Market ──────────────────────────────────────────────────────────────────

export interface MarketSignal {
  /**
   * Null when there were no observations to describe — a commodity with no
   * recent mandi reports has no trend, and inventing `STABLE` for it would be
   * a claim the data does not support.
   */
  trend: MarketTrend | null;
  changePct7d: number | null;
  changePct30d: number | null;
  momentumDiverges: boolean;
  guidanceKey: string;
  reasonCode: string;
  trace: TraceStep[];
}

export interface MarketPricePoint {
  date: string;
  market: string;
  minPrice: number;
  modalPrice: number;
  maxPrice: number;
  adjusted: boolean;
}

export interface PriceSeriesResponse {
  series: MarketPricePoint[];
  signal: MarketSignal;
  freshness: Freshness;
}

export interface MyCropSignal {
  cropCode: string;
  names: LocalizedName | null;
  commodityCode: string;
  state: string | null;
  district: string | null;
  cropIds: string[];
  signal: MarketSignal;
  freshness: Freshness;
}

// ── Crop health ─────────────────────────────────────────────────────────────

export interface HealthAnalysisSummary {
  source: HealthSource | null;
  sourceLabelKey: string | null;
  diseaseCode: string | null;
  confidence: number | null;
  severityAssessment: SeverityLevel | null;
  escalated: boolean;
}

/**
 * One attempt in the ml → gemini → openrouter → rules chain.
 *
 * Field names transcribed from what the conductor actually pushes
 * (`services/cropHealthService.js`, `services/aiVision.js`) and from the
 * schema that persists it (`models/CropHealthLog.js`). An earlier version of
 * this interface said `{tier, outcome}`, which no code path has ever emitted.
 */
export interface EscalationStep {
  provider: string;
  reason: string;
  /** Present when the tier failed with an HTTP status. */
  status?: number;
}

export interface HealthAnalysisFull extends HealthAnalysisSummary {
  modelVersion: string | null;
  /**
   * Ranked alternatives. Normalised to these names by
   * `integrations/mlService.js` before they are stored, so the rules tier and
   * the model tier agree — it is not `{code, prob}` on the wire.
   */
  top3: { diseaseCode: string; confidence: number }[];
  escalationPath: EscalationStep[];
}

export interface HealthRecommendationData {
  diseaseCode: string;
  source: HealthSource;
  confidenceKind: string;
  confidenceBand: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  severity: SeverityLevel;
  severityPolicy: string;
  escalated: boolean;
  symptomKeys: string[];
  inspectKeys: string[];
  nextStepKeys: string[];
  preventionKeys: string[];
  sourceRefs: SourceRef[];
  /** Free English model text. Rendered under its own attributed heading. */
  aiObservations: string[];
  imageAssessment: string | null;
  supportLevel: SupportLevel | null;
  severityTrace: TraceStep[];
  /** The AI tier's visual severity estimate, retained for the follow-up re-run. */
  severityVisual?: string | null;
  generatedAt: string;
}

export interface HealthLogSummary {
  id: string;
  cropId: string;
  imageUrl: string;
  description: string | null;
  status: string;
  sharedToCommunity: boolean;
  createdAt: string;
  analysis: HealthAnalysisSummary;
}

export interface HealthLog extends HealthLogSummary {
  analysis: HealthAnalysisFull;
  recommendation: { titleKey: string; data: Partial<HealthRecommendationData> };
  severityFollowUp: {
    affectedAreaPct: number | null;
    spreadRate: SpreadRate | null;
    answeredAt: string;
  } | null;
  coverageNoticeKey: string | null;
  freshness: Freshness;
}

export interface SeverityResponse {
  level: SeverityLevel;
  escalate: boolean;
  policy: string;
  reasonCode: string;
  trace: TraceStep[];
  answers: { affectedAreaPct: number | null; spreadRate: SpreadRate | null };
}

export interface SymptomAnswers {
  part?: string;
  pattern?: string;
  color?: string;
  distribution?: string;
  spread?: SpreadRate;
}

/**
 * Transcribed from `engines/symptom/symptomEngine.js`. The previous shape
 * (`score`, `matchedAxes`, `names`) matched nothing the engine returns; the
 * index signature that used to sit here hid the mismatch from the compiler,
 * so a screen reading `candidate.score` type-checked and rendered undefined.
 */
export interface SymptomCandidate {
  diseaseCode: string;
  matchScore: number;
  band: 'LIKELY' | 'POSSIBLE';
  matchedTags: string[];
  symptomKeys: string[];
  inspectKeys: string[];
  nextStepKeys: string[];
  preventionKeys: string[];
  sourceRefs: SourceRef[];
  expertThreshold: number;
}

export interface SymptomCheckResponse {
  candidates: SymptomCandidate[];
  guidance: {
    hasVerdict: boolean;
    reasonCode: string;
    expertReferral: boolean;
    expertReferralReasons: string[];
    sourceLabelKey: string;
    coverageNoticeKey: string | null;
    answeredAxes: string[];
    weatherTags: string[];
  };
  trace: TraceStep[];
}

// ── Crop recommendation ─────────────────────────────────────────────────────

export interface CropRecReason {
  key: string;
  field: string;
  data: Record<string, unknown>;
}

export interface CropRecCaution {
  key: string;
  data?: Record<string, unknown>;
}

export interface CropRecItem {
  cropCode: string;
  names: LocalizedName | null;
  supportLevel: SupportLevel;
  score: number;
  evidenceRatio: number;
  reasons: CropRecReason[];
  cautions: CropRecCaution[];
  sources: SourceRef[];
  factors: Record<string, unknown>;
}

export interface CropRecExclusion {
  cropCode: string;
  names: LocalizedName | null;
  reason: string;
  reasonKey: string;
  data: Record<string, unknown>;
}

export interface CropRecResponse {
  recommendations: CropRecItem[];
  excluded: CropRecExclusion[];
  limitations: { key: string; data?: Record<string, unknown> }[];
  trace: TraceStep[];
  request: { farmId: string; season: Season; preference: string | null };
}

// ── Community ───────────────────────────────────────────────────────────────

export interface CommunityAlert {
  district: string;
  state: string;
  cropCode: string;
  diseaseCode: string;
  reportCount: number;
  level: 'INFO' | 'HIGH';
  windowStart: string;
  windowEnd: string;
}

// ── Nearby mandis ───────────────────────────────────────────────────────────

/**
 * How near a mandi is, expressed only as the data supports.
 *
 * Agmarknet publishes no mandi coordinates, so there is no distance to show.
 * A kilometre figure would have to be invented, which the product forbids.
 */
export type MandiProximity = 'SAME_DISTRICT' | 'SAME_STATE';

export interface MandiCommodity {
  commodityCode: string;
  minPrice: number;
  maxPrice: number;
  modalPrice: number;
  unit: string | null;
  date: string;
  source: string;
}

/** One mandi and everything it actually trades — a mandi is not a crop. */
export interface NearbyMandi {
  market: string;
  district: string | null;
  state: string;
  proximity: MandiProximity;
  commodities: MandiCommodity[];
}

export interface NearbyMandisResponse {
  scope: { state: string | null; district: string | null; days: number };
  mandis: NearbyMandi[];
  availableCommodities: string[];
  counts: { mandis: number; inDistrict: number; commodities: number };
  freshness: Freshness;
}
