/**
 * Typed endpoint functions — one per route the API actually exposes.
 *
 * Grouped by resource, in the order `backend/src/app.js` mounts them. Nothing
 * here invents a path or a payload: every signature below corresponds to a
 * handler in `backend/src/routes/`, and routes that do not exist (no community
 * write API, no `/market/compare`) are absent rather than stubbed.
 */
import {
  apiDelete,
  apiGet,
  apiGetPaged,
  apiPatch,
  apiPost,
  apiPostNoContent,
  authRequest,
  type Paged,
} from './client';
import type {
  CommunityAlert,
  CropRecResponse,
  CropWithStage,
  DashboardResponse,
  Farm,
  FarmInput,
  FarmRecDetailResponse,
  FarmRecommendationsResponse,
  FarmWeather,
  FertilizerGuidance,
  HealthLog,
  HealthLogSummary,
  IrrigationAdvice,
  IrrigationLogEntry,
  IrrigationLogPayload,
  IrrigationLogResponse,
  LandUnit,
  Language,
  MyCropSignal,
  NearbyMandisResponse,
  PriceSeriesResponse,
  RecommendationHistoryItem,
  RegistryCrop,
  RegistrySummary,
  SessionResponse,
  SeverityResponse,
  SpreadRate,
  Season,
  SymptomAnswers,
  SymptomCheckResponse,
  User,
  CreateCropInput,
  YieldEstimateResponse,
  YieldSummaryResponse,
} from './types';

// ── /auth ───────────────────────────────────────────────────────────────────

export const authApi = {
  register: (payload: { name: string; email: string; password: string; language?: Language }) =>
    apiPost<SessionResponse>('/auth/register', payload, authRequest()),

  login: (payload: { email: string; password: string }) =>
    apiPost<SessionResponse>('/auth/login', payload, authRequest()),

  /**
   * The refresh cookie is httpOnly and path-scoped, so no body is sent: the
   * browser attaches it because `withCredentials` is set. The mobile-style
   * body variant exists on the API but is not used here.
   */
  logout: () => apiPostNoContent('/auth/logout', {}, authRequest()),

  me: () => apiGet<{ user: User }>('/auth/me'),
};

// ── /users ──────────────────────────────────────────────────────────────────

/**
 * Account preferences.
 *
 * The body is preferences only, and `.strict()` server-side: `name`, `email`,
 * `id` and `passwordHash` are rejected rather than stripped, so there is no
 * shape here that could quietly fail. `units` is patched as a whole object
 * because that is how the API models it.
 */
export const usersApi = {
  updateMe: (payload: {
    language?: Language;
    units?: { land: LandUnit };
    voiceEnabled?: boolean;
    communityConsent?: boolean;
  }) => apiPatch<{ user: User }>('/users/me', payload),
};

// ── /farms ──────────────────────────────────────────────────────────────────

export const farmsApi = {
  list: () => apiGet<{ farms: Farm[] }>('/farms'),

  get: (farmId: string) => apiGet<{ farm: Farm; crops: CropWithStage[] }>(`/farms/${farmId}`),

  create: (payload: FarmInput) => apiPost<{ farm: Farm }>('/farms', payload),

  update: (farmId: string, payload: Partial<FarmInput>) =>
    apiPatch<{ farm: Farm }>(`/farms/${farmId}`, payload),

  remove: (farmId: string) => apiDelete(`/farms/${farmId}`),

  weather: (farmId: string) => apiGet<FarmWeather>(`/farms/${farmId}/weather`),

  /**
   * Multipart, same shape as `healthApi.analyze`: the field name is fixed to
   * `image` (`backend/src/middleware/uploadImage.js` allowlists exactly that
   * one field), and `Content-Type` is left for the browser to set so it can
   * add the multipart boundary itself.
   */
  uploadPhoto: (
    farmId: string,
    image: File | Blob,
    options: { onUploadProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ) => {
    const form = new FormData();
    form.append('image', image);

    return apiPost<{ farm: Farm }>(`/farms/${farmId}/photo`, form, {
      signal: options.signal,
      timeout: 45_000,
      onUploadProgress: options.onUploadProgress
        ? (event) => {
            if (event.total) options.onUploadProgress!(event.loaded / event.total);
          }
        : undefined,
    });
  },

  removePhoto: (farmId: string) => apiDelete(`/farms/${farmId}/photo`),

  /**
   * What to plant on this field. Farm-scoped, unlike `cropRecApi.run` — it
   * knows the field's soil, water source, standing crops, free land and
   * reachable mandis, and gates on market availability, which a season-only
   * wizard cannot.
   */
  recommendations: (farmId: string, params: { season?: Season; preference?: string } = {}) =>
    apiGet<FarmRecommendationsResponse>(`/farms/${farmId}/recommendations`, { params }),

  /** One crop out of the same ranking — never a second scoring path. */
  recommendation: (
    farmId: string,
    cropCode: string,
    params: { season?: Season; preference?: string } = {},
  ) =>
    apiGet<FarmRecDetailResponse>(
      `/farms/${farmId}/recommendations/${encodeURIComponent(cropCode)}`,
      { params },
    ),
};

// ── /crops (mounted at the API root; both path shapes live here) ────────────

export const cropsApi = {
  listForFarm: (farmId: string) => apiGet<{ crops: CropWithStage[] }>(`/farms/${farmId}/crops`),

  create: (farmId: string, payload: CreateCropInput) =>
    apiPost<{ crop: CropWithStage }>(`/farms/${farmId}/crops`, payload),

  get: (cropId: string) =>
    apiGet<{ crop: CropWithStage; registry: RegistryCrop | null }>(`/crops/${cropId}`),

  update: (
    cropId: string,
    payload: { status?: CropWithStage['status']; variety?: string; areaValue?: number },
  ) => apiPatch<{ crop: CropWithStage }>(`/crops/${cropId}`, payload),

  remove: (cropId: string) => apiDelete(`/crops/${cropId}`),

  /** Same multipart shape as `farmsApi.uploadPhoto` — see that comment. */
  uploadPhoto: (
    cropId: string,
    image: File | Blob,
    options: { onUploadProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ) => {
    const form = new FormData();
    form.append('image', image);

    return apiPost<{ crop: CropWithStage }>(`/crops/${cropId}/photo`, form, {
      signal: options.signal,
      timeout: 45_000,
      onUploadProgress: options.onUploadProgress
        ? (event) => {
            if (event.total) options.onUploadProgress!(event.loaded / event.total);
          }
        : undefined,
    });
  },

  removePhoto: (cropId: string) => apiDelete(`/crops/${cropId}/photo`),

  irrigation: (cropId: string) => apiGet<IrrigationAdvice>(`/crops/${cropId}/irrigation`),

  /** `amountMm` omitted means "refilled fully" (engine rule R8). */
  logIrrigation: (cropId: string, payload: IrrigationLogPayload) =>
    apiPost<IrrigationLogResponse>(`/crops/${cropId}/irrigation-log`, payload),

  irrigationLedger: (cropId: string, params: { page?: number; limit?: number } = {}) =>
    apiGetPaged<{ logs: IrrigationLogEntry[] }>(`/crops/${cropId}/irrigation-log`, { params }),

  fertilizer: (cropId: string) =>
    apiGet<FertilizerGuidance>(`/crops/${cropId}/fertilizer-guidance`),

  /**
   * A lookup against published government district statistics — never a
   * prediction. A crop with no evidence answers 200 with `estimated: false`,
   * so this rejects only on a real transport or auth failure.
   */
  yieldEstimate: (cropId: string) =>
    apiGet<YieldEstimateResponse>(`/crops/${cropId}/yield-estimate`),
};

// ── /yield ──────────────────────────────────────────────────────────────────

export const yieldApi = {
  summary: () => apiGet<YieldSummaryResponse>('/yield/summary'),
};

// ── /dashboard and /recommendations ─────────────────────────────────────────

export const dashboardApi = {
  get: () => apiGet<DashboardResponse>('/dashboard'),
};

export const recommendationsApi = {
  history: (params: { page?: number; limit?: number } = {}) =>
    apiGetPaged<{ recommendations: RecommendationHistoryItem[] }>('/recommendations', { params }),

  acknowledge: (recommendationId: string) =>
    apiPostNoContent(`/recommendations/${recommendationId}/ack`),
};

// ── /crop-recommendation ────────────────────────────────────────────────────

export const cropRecApi = {
  run: (payload: { farmId: string; season: Season; preference?: 'food' | 'cash' | 'any' }) =>
    apiPost<CropRecResponse>('/crop-recommendation', payload),
};

// ── /market ─────────────────────────────────────────────────────────────────

export const marketApi = {
  prices: (params: { commodity: string; state?: string; district?: string; days?: number }) =>
    apiGet<PriceSeriesResponse>('/market/prices', { params }),

  myCrops: (params: { days?: number } = {}) =>
    apiGetPaged<{ crops: MyCropSignal[] }>('/market/my-crops', { params }),

  /**
   * What is trading near a farm. Farm-first, not commodity-first: the farm
   * already carries the state and district, so the farmer never re-selects a
   * location they have already given. `commodity` is an optional filter.
   */
  nearby: (params: { farmId: string; commodity?: string; days?: number }) =>
    apiGet<NearbyMandisResponse>('/market/nearby', { params }),
};

// ── /registry (public — no token required) ──────────────────────────────────

export const registryApi = {
  list: () => apiGetPaged<{ crops: RegistrySummary[] }>('/registry/crops'),

  get: (cropCode: string) =>
    apiGet<{ crop: RegistryCrop }>('/registry/crops', { params: { code: cropCode } }),
};

// ── /crop-health ────────────────────────────────────────────────────────────

export interface AnalyzeInput {
  cropId: string;
  image: File | Blob;
  description?: string;
  shareToCommunity?: boolean;
  /** Upload progress, 0–1. Drives the dropzone's determinate phase. */
  onUploadProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export const healthApi = {
  /**
   * Multipart. The field name is fixed to `image` because
   * `backend/src/middleware/uploadImage.js` allowlists exactly that one field
   * and multer rejects anything else before a byte is buffered.
   *
   * `Content-Type` is deliberately not set: the browser has to add the
   * multipart boundary itself, and overriding it produces an unparseable body.
   */
  analyze: ({
    cropId,
    image,
    description,
    shareToCommunity,
    onUploadProgress,
    signal,
  }: AnalyzeInput) => {
    const form = new FormData();
    form.append('cropId', cropId);
    form.append('image', image);
    if (description) form.append('description', description);
    if (shareToCommunity !== undefined) {
      form.append('shareToCommunity', shareToCommunity ? 'true' : 'false');
    }

    return apiPost<{ log: HealthLog }>('/crop-health/analyze', form, {
      signal,
      // The chain is contracted to ≤15s end-to-end; the default 20s client
      // timeout would fire mid-analysis on a slow upload of an 8MB photo.
      timeout: 45_000,
      onUploadProgress: onUploadProgress
        ? (event) => {
            if (event.total) onUploadProgress(event.loaded / event.total);
          }
        : undefined,
    });
  },

  /** `farmId` keeps one field's scan history out of another's. */
  logs: (params: { cropId?: string; farmId?: string; page?: number; limit?: number } = {}) =>
    apiGetPaged<{ logs: HealthLogSummary[] }>('/crop-health/logs', { params }),

  log: (logId: string) => apiGet<{ log: HealthLog }>(`/crop-health/logs/${logId}`),

  severity: (logId: string, payload: { affectedAreaPct?: number; spreadRate?: SpreadRate }) =>
    apiPost<{ severity: SeverityResponse }>(`/crop-health/logs/${logId}/severity`, payload),

  symptomCheck: (payload: { cropId: string; answers: SymptomAnswers }) =>
    apiPost<SymptomCheckResponse>('/crop-health/symptom-check', payload),
};

// ── /community (read-only by design — there is no write API) ────────────────

export const communityApi = {
  alerts: (params: { district?: string; state?: string } = {}) =>
    apiGet<{ alerts: CommunityAlert[] }>('/community/alerts', { params }),
};

export type { Paged };
