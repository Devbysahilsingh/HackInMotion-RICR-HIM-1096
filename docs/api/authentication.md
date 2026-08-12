# Auth API

| | |
|---|---|
| POST `/auth/register` | Public · RL 10/h/IP |
Req `{name, email, password, language?}` → 201 `{user{id,name,email,language}, accessToken, refreshToken*}`.
Validation: docs/database/validation.md. Duplicate email → 201-shaped **generic success message is NOT used**; returns 409 CONFLICT with messageKey `auth.registerFailed` (same key used for several failure classes to limit enumeration; login-side messages fully generic). Errors: 422, 409, 429.

| | |
|---|---|
| POST `/auth/login` | Public · RL 5/15min per IP+email bucket |
Req `{email, password}` → 200 `{user, accessToken, refreshToken*}`. Failure always 401 `auth.invalidCredentials` (same for wrong email vs wrong password). Audit-logged. bcrypt compare timing-consistent.

| | |
|---|---|
| POST `/auth/refresh` | Public (carries refresh token) · RL 60/h/IP |
Web: refresh from httpOnly cookie `rt`; Mobile: `{refreshToken}` body. Rotation: validate hash → not revoked/expired → issue new access + new refresh (same familyId), revoke old. **Reuse of revoked token → revoke entire family + audit `token_reuse` + 401.** → 200 `{accessToken, refreshToken*}`.

| | |
|---|---|
| POST `/auth/logout` | Auth |
Revokes presented refresh token (+clears cookie). → 204.

| | |
|---|---|
| GET `/auth/me` | Auth |
→ 200 `{user}` (no passwordHash ever serialized — schema `select:false`).

\* refreshToken delivery: web = `Set-Cookie: rt=…; HttpOnly; Secure; SameSite=None; Path=/api/v1/auth` (cross-origin Vercel↔Render); mobile = JSON body → SecureStore. Access token: 30min, HS256, payload `{sub, iat, exp, jti}` only (no PII). Dependencies: users, refreshTokens, auditLogs.
