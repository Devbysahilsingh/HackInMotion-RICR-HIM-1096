/**
 * API fixtures.
 *
 * Every object here is shaped exactly as `backend/src/routes/*.js` serialises
 * it — a fixture that drifts from the wire contract makes green tests that
 * prove nothing. The health fixtures cover the four documented result branches
 * (confident · uncertain · unusable photo · healthy) because those are the
 * branches the result page is required to render differently.
 */
import type {
  CommunityAlert,
  CropRecResponse,
  CropWithStage,
  DashboardResponse,
  Farm,
  FarmWeather,
  FertilizerGuidance,
  HealthLog,
  IrrigationAdvice,
  MyCropSignal,
  PriceSeriesResponse,
  RegistrySummary,
  SessionResponse,
  SymptomCheckResponse,
  User,
} from '@/api/types';

const iso = (offsetDays: number): string =>
  new Date(Date.UTC(2026, 7, 13, 6, 0, 0) + offsetDays * 86_400_000).toISOString();

export const user: User = {
  id: '66b0000000000000000000a1',
  name: 'Demo Farmer',
  email: 'demo@example.com',
  language: 'en',
  units: { land: 'acre' },
  voiceEnabled: false,
  communityConsent: true,
  createdAt: iso(-30),
};

export const session: SessionResponse = {
  user,
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
};

export const farm: Farm = {
  id: '66b0000000000000000000b1',
  userId: user.id,
  name: 'North field',
  location: { lat: 19.99, lon: 73.79, state: 'Maharashtra', district: 'Nashik', source: 'gps' },
  sizeValue: 2.5,
  sizeUnit: 'acre',
  soilType: 'black',
  irrigationMethod: 'drip',
  locationKey: '20.0_73.8',
  createdAt: iso(-20),
  updatedAt: iso(-20),
};

export const crop: CropWithStage = {
  id: '66b0000000000000000000c1',
  userId: user.id,
  farmId: farm.id,
  cropCode: 'TOMATO',
  sowingDate: iso(-45),
  variety: 'Pusa Ruby',
  areaValue: 1,
  areaUnit: 'acre',
  status: 'active',
  waterBalance: { depletionMm: 18.4, lastComputedAt: iso(0), initialized: true },
  createdAt: iso(-45),
  updatedAt: iso(-1),
  registry: { supportLevel: 'SPECIALIZED', names: { en: 'Tomato', hi: 'टमाटर' } },
  stage: {
    stage: 'MID',
    stageIndex: 2,
    kc: 1.15,
    daysSinceSowing: 45,
    dayInStage: 5,
    stageStartDay: 40,
    stageEndDay: 80,
    totalStageDays: 125,
    harvestApproaching: false,
    hasVerdict: true,
    reasonCode: 'STAGE_DERIVED',
    trace: [{ step: 'INPUT', sowingDate: iso(-45), status: 'active' }],
  },
};

export const registryCrops: RegistrySummary[] = [
  {
    cropCode: 'TOMATO',
    names: { en: 'Tomato', hi: 'टमाटर' },
    supportLevel: 'SPECIALIZED',
    seasons: ['KHARIF', 'RABI'],
    mlSupported: true,
  },
  {
    cropCode: 'RICE',
    names: { en: 'Rice', hi: 'धान' },
    supportLevel: 'GENERAL',
    seasons: ['KHARIF'],
    mlSupported: true,
  },
];

export const dashboard: DashboardResponse = {
  feed: [
    {
      id: '66b0000000000000000000d1',
      type: 'irrigation',
      priority: 'HIGH',
      source: 'engine',
      titleKey: 'irrigation.titleIRRIGATE_TODAY',
      bodyKey: 'irrigation.bodyIRRIGATE_TODAY',
      data: {
        verdict: 'IRRIGATE_TODAY',
        amountMm: 25,
        amountLitersPerAcre: 101_171,
        trace: [
          { step: 'INPUT', soilType: 'black', weatherDays: 14 },
          { step: 'RESERVOIR', tawMm: 92.4, rawMm: 36.9, p: 0.4 },
          { step: 'VERDICT', verdict: 'IRRIGATE_TODAY', depletionMm: 38.2 },
        ],
      },
      confidence: null,
      farmId: farm.id,
      cropId: crop.id,
      validUntil: iso(1),
      acknowledgedAt: null,
      createdAt: iso(0),
    },
    {
      id: '66b0000000000000000000d2',
      type: 'weather-risk',
      priority: 'CRITICAL',
      source: 'engine',
      titleKey: 'weather.titleHEAVY_RAIN',
      bodyKey: 'weather.bodyHEAVY_RAIN',
      data: { rainMm: 82, rainProbPct: 90, trace: [{ step: 'THRESHOLDS', heavyRainMm24h: 65 }] },
      confidence: null,
      farmId: farm.id,
      cropId: crop.id,
      validUntil: iso(2),
      acknowledgedAt: null,
      createdAt: iso(0),
    },
  ],
  cropCards: [
    {
      cropId: crop.id,
      farmId: farm.id,
      cropCode: 'TOMATO',
      names: { en: 'Tomato', hi: 'टमाटर' },
      stage: 'MID',
      stageReason: 'STAGE_DERIVED',
      irrigationVerdict: 'IRRIGATE_TODAY',
      healthFlag: null,
      marketSignal: 'RISING',
      freshness: { status: 'live', source: 'open-meteo', fetchedAt: iso(0) },
    },
  ],
  farmSummary: { farmCount: 1, activeCropCount: 1, districts: ['Nashik'] },
  systemStatus: { weather: 'live', market: 'cached', ml: 'up' },
};

/** The designed no-farms payload — not an empty feed. */
export const onboardingDashboard: DashboardResponse = {
  onboarding: { stepKey: 'farm.onboardingCreateFarm', ctaKey: 'farm.onboardingCreateFarmCta' },
  feed: [],
  cropCards: [],
  farmSummary: { farmCount: 0, activeCropCount: 0, districts: [] },
  systemStatus: { weather: 'pending', market: 'pending', ml: 'down' },
};

export const farmWeather: FarmWeather = {
  daily: Array.from({ length: 7 }, (_, index) => ({
    date: iso(index),
    tMinC: 21 + index * 0.2,
    tMaxC: 33 + index * 0.3,
    humidityPct: 70,
    windKmh: 11,
    rainMm: index === 2 ? 82 : 1.2,
    rainProbPct: index === 2 ? 90 : 20,
    et0Mm: 5.1,
  })),
  risks: [
    {
      type: 'HEAVY_RAIN',
      level: 'HIGH',
      daysAhead: 2,
      date: iso(2),
      thresholdSource: 'registry',
      data: { rainMm: 82, rainProbPct: 90, thresholdMm: 65 },
      cropId: crop.id,
      cropCode: 'TOMATO',
    },
  ],
  freshness: { status: 'live', source: 'open-meteo', fetchedAt: iso(0) },
};

export const pendingWeather: FarmWeather = {
  daily: [],
  risks: [],
  freshness: {
    status: 'pending',
    source: null,
    fetchedAt: null,
    retryAfterSeconds: 180,
    reason: 'awaiting_first_fetch',
  },
};

export const irrigationAdvice: IrrigationAdvice = {
  verdict: 'IRRIGATE_TODAY',
  hasVerdict: true,
  reasonCode: 'OK',
  mode: 'full',
  amountMm: 40,
  amountLitersPerAcre: 161_874,
  days: 0,
  stage: 'MID',
  kc: 1.15,
  depletionMm: 38.2,
  rawMm: 36.9,
  tawMm: 92.4,
  splitAdvised: false,
  soil: { soilType: 'black', awcMmPerM: 200, published: true, basis: 'FAO-56 Table 19' },
  trace: [
    { step: 'INPUT', soilType: 'black', weatherDays: 14, logCount: 2 },
    { step: 'RESERVOIR', tawMm: 92.4, rawMm: 36.9, p: 0.4 },
    { step: 'VERDICT', verdict: 'IRRIGATE_TODAY', depletionMm: 38.2, amountMm: 40 },
  ],
  freshness: { status: 'live', source: 'open-meteo', fetchedAt: iso(0) },
};

export const fertilizerGuidance: FertilizerGuidance = {
  cropCode: 'TOMATO',
  names: { en: 'Tomato', hi: 'टमाटर' },
  stage: 'MID',
  daysSinceSowing: 45,
  disclaimerKey: 'fertilizer.disclaimerGeneral',
  covered: true,
  guidanceTypeKey: 'fertilizer.typeGeneralNoSoilTest',
  verificationPending: false,
  verificationNoteKey: null,
  recommendations: [
    {
      varietyClass: 'hybrid',
      basis: 'blanket_no_soil_test',
      totalNpk: { N: '200 kg/ha', P: '250 kg/ha', K: '200 kg/ha' },
      organics: { FYM: '25 t/ha' },
      micronutrients: null,
      schedule: [
        { labelKey: 'fertilizer.schedule.basal.fullNpkPlusOrganicsAndMicronutrients', due: false },
        { labelKey: 'fertilizer.schedule.topdress.halfNitrogen', due: true },
      ],
      source: { org: 'TNAU', title: 'Crop production guide — tomato', url: 'https://agritech.tnau.ac.in/' },
    },
  ],
  deficiencySymptoms: [],
  sources: [
    { org: 'TNAU', title: 'Crop production guide — tomato', url: 'https://agritech.tnau.ac.in/' },
  ],
  limitationsKey: 'fertilizer.limitations',
  soilTestCtaKey: 'fertilizer.soilTestCta',
};

// ── Crop-health branches ────────────────────────────────────────────────────

const baseLog = {
  id: '66b0000000000000000000e1',
  cropId: crop.id,
  imageUrl: 'https://res.cloudinary.test/him1096/demo.jpg',
  description: 'Yellow patches on lower leaves',
  status: 'analyzed',
  sharedToCommunity: false,
  createdAt: iso(0),
  severityFollowUp: null,
  coverageNoticeKey: null,
  freshness: { status: 'live' as const, source: 'ml', fetchedAt: iso(0) },
};

/** Branch 1 — a named condition, calibrated confidence, full KB guidance. */
export const confidentLog: HealthLog = {
  ...baseLog,
  analysis: {
    source: 'ml',
    sourceLabelKey: 'health.sourceLocalAi',
    diseaseCode: 'TOMATO_EARLY_BLIGHT',
    confidence: 0.91,
    severityAssessment: 'MODERATE',
    escalated: false,
    modelVersion: 'model-v1.0',
    top3: [
      { code: 'TOMATO_EARLY_BLIGHT', prob: 0.91 },
      { code: 'TOMATO_LATE_BLIGHT', prob: 0.05 },
      { code: 'TOMATO_SEPTORIA_LEAF_SPOT', prob: 0.02 },
    ],
    escalationPath: [{ tier: 'ml', outcome: 'answered', reasonCode: 'CONFIDENT' }],
  },
  recommendation: {
    titleKey: 'health.titleMl',
    data: {
      diseaseCode: 'TOMATO_EARLY_BLIGHT',
      source: 'ml',
      confidenceKind: 'CALIBRATED',
      confidenceBand: null,
      severity: 'MODERATE',
      severityPolicy: 'ENGINE_ASSESSED',
      escalated: false,
      symptomKeys: ['disease.TOMATO_EARLY_BLIGHT.symptom.1'],
      inspectKeys: ['disease.TOMATO_EARLY_BLIGHT.inspect.1'],
      nextStepKeys: ['disease.TOMATO_EARLY_BLIGHT.nextStep.1'],
      preventionKeys: ['disease.TOMATO_EARLY_BLIGHT.prevention.1'],
      sourceRefs: [{ org: 'TNAU', title: 'Tomato early blight', url: 'https://agritech.tnau.ac.in/' }],
      aiObservations: [],
      imageAssessment: 'OK',
      supportLevel: 'SPECIALIZED',
      severityTrace: [{ step: 'SEVERITY', severityVisual: 'MODERATE', affectedAreaPct: null }],
      generatedAt: iso(0),
    },
  },
};

/** Branch 2 — no tier could name it. An outcome, not a failure. */
export const uncertainLog: HealthLog = {
  ...baseLog,
  id: '66b0000000000000000000e2',
  analysis: {
    source: 'rules',
    sourceLabelKey: 'health.sourceGuided',
    diseaseCode: 'UNKNOWN',
    confidence: 0.31,
    severityAssessment: 'NOT_ASSESSED',
    escalated: true,
    modelVersion: 'model-v1.0',
    top3: [],
    escalationPath: [
      { tier: 'ml', outcome: 'declined', reasonCode: 'BELOW_TAU' },
      { tier: 'gemini', outcome: 'declined', reasonCode: 'NOT_CONFIGURED' },
      { tier: 'rules', outcome: 'declined', reasonCode: 'NO_SYMPTOMS_ANSWERED' },
    ],
  },
  recommendation: {
    titleKey: 'health.titleUnknown',
    data: {
      diseaseCode: 'UNKNOWN',
      source: 'rules',
      confidenceKind: 'MATCH_SCORE',
      confidenceBand: 'LOW',
      severity: 'NOT_ASSESSED',
      severityPolicy: 'NOT_ASSESSABLE',
      escalated: true,
      symptomKeys: [],
      inspectKeys: [],
      nextStepKeys: [],
      preventionKeys: [],
      sourceRefs: [],
      aiObservations: [],
      imageAssessment: 'OK',
      supportLevel: 'SPECIALIZED',
      severityTrace: [],
      generatedAt: iso(0),
    },
  },
};

/** Branch 3 — the photo itself was unusable. */
export const unusablePhotoLog: HealthLog = {
  ...uncertainLog,
  id: '66b0000000000000000000e3',
  analysis: {
    ...uncertainLog.analysis,
    source: 'gemini',
    sourceLabelKey: 'health.sourceAiAssisted',
  },
  recommendation: {
    titleKey: 'health.titleUnknown',
    data: {
      ...uncertainLog.recommendation.data,
      source: 'gemini',
      confidenceKind: 'BAND',
      imageAssessment: 'NOT_A_PLANT',
      aiObservations: ['The image appears to show a plastic sheet rather than plant tissue.'],
    },
  },
};

/** Branch 4 — a named healthy class. A verdict in its own right. */
export const healthyLog: HealthLog = {
  ...confidentLog,
  id: '66b0000000000000000000e4',
  analysis: {
    ...confidentLog.analysis,
    diseaseCode: 'TOMATO_HEALTHY',
    confidence: 0.96,
    severityAssessment: 'NOT_ASSESSED',
  },
  recommendation: {
    titleKey: 'health.titleMl',
    data: {
      ...confidentLog.recommendation.data,
      diseaseCode: 'TOMATO_HEALTHY',
      severity: 'NOT_ASSESSED',
      symptomKeys: [],
      inspectKeys: [],
      nextStepKeys: [],
      preventionKeys: ['disease.TOMATO_HEALTHY.prevention.1'],
    },
  },
};

export const symptomCheck: SymptomCheckResponse = {
  candidates: [
    { diseaseCode: 'TOMATO_EARLY_BLIGHT', score: 0.72, band: 'LIKELY' },
    { diseaseCode: 'TOMATO_SEPTORIA_LEAF_SPOT', score: 0.48, band: 'POSSIBLE' },
  ],
  guidance: {
    hasVerdict: true,
    reasonCode: 'OK',
    expertReferral: false,
    expertReferralReasons: [],
    sourceLabelKey: 'health.sourceGuided',
    coverageNoticeKey: null,
    answeredAxes: ['part', 'pattern', 'color'],
    weatherTags: ['weather:HIGH_HUMIDITY'],
  },
  trace: [{ step: 'ANSWERS', part: 'LEAF', pattern: 'SPOTS', color: 'BROWN' }],
};

export const myCropSignals: MyCropSignal[] = [
  {
    cropCode: 'TOMATO',
    names: { en: 'Tomato', hi: 'टमाटर' },
    commodityCode: 'TOMATO',
    state: 'Maharashtra',
    district: 'Nashik',
    cropIds: [crop.id],
    signal: {
      trend: 'RISING',
      changePct7d: 12.4,
      changePct30d: 6.1,
      momentumDiverges: false,
      guidanceKey: 'market.guidanceRising',
      reasonCode: 'OK',
      trace: [{ step: 'WINDOW', observations: 30 }],
    },
    freshness: { status: 'cached', source: 'datagovin', fetchedAt: iso(0), latestDate: iso(-1) },
  },
];

export const priceSeries: PriceSeriesResponse = {
  series: Array.from({ length: 10 }, (_, index) => ({
    date: iso(-9 + index),
    market: index % 2 === 0 ? 'Nashik' : 'Pimpalgaon',
    minPrice: 1200 + index * 20,
    modalPrice: 1500 + index * 25,
    maxPrice: 1800 + index * 30,
    adjusted: false,
  })),
  signal: myCropSignals[0]!.signal,
  freshness: { status: 'cached', source: 'datagovin', fetchedAt: iso(0), latestDate: iso(-1) },
};

export const communityAlerts: CommunityAlert[] = [
  {
    district: 'Nashik',
    state: 'Maharashtra',
    cropCode: 'TOMATO',
    diseaseCode: 'TOMATO_EARLY_BLIGHT',
    reportCount: 5,
    level: 'INFO',
    windowStart: iso(-7),
    windowEnd: iso(0),
  },
];

export const cropRecommendation: CropRecResponse = {
  recommendations: [
    {
      cropCode: 'TOMATO',
      names: { en: 'Tomato', hi: 'टमाटर' },
      supportLevel: 'SPECIALIZED',
      score: 0.82,
      evidenceRatio: 0.75,
      reasons: [{ key: 'cropRec.seasonMatch', field: 'seasons', data: { seasons: ['KHARIF'] } }],
      cautions: [],
      sources: [{ org: 'ICAR', title: 'Crop calendar', url: 'https://icar.org.in/' }],
      factors: {},
    },
  ],
  excluded: [
    {
      cropCode: 'RICE',
      names: { en: 'Rice', hi: 'धान' },
      reason: 'WATER',
      reasonKey: 'cropRec.gateWater',
      data: { needFloorMm: 900, normalRainfallMm: 550 },
    },
  ],
  limitations: [{ key: 'cropRec.limitationNoNormalForDistrict' }],
  trace: [{ step: 'INPUT', season: 'KHARIF', soilType: 'black' }],
  request: { farmId: farm.id, season: 'KHARIF', preference: null },
};
