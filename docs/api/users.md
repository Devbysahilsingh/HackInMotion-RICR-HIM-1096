# Users API

| | |
|---|---|
| PATCH `/users/me` | Auth · RL 30/h/user |
Req any of `{language, units{land}, voiceEnabled, communityConsent}` → 200 `{user}` — the same `toPublicJSON` projection `GET /auth/me` returns. Body is **strict**: at least one field is required (empty → 422) and an undeclared field is rejected rather than stripped, so `id`, `email` and `passwordHash` cannot be smuggled in. `me` is a literal — the document written is always the token's own account, and there is no `:id` form. communityConsent toggling to false stops future sharing (existing aggregates are anonymous counts, unaffected — documented in privacy); a real transition writes the `consent_changed` audit event. Errors: 401, 422, 429.

`name` is **not** yet accepted: no client edits it, and adding it here without that need would widen the write surface for nothing. Password and account deletion are the two endpoints below, not fields here.

| | |
|---|---|
| PATCH `/users/me/password` | Auth · RL 5/h |
Req `{currentPassword, newPassword}` → 204. Revokes all refresh-token families except current. Priority P2.

| | |
|---|---|
| DELETE `/users/me` | Auth · RL 2/day |
Req `{password}` → 202; cascade per docs/database/data-lifecycle.md. Priority P2.

No `GET /users/:id` — users can never address other users. No admin user APIs (no admin exists).
