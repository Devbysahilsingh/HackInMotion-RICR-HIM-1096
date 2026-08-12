/**
 * Test data factories.
 *
 * Shared, additive and deliberately thin: each export produces one valid
 * shape with an overrides argument, so a suite states only the field it is
 * actually testing and the rest stays out of the way.
 */
import { randomUUID } from 'node:crypto';

/** Unique per call — the users collection has a unique index on email. */
export const uniqueEmail = (prefix = 'farmer') => `${prefix}-${randomUUID()}@example.com`;

/**
 * Registers a real account through the real endpoint, so suites exercise the
 * same token issuance production does rather than minting JWTs by hand.
 *
 * @param {{ request: Function }} server from startTestServer
 * @returns {Promise<{ user: object, accessToken: string, refreshToken: string, password: string }>}
 */
export async function registerUser(server, overrides = {}) {
  const body = {
    name: 'Test Farmer',
    email: uniqueEmail(),
    password: 'correct-horse-battery', // pragma: allowlist-secret — fabricated value, exists only to prove it is never leaked
    ...overrides,
  };

  const res = await server.request('/api/v1/auth/register', { method: 'POST', body });
  if (res.status !== 201) {
    throw new Error(`registerUser failed: ${res.status} ${res.text}`);
  }

  return { ...res.body.data, password: body.password };
}

/** A valid POST /farms body. Coordinates are Nagpur, Maharashtra. */
export const farmInput = (overrides = {}) => ({
  name: 'North Field',
  location: {
    lat: 21.1458,
    lon: 79.0882,
    state: 'Maharashtra',
    district: 'Nagpur',
    source: 'gps',
  },
  sizeValue: 2.5,
  sizeUnit: 'acre',
  soilType: 'black',
  irrigationMethod: 'borewell',
  ...overrides,
});
