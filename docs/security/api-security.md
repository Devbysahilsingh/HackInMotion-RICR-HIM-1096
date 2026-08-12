# API Security (Express + FastAPI)

## Express middleware stack (order matters; production config == demo config)
`helmet` (CSP, HSTS, noSniff, frameguard) → CORS allowlist (exact origins env-driven; credentials:true only where cookie flows) → global rate limit 300/15min/IP → JSON body limit 100KB → mongo-sanitize → pino-http with redaction (authorization, cookies, passwords never logged) → routes (per-route Zod + auth + ownership + route-specific limits: auth buckets, upload 3/min+10/day, AI analysis 10/day, voice 20/day) → centralized error handler (envelope, requestId, no internals).

## FastAPI
X-Service-Key dependency on /predict (constant-time compare); request size limit; decode guards; 10s timeout; 2 workers; structured logs w/o payloads; /healthz minimal. Not registered on any public docs index; OpenAPI docs disabled in production (`docs_url=None`).

## Cross-cutting
- Timeouts on ALL outbound calls (8–15s per service) + 1 retry + circuit skip (resilience doc) — protects our workers from hung externals.
- API versioning /api/v1; unknown routes → 404 envelope (no Express default HTML).
- No SSRF surface: the API accepts no URLs to fetch, anywhere (uploads are bytes; integrations use fixed hosts).
- Request logging includes requestId propagated to ml-service (X-Request-Id) for cross-service tracing.
- npm audit / pip-audit gate before each deploy (dependency-security.md).
