# Users API

| | |
|---|---|
| PATCH `/users/me` | Auth |
Req any of `{name, language, units, voiceEnabled, communityConsent}` → 200 `{user}`. communityConsent toggling to false stops future sharing (existing aggregates are anonymous counts, unaffected — documented in privacy). Errors: 422.

| | |
|---|---|
| PATCH `/users/me/password` | Auth · RL 5/h |
Req `{currentPassword, newPassword}` → 204. Revokes all refresh-token families except current. Priority P2.

| | |
|---|---|
| DELETE `/users/me` | Auth · RL 2/day |
Req `{password}` → 202; cascade per docs/database/data-lifecycle.md. Priority P2.

No `GET /users/:id` — users can never address other users. No admin user APIs (no admin exists).
