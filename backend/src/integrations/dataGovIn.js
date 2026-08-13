/**
 * data.gov.in — "Variety-wise Daily Market Prices" (Agmarknet-fed).
 *
 * docs/market/data-source.md: "Access: REST, free API key (registration;
 * approval usually quick but applied Day 0 first — OD-5)."
 *
 * ── BLOCKED ON EXTERNAL CREDENTIALS ──────────────────────────────────────────
 * Two pieces of configuration are required and **neither exists in this
 * repository**:
 *
 *   DATAGOVIN_API_KEY       the free registered key. OD-5 is still open;
 *                           MASTER-TODO's account row is unchecked.
 *   DATAGOVIN_RESOURCE_ID   the catalogue id of the price resource. No
 *                           repository document publishes one — data-source.md
 *                           names the dataset in prose only. It is deliberately
 *                           NOT defaulted here: guessing an id would produce a
 *                           confident-looking request against an unverified
 *                           endpoint, which is exactly the kind of unverifiable
 *                           claim rule 7 forbids.
 *
 * Everything downstream of this module — normalizer, sanity gates, quarantine
 * counters, drop-rate report, nightly job, signal engine, endpoints — is fully
 * implemented and tested against recorded fixture rows. Only the live call is
 * blocked, and it degrades to seeded history exactly as the architecture
 * intends ("primary key missing → seed rows labelled Historical").
 *
 * The key is never logged: `safeUrl` strips the query string, and no code path
 * puts the URL into an error.
 */
import { z } from 'zod';

import { MARKET_TIMEOUT_MS } from '../config/constants.js';
import { env } from '../config/env.js';
import { fetchJson } from '../utils/httpClient.js';

export const DATAGOVIN_PROVIDER = 'datagovin';
const BASE_URL = 'https://api.data.gov.in/resource';

/** The portal caps a page; requesting more silently truncates. */
export const PAGE_LIMIT = 1000;

/**
 * The nine fields docs/market/data-source.md commits to. Everything is a string
 * on the wire — the portal returns numbers as strings — so coercion happens in
 * the normalizer, not here.
 */
const recordSchema = z.object({
  state: z.string().optional(),
  district: z.string().optional(),
  market: z.string().optional(),
  commodity: z.string().optional(),
  variety: z.string().optional(),
  arrival_date: z.string().optional(),
  min_price: z.union([z.string(), z.number()]).optional(),
  max_price: z.union([z.string(), z.number()]).optional(),
  modal_price: z.union([z.string(), z.number()]).optional(),
});

const responseSchema = z.object({
  records: z.array(recordSchema),
  total: z.union([z.string(), z.number()]).optional(),
  count: z.union([z.string(), z.number()]).optional(),
});

/** @returns {{configured: boolean, missing: string[]}} */
export function configurationStatus() {
  const missing = [];
  if (!env.DATAGOVIN_API_KEY) missing.push('DATAGOVIN_API_KEY');
  if (!env.DATAGOVIN_RESOURCE_ID) missing.push('DATAGOVIN_RESOURCE_ID');
  return { configured: missing.length === 0, missing };
}

export function buildUrl({ resourceId, apiKey, offset = 0, limit = PAGE_LIMIT, filters = {} }) {
  const params = new URLSearchParams({
    'api-key': apiKey,
    format: 'json',
    offset: String(offset),
    limit: String(limit),
  });

  // The portal's filter syntax is `filters[field]=value`.
  for (const [field, value] of Object.entries(filters)) {
    if (value) params.set(`filters[${field}]`, String(value));
  }

  return `${BASE_URL}/${resourceId}?${params}`;
}

/**
 * Fetches one page of records.
 *
 * @returns {Promise<{records: object[]|null, invalid?: string, total?: number}>}
 * @throws {ProviderError} on network/timeout/status — the job decides what a
 *   failure means for the cache (RES-07: history serves, no data loss).
 */
export async function fetchPage({ offset = 0, limit = PAGE_LIMIT, filters, fetchImpl } = {}) {
  const status = configurationStatus();
  if (!status.configured) {
    // Configuration state, not a provider outage: reported so the circuit
    // breaker is not tripped by our own missing credentials.
    return { records: null, invalid: 'not_configured', missing: status.missing };
  }

  const body = await fetchJson(
    buildUrl({
      resourceId: env.DATAGOVIN_RESOURCE_ID,
      apiKey: env.DATAGOVIN_API_KEY,
      offset,
      limit,
      filters,
    }),
    { provider: DATAGOVIN_PROVIDER, timeoutMs: MARKET_TIMEOUT_MS, fetchImpl },
  );

  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return { records: null, invalid: 'schema' };

  return {
    records: parsed.data.records,
    total: Number(parsed.data.total ?? parsed.data.records.length) || parsed.data.records.length,
  };
}

/**
 * Walks the pages for one filter set.
 *
 * Bounded by `maxPages` so a portal that ignores `offset` — a real failure mode
 * for this API — cannot spin the nightly job forever against a free quota.
 */
export async function fetchAll({ filters, fetchImpl, maxPages = 10 } = {}) {
  const records = [];

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage({
      offset: page * PAGE_LIMIT,
      limit: PAGE_LIMIT,
      filters,
      fetchImpl,
    });

    if (!result.records) return { records: null, invalid: result.invalid, missing: result.missing };

    records.push(...result.records);
    if (result.records.length < PAGE_LIMIT) break;
  }

  return { records };
}
