/**
 * Typed endpoint functions — one per route the API actually exposes.
 *
 * Deliberately a near-copy of `web/frontend/src/api/endpoints.ts`: the two
 * clients consume one contract, and a divergence here would be a divergence in
 * what the two surfaces believe the server does. Nothing invents a path or a
 * payload; routes that do not exist (`/market/compare`, a community write API)
 * are absent rather than stubbed.
 *
 * Three things genuinely differ from the web file:
 *  - auth calls carry the refresh token in the body instead of a cookie;
 *  - `analyze` builds its multipart part from a file URI, because React Native
 *    has no `File` and `FormData` takes `{uri, name, type}` instead;
 *  - `PATCH /users/me` exists here, for the settings screen.
 */
import {
  apiDelete,
  apiGet,
  apiGetPaged,
  apiPatch,
  apiPost,
  apiPostNoContent,
  UPLOAD_TIMEOUT_MS,
  type Paged,
} from './client';
import { getRefreshToken } from './session';
import type {
  CommunityAlert,
  CreateCropInput,
  CropRecResponse,
  CropWithStage,
  DashboardResponse,
  Farm,
  FarmInput,
  FarmWeather,
  FertilizerGuidance,
  HealthLog,
  HealthLogSummary,
  IrrigationAdvice,
  IrrigationLogEntry,
  Language,
  LandUnit,
  MyCropSignal,
  NearbyMandisResponse,
  PriceSeriesResponse,
  RecommendationHistoryItem,
  RegistryCrop,
  RegistrySummary,
  Season,
  SessionResponse,
  SeverityResponse,
  SpreadRate,
  SymptomAnswers,
  SymptomCheckResponse,
  User,
} from '@shared/types/api';

// ── /auth ───────────────────────────────────────────────────────────────────

export const authApi = {
  register: (payload: { name: string; email: string; password: string; language?: Language }) =>
    apiPost<SessionResponse>('/auth/register', payload),

  login: (payload: { email: string; password: string }) =>
    apiPost<SessionResponse>('/auth/login', payload),

  /**
   * The token is sent explicitly — there is no cookie jar on this platform.
   *
   * Note the ordering constraint the caller has to respect: `/auth/logout`
   * sits behind `requireAuth`, so it needs a live *access* token as well as
   * the refresh token it revokes. `AuthContext` refreshes first when the
   * access token has expired, and falls back to a local wipe if even that
   * fails — better a stranded server-side token than a farmer who cannot get
   * out of the account on a shared handset.
   */
  logout: async () => {
    const refreshToken = await getRefreshToken();
    await apiPostNoContent('/auth/logout', refreshToken ? { refreshToken } : {});
  },

  me: () => apiGet<{ user: User }>('/auth/me'),
};

// ── /users ──────────────────────────────────────────────────────────────────

export interface UserSettingsPatch {
  language?: Language;
  units?: { land: LandUnit };
  voiceEnabled?: boolean;
  communityConsent?: boolean;
}

export const usersApi = {
  updateMe: (payload: UserSettingsPatch) => apiPatch<{ user: User }>('/users/me', payload),
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
};

// ── /crops ──────────────────────────────────────────────────────────────────

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

  irrigation: (cropId: string) => apiGet<IrrigationAdvice>(`/crops/${cropId}/irrigation`),

  /** `amountMm` omitted means "refilled fully" (engine rule R8). */
  logIrrigation: (cropId: string, payload: { date: string; amountMm?: number }) =>
    apiPost<{ log: IrrigationLogEntry }>(`/crops/${cropId}/irrigation-log`, payload),

  irrigationLedger: (cropId: string, params: { page?: number; limit?: number } = {}) =>
    apiGetPaged<{ logs: IrrigationLogEntry[] }>(`/crops/${cropId}/irrigation-log`, { params }),

  fertilizer: (cropId: string) =>
    apiGet<FertilizerGuidance>(`/crops/${cropId}/fertilizer-guidance`),
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
  /** A local `file://` URI, already compressed by `services/image.ts`. */
  imageUri: string;
  mimeType?: string;
  description?: string;
  shareToCommunity?: boolean;
  /** Upload progress, 0–1. Drives the determinate phase of the progress bar. */
  onUploadProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export const healthApi = {
  /**
   * Multipart. The field name is fixed to `image` because
   * `backend/src/middleware/uploadImage.js` allowlists exactly that one field
   * and multer rejects anything else before a byte is buffered.
   *
   * `Content-Type` is deliberately not set: React Native's `FormData` has to
   * add the multipart boundary itself, and overriding the header produces a
   * body the server cannot parse.
   *
   * The declared `type` is a courtesy for the wire only — the server decides
   * the real format from magic bytes and ignores what we claim.
   */
  analyze: ({
    cropId,
    imageUri,
    mimeType = 'image/jpeg',
    description,
    shareToCommunity,
    onUploadProgress,
    signal,
  }: AnalyzeInput) => {
    const form = new FormData();
    form.append('cropId', cropId);
    form.append('image', {
      uri: imageUri,
      name: 'leaf.jpg',
      type: mimeType,
    } as unknown as Blob);
    if (description) form.append('description', description);
    if (shareToCommunity !== undefined) {
      form.append('shareToCommunity', shareToCommunity ? 'true' : 'false');
    }

    return apiPost<{ log: HealthLog }>('/crop-health/analyze', form, {
      signal,
      // The chain is contracted to ≤15s end-to-end; the default 15s client
      // timeout would fire mid-analysis on a slow upload over 2G.
      timeout: UPLOAD_TIMEOUT_MS,
      onUploadProgress: onUploadProgress
        ? (event) => {
            if (event.total) onUploadProgress(event.loaded / event.total);
          }
        : undefined,
    });
  },

  logs: (params: { cropId?: string; page?: number; limit?: number } = {}) =>
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
