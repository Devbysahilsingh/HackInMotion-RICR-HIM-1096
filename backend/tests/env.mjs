/**
 * Test-run environment, applied before any application module is imported.
 * Loaded via `node --import ./tests/env.mjs --test`.
 *
 * NODE_ENV=test keeps the production-only env requirements off (secrets that
 * do not exist locally) while leaving every security middleware in place —
 * the suites run the same stack the deploy runs.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.CORS_ORIGINS ??= 'http://localhost:5173';
