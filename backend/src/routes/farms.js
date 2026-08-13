/**
 * Farm endpoints (docs/api/farms.md).
 *
 * A farm is the anchor every other feature hangs off — crops, weather,
 * irrigation, recommendations — so the ownership discipline here sets the
 * pattern for all of them: the id in the path is never queried on its own,
 * and a farm belonging to someone else is indistinguishable from one that
 * does not exist (404, never 403).
 *
 * Rate limiting is the documented global bucket (300/15min/IP); farms.md
 * declares no stricter bucket, and the 10-farm cap already bounds what
 * repeated creates can achieve.
 */
import { Router } from 'express';
import { z } from 'zod';

import {
  INDIA_BOUNDS,
  IRRIGATION_METHODS,
  LAND_UNITS,
  LOCATION_SOURCES,
  SOIL_TYPES,
} from '../config/constants.js';
import { loadOwned } from '../middleware/loadOwned.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { Farm } from '../models/index.js';
import { farmWeather } from '../services/farmWeatherService.js';
import * as farmService from '../services/farmService.js';
import { warmLocation } from '../services/weatherService.js';
import { warmMarketForState } from '../services/marketService.js';
import { sendData, sendNoContent } from '../utils/respond.js';
import { logger } from '../utils/logger.js';

/**
 * Fire-and-forget cache warm for a farm's grid cell.
 *
 * Deliberately not awaited and deliberately unable to reject: it runs after the
 * response has been sent, so an unhandled rejection here would crash the
 * process for something the farmer neither asked for nor is waiting on.
 */
function warmFarmLocation(farm) {
  void warmLocation({
    locationKey: farm.locationKey,
    lat: farm.location?.lat,
    lon: farm.location?.lon,
  }).catch((err) => logger.warn({ err }, 'weather warm rejected'));

  // The same treatment for mandi data: a farmer who registers the first farm in
  // their state should not face an empty market screen until the nightly job.
  void warmMarketForState({ state: farm.location?.state }).catch((err) =>
    logger.warn({ err }, 'market warm rejected'),
  );
}

export const farmsRouter = Router();

/** Every farm route is authenticated — there is no public view of a holding. */
farmsRouter.use(requireAuth);

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Bounds are asserted on any supplied coordinate, not only on GPS ones: the
 * Mongoose schema enforces the same range, and a manual coordinate outside it
 * would otherwise fail there and surface as a 500 instead of a 422.
 */
const latSchema = z.number().min(INDIA_BOUNDS.minLat).max(INDIA_BOUNDS.maxLat);
const lonSchema = z.number().min(INDIA_BOUNDS.minLon).max(INDIA_BOUNDS.maxLon);

/**
 * State and district are free-trimmed strings for now. validation.md specifies
 * a canonical list from `shared/constants/geo`, which is deliberately empty
 * until the TODO that populates it — an invented list would be worse than a
 * late one, so the closed enum arrives with the data.
 */
const placeSchema = z.string().trim().min(1).max(60);

const locationSchema = z
  .object({
    lat: latSchema.optional(),
    lon: lonSchema.optional(),
    state: placeSchema,
    district: placeSchema,
    /**
     * Village or locality, as the farmer writes it. Optional, free text: no
     * canonical village list exists here, and the geocoder is given whatever
     * they typed rather than being restricted to a list we would have to invent.
     */
    village: z.string().trim().min(1).max(80).optional(),
    source: z.enum(LOCATION_SOURCES),
  })
  .superRefine((value, ctx) => {
    const hasLat = value.lat !== undefined;
    const hasLon = value.lon !== undefined;

    // Half a coordinate is not a location, whatever the source claims.
    if (hasLat !== hasLon) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasLat ? 'lon' : 'lat'],
        message: 'required',
      });
      return;
    }

    // 'gps' asserts the device measured a position; without one the record
    // would claim a precision it does not have.
    if (value.source === 'gps' && !hasLat) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lat'], message: 'required' });
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lon'], message: 'required' });
    }
  });

/**
 * `userId` is absent from this schema on purpose. Zod strips undeclared keys,
 * so a body carrying one is not rejected — it is discarded — and ownership is
 * taken from the access token in the handler. There is no request shape that
 * can create a farm for another account.
 */
const farmFields = {
  name: z.string().trim().min(1).max(80),
  location: locationSchema,
  // The acre-equivalent ceiling lives in the service: only the merge of a
  // PATCH with the stored document can be checked meaningfully.
  sizeValue: z.number().min(0.01),
  sizeUnit: z.enum(LAND_UNITS),
  soilType: z.enum(SOIL_TYPES),
  irrigationMethod: z.enum(IRRIGATION_METHODS),
  notes: z.string().trim().max(500).optional(),
};

const createFarmSchema = z.object(farmFields);

/**
 * Partial at the field level, whole at the location level: a location is
 * validated as a unit (source decides whether coordinates are required), so
 * patching one half of it is not expressible.
 */
const updateFarmSchema = z
  .object(farmFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'empty' });

// ── Routes ───────────────────────────────────────────────────────────────────

farmsRouter.get('/', async (req, res, next) => {
  try {
    // Scoped in the query, never post-filtered (AU-4).
    sendData(res, { farms: await farmService.listFarms(req.auth.userId) });
  } catch (err) {
    next(err);
  }
});

farmsRouter.post('/', validate({ body: createFarmSchema }), async (req, res, next) => {
  try {
    const farm = await farmService.createFarm(req.auth.userId, req.body);
    sendData(res, { farm: farm.toJSON() }, { status: 201 });
    // After the response, never before it: rule 3 forbids a farmer's request
    // depending on a provider. Without this the new field showed "Not fetched
    // yet" until the 3-hourly job ran. See weatherService.warmLocation.
    warmFarmLocation(farm);
  } catch (err) {
    next(err);
  }
});

farmsRouter.get('/:id', loadOwned({ model: Farm }), async (req, res, next) => {
  try {
    sendData(res, await farmService.farmWithCrops(req.farm));
  } catch (err) {
    next(err);
  }
});

farmsRouter.patch(
  '/:id',
  loadOwned({ model: Farm }),
  validate({ body: updateFarmSchema }),
  async (req, res, next) => {
    try {
      const previousKey = req.farm.locationKey;
      const farm = await farmService.updateFarm(req.farm, req.body);
      sendData(res, { farm: farm.toJSON() });
      // Only when the field actually moved to a new grid cell — an edit to the
      // name or size must not spend a provider call.
      if (farm.locationKey && farm.locationKey !== previousKey) warmFarmLocation(farm);
    } catch (err) {
      next(err);
    }
  },
);

farmsRouter.delete('/:id', loadOwned({ model: Farm }), async (req, res, next) => {
  try {
    await farmService.deleteFarmCascade(req.farm);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

/**
 * Weather for a farm (docs/api/weather.md). Served from weatherSnapshots only —
 * the request path never reaches a provider (CLAUDE.md rule 3).
 *
 * A location with no snapshot yet answers 200 with `freshness.status:'pending'`
 * and a retry hint rather than 5xx: "never 5xx for missing cache".
 */
farmsRouter.get('/:id/weather', loadOwned({ model: Farm }), async (req, res, next) => {
  try {
    sendData(res, await farmWeather(req.farm));
  } catch (err) {
    next(err);
  }
});
