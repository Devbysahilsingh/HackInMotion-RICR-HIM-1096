# Authentication Design

- **Passwords:** bcrypt cost 12; policy ≥8 chars (server-enforced; no composition theater); compare via bcrypt only; hash never serialized (`select:false`).
- **Access JWT:** HS256 (alg pinned in verify), 256-bit `JWT_SECRET`, TTL 30min, claims {sub, jti, iat, exp} only — no PII/roles. Web: React memory (state) — page refresh silently re-auths via refresh cookie. Mobile: SecureStore.
- **Refresh tokens:** 128-bit random (not JWT), sha256 hash at rest, TTL 7d. **Rotation:** every /auth/refresh revokes presented token, issues successor in same familyId. **Reuse detection:** presented-but-revoked token ⇒ revoke ENTIRE family + audit `token_reuse` ⇒ forces re-login (stolen-token session killed). Delivery: web httpOnly/Secure/SameSite=None cookie path-scoped to /api/v1/auth; mobile response body → SecureStore.
- **Logout:** revoke presented refresh + clear cookie; "logout all" = revoke all families (used on password change).
- **Rate limits:** login 5/15min per IP+email; register 10/h/IP; refresh 60/h/IP.
- **No recovery flow in MVP** (no free trustworthy mail path) — documented user-facing ("contact support"), P3 with OTP/mail decision.
- **Session security extras:** helmet headers; CSP restricting script-src 'self' (web app hosts no inline third-party scripts — all self-contained). Login/refresh/logout audited with ip+UA.

Explicitly banned (re-affirmed): demo bypass logins, hardcoded users, "test mode" auth flags, secret query params. Seeded demo farmer uses the normal registration path via seed script with env-provided password.
