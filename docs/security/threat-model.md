# Threat Model (STRIDE-lite across 8 surfaces)

Scored L(ikelihood)/I(mpact) H/M/L. Every H-impact threat has a control + a test in security-testing.md. Global invariants: **NO backdoors, NO master passwords, NO hidden/secret routes, NO demo auth bypass, NO hardcoded credentials, NO client-side-only authorization. Demo runs the production security config.**

## 1. Authentication surface
| Threat | L/I | Controls | Detection/Test |
|---|---|---|---|
| Credential stuffing / brute force | H/H | rate limit 5/15min per IP+email; bcrypt(12); generic errors | auditLogs login_failed spikes; test ST-01 |
| Account enumeration | M/M | uniform messages/timing on login; register 409 with shared messageKey | ST-02 |
| Token theft (XSS→access token) | M/H | access token in JS memory only (web), 30min TTL; CSP; no localStorage tokens | ST-03 |
| Refresh replay/theft | M/H | rotation + reuse detection → family revocation; httpOnly Secure SameSite cookie (web) / SecureStore (mobile); hash-at-rest | token_reuse audit event; ST-04 |
| JWT forgery/alg confusion | L/H | HS256 pinned, verify() with alg allowlist, 256-bit secret, exp enforced | ST-05 invalid/expired/none-alg suite |

## 2. API (Express)
| Threat | L/I | Controls |
|---|---|---|
| Cross-user data access (IDOR) | H/H | ownership middleware on EVERY resource (userId match → else 404); denormalized userId; test per endpoint (ST-10 matrix) |
| NoSQL injection | M/H | Zod validation, mongo-sanitize ($-strip), no string-built queries |
| Mass assignment | M/M | Zod strict schemas (unknown keys rejected); mongoose strict |
| DoS via payloads | M/M | body limit 100KB JSON / 8MB multipart only on upload route; pagination caps; global rate limit |
| CORS abuse | M/M | allowlist exact origins (Vercel prod + localhost dev); credentials only for cookie route |
| Error leakage | M/M | error envelope, no stack/driver text; pino redaction |

## 3. Image upload pipeline — dedicated doc: image-upload-security.md (polyglot files, bombs, EXIF privacy, abuse).
## 4. ml-service (FastAPI)
Unrestricted public inference (M/M) → X-Service-Key internal auth, only /healthz public; malicious image (M/M) → same decode guards as backend; resource exhaustion (M/M) → size/timeout/worker caps. SSRF: N/A by design — service fetches nothing (no URLs accepted anywhere in the system: uploads are bytes, never links — SSRF surface deliberately not created).
## 5. MongoDB
Exposed connection string (L/H) → env-only + Gitleaks + Atlas IP-allowlist (0.0.0.0/0 unavoidable on free Render egress — compensated by strong SRV creds, least-priv db user, TLS); injection covered §2; least privilege: app user readWrite on app db only.
## 6. External APIs (Gemini/weather/market/Cloudinary/Groq)
Key leakage (M/H) → server-side only, env, Gitleaks pre-commit+CI, README/screenshot review pass; response poisoning (L/M) → zero-trust validation of ALL external payloads before cache/serve; quota-drain abuse (M/M) → per-user quotas beneath free-tier ceilings.
## 7. Secrets & repo — dedicated doc: secrets-management.md.
## 8. Community/privacy surface
Reporter deanonymization (L/H) → district-only aggregation, ≥3-farmer threshold, PII-free schema (structural), opt-in consent; serialization test asserts zero identifying fields (ST-20).

## Mobile-specific
Token storage (SecureStore not AsyncStorage); no secrets in bundle (test: strings-scan of built APK); deep links: only whitelisted internal routes, no token-bearing links; debug builds never shipped to judges' hands with dev menus exposed.
