/**
 * Query-key registry and the invalidation map.
 *
 * Keys are declared here rather than inline so that a mutation can name what
 * it invalidates without a component having to remember the exact tuple
 * (docs/frontend/state-management.md: "invalidation map per mutation
 * documented in api/ layer"). Every key is a prefix of the ones below it, so
 * invalidating `farms.all()` also drops every farm detail.
 */

export const queryKeys = {
  session: () => ['session'] as const,

  dashboard: () => ['dashboard'] as const,

  farms: {
    all: () => ['farms'] as const,
    list: () => ['farms', 'list'] as const,
    detail: (farmId: string) => ['farms', 'detail', farmId] as const,
    weather: (farmId: string) => ['farms', 'weather', farmId] as const,
    /**
     * What to plant on this field. Under the `farms` prefix on purpose: a farm
     * edit or a new crop changes the free land and the standing-crop set, so
     * invalidating `farms.all()` correctly drops the ranking too.
     */
    recommendations: (farmId: string, season: string | undefined) =>
      ['farms', 'recommendations', farmId, season ?? 'auto'] as const,
  },

  crops: {
    all: () => ['crops'] as const,
    forFarm: (farmId: string) => ['crops', 'forFarm', farmId] as const,
    detail: (cropId: string) => ['crops', 'detail', cropId] as const,
    irrigation: (cropId: string) => ['crops', 'irrigation', cropId] as const,
    irrigationLedger: (cropId: string, page: number) =>
      ['crops', 'irrigationLedger', cropId, page] as const,
    fertilizer: (cropId: string) => ['crops', 'fertilizer', cropId] as const,
  },

  recommendations: {
    all: () => ['recommendations'] as const,
    history: (page: number) => ['recommendations', 'history', page] as const,
  },

  health: {
    all: () => ['health'] as const,
    logs: (cropId: string | undefined, page: number) =>
      ['health', 'logs', cropId ?? 'all', page] as const,
    /** Scan history for one field — a different list from one crop's. */
    farmLogs: (farmId: string, page: number) => ['health', 'farmLogs', farmId, page] as const,
    log: (logId: string) => ['health', 'log', logId] as const,
  },

  market: {
    all: () => ['market'] as const,
    myCrops: (days: number) => ['market', 'myCrops', days] as const,
    prices: (
      commodity: string,
      state: string | undefined,
      district: string | undefined,
      days: number,
    ) => ['market', 'prices', commodity, state ?? '', district ?? '', days] as const,
    nearby: (farmId: string, commodity: string | undefined, days: number) =>
      ['market', 'nearby', farmId, commodity ?? '', days] as const,
  },

  registry: {
    all: () => ['registry'] as const,
    list: () => ['registry', 'list'] as const,
    crop: (cropCode: string) => ['registry', 'crop', cropCode] as const,
  },

  community: {
    all: () => ['community'] as const,
    alerts: (district: string | undefined, state: string | undefined) =>
      ['community', 'alerts', district ?? '', state ?? ''] as const,
  },

  /**
   * Crop recommendation.
   *
   * The endpoint is a POST, but the request is a pure read — the same farm,
   * season and preference always produce the same ranking — so the suitability
   * detail screen caches it by its inputs rather than smuggling the chosen item
   * through router state, which would not survive a refresh or a shared link.
   */
  cropRec: {
    all: () => ['cropRec'] as const,
    run: (farmId: string, season: string, preference: string | null) =>
      ['cropRec', 'run', farmId, season, preference ?? ''] as const,
  },
} as const;

/**
 * Staleness, per docs/frontend/state-management.md.
 *
 * These are UX smoothing only. True freshness is whatever the API's
 * `freshness` block says — the server's cache governs it — so a short client
 * TTL here never turns cached data into live data on screen.
 */
export const STALE_TIME = {
  /** Dashboard: 60s. */
  dashboard: 60_000,
  /** Weather and market: 5min. */
  slowMoving: 5 * 60_000,
  /** Registry: 7d. Content changes only when the seed script runs. */
  registry: 7 * 24 * 60 * 60_000,
  /** Anything the farmer just changed themselves. */
  interactive: 30_000,
} as const;
