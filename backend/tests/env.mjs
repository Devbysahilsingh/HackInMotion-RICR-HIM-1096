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

/**
 * Signing secrets for the suite.
 *
 * These are required in every environment now — the schema no longer makes them
 * production-only, and nothing mints a random per-process value when they are
 * absent (`config/env.js`). Fixed values rather than generated ones so a failing
 * token test reproduces across runs.
 *
 * Not credentials: they authenticate nothing outside this process, they are the
 * literal strings below in every checkout, and the suites that sign tokens
 * (`st-01-05-auth`, `st-05b-token-forgery`) read them through `requireSecret`
 * exactly as the application does.
 */
process.env.JWT_SECRET ??= 'test-only-jwt-secret-not-a-real-credential'; // pragma: allowlist-secret
process.env.SERVICE_KEY ??= 'test-only-service-key-not-a-real-credential'; // pragma: allowlist-secret
