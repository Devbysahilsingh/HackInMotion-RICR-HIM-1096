# Implementation Log

Chronological record of executed TODOs. Written so a fresh session (or teammate) can reconstruct project state without this conversation. Newest entry last.

---

## P0-3 · Development foundation — 2026-08-12 · Status: COMPLETED (verified)

**Scope implemented:** repository tooling, secret-scanning pre-commit gate, backend scaffold, web scaffold, shared structure. Per the approved scope split, `mobile/` and `ml-service/` scaffolds were deferred to their own phases (P6-1, P3-2) — their Expo/PyTorch installs are large and cannot be verified until those phases.

### Files created
**Repo root:** `.gitignore`, `.gitattributes`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `tsconfig.base.json`, `eslint.config.js`, `package.json`, `.gitleaks.toml`, `.githooks/pre-commit`, `scripts/scan-staged-secrets.mjs`
**Backend:** `backend/package.json`, `src/server.js`, `src/app.js`, `src/config/env.js`, `src/utils/logger.js`, `src/utils/errors.js`, `src/middleware/requestId.js`, `src/middleware/errorHandler.js`, `src/routes/health.js`
**Web:** `web/frontend/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`
**Shared:** `shared/README.md` + `.gitkeep` markers in `constants/ i18n/ schemas/ types/`
**Docs:** this file, `docs/decisions/ADR-019-backend-javascript-esm.md`, `docs/decisions/ADR-020-secret-scanning-gate.md`

### Files changed
`docs/development/MASTER-TODO.md` (P0-3 marked complete, scope split recorded), `docs/FINAL-PLAN-SPEC.md` (implementation-status line), `docs/requirements-traceability.md` (no FR rows moved — P0-3 implements no functional requirement), `docs/security/secrets-management.md` (records the actual two-layer gate), `docs/deployment/environment.md` (records production-conditional requirement behaviour).

### Engineering decisions (details in ADRs)
1. **Backend in JavaScript ESM, not TypeScript** (ADR-019) — the plan left this open. No build step means Render runs `node src/server.js` directly; Zod supplies the runtime validation that actually protects the API; clients stay TypeScript. Fastest to iterate and simplest to explain.
2. **Two-layer secret gate** (ADR-020) — gitleaks is not installed on the dev machine, and a hook that silently passes when its tool is missing is fake security. Layer 1 is a dependency-free Node scanner that always runs; gitleaks runs additionally when present.
3. **No npm workspaces** — apps keep independent `package.json` files; the root package holds only shared tooling. Avoids the hoisting problems Expo/metro hits in workspace monorepos (Phase 6) at the cost of one `npm install` per app.
4. **Node's native `--env-file`** instead of a `dotenv` dependency: `dev` loads `.env`, `start` reads the host-injected environment (no file needed on Render).
5. **Express 5** — native async error forwarding removes the need for an async-wrapper dependency.
6. **Production-conditional env requirements** — `MONGODB_URI`/`JWT_SECRET`/`SERVICE_KEY` are required in production and optional in development, so a misconfigured deploy fails at boot while local scaffolding work is not blocked on credentials that do not exist yet (OD-5/OD-6 deferred).
7. **`trust proxy = 1`** — exactly one hop (Render's proxy), so client IPs used later by rate limiting and audit logs are accurate without accepting spoofed forwarding chains.
8. `/healthz` reports only what exists today (status, service, version, uptime, timestamp). Database and job fields are added by the TODOs that introduce those subsystems — no placeholder "ok" for things that do not exist.

### Verification performed (all executed, results real)
| Check | Result |
|---|---|
| Root `npm install` | 0 vulnerabilities; `prepare` set `core.hooksPath=.githooks` |
| Pre-commit gate blocks a planted fake Google API key | **Blocked**, key redacted in output; commit count stayed at 1 |
| Clean staged tree passes the scan | `✔ secret scan: clean` |
| `.env` ignored / `.env.example` trackable | Both confirmed via `git check-ignore` |
| Backend install | 0 vulnerabilities |
| Backend boots, `GET /healthz` | 200 + expected JSON body; helmet security headers present |
| Unknown route | Canonical `{success:false,error:{code:'NOT_FOUND',…}}` envelope, not Express HTML |
| `X-Request-Id` | Well-formed inbound id echoed; malformed id replaced with a fresh UUID |
| Missing production secrets | Fails fast, exit 1, lists variable **names and rules only** |
| Invalid `PORT` | Fails fast with a clear message |
| Production boot with valid config | Starts; JSON logs verified to contain **no** secret values |
| Web install / typecheck / build | 0 vulnerabilities; `tsc --noEmit` clean; production build succeeds |
| Built app served | HTML, JS and CSS serve; bundle contains app markup; CSS contains exactly the Tailwind utilities used |
| Repo-wide `npm run lint` | Clean |
| Repo-wide `prettier --check` | Clean |

### Problems encountered and fixed
1. **Secret scanner's binary guard was wrong.** The written source contained a raw NUL control character instead of the `\0` escape, which made the file register as binary to grep/diff tooling. Rewritten using `String.fromCharCode(0)`; verified the file is now plain text and the guard behaves correctly.
2. **Web typecheck failed** — `vite.config.ts` uses `node:url` but `@types/node` was absent and `types` was pinned to `vite/client`. Added `@types/node` and included `node` in `tsconfig` types; build re-run and passes.

### Remaining limitations
- `backend/tests/` has no tests yet — the `test` script is wired but the first suites arrive with the auth TODO (P1-3).
- No database connection, no domain routes, no auth: all deliberately out of P0-3 scope.

---

## P0-3 verification pass 2 — browser render + real Gitleaks · 2026-08-12

Closed the two gaps left open in pass 1. Both are now genuinely verified; two security defects were found and fixed in the process.

### Browser verification — **PASS**
- **Method:** headless Google Chrome 
 (installed locally) driven against the Vite dev server at `http://localhost:5173`: `--dump-dom` for the post-JavaScript DOM, `--screenshot` for visual evidence, `--enable-logging=stderr --v=1` for console output. The Claude browser extension was unavailable, so Chrome was driven directly — this is a real runtime render, not an HTTP-level substitute.
- **Results:** React mounted (`<div id="root"><main…`); heading and placeholder copy present in the rendered DOM; Tailwind utility classes present and visually applied (screenshot shows centred layout, slate background, semibold heading — i.e. `min-h-screen`, `items-center`, `bg-slate-50` took effect); no blank page.
- **Console:** three INFO messages only (`[vite] connecting…`, `[vite] connected.`, React DevTools suggestion). **No errors, no uncaught exceptions, no failed loads.**
- **Network:** `/`, `/src/main.tsx`, `/src/App.tsx`, `/src/index.css`, `/@vite/client` all return 200.
- **Evidence:** screenshot written to the session scratchpad (`p0-3-web-render.png`) — deliberately not committed; it is verification evidence, not a project asset. Dev server stopped cleanly; Chrome profile and temp files removed.

### Gitleaks verification — **PASS**
- **Version:** gitleaks 8.30.1, installed via `winget install gitleaks.gitleaks` (official GitHub release; winget verified the installer hash). Registered on the user PATH, so `command -v gitleaks` in `.githooks/pre-commit` resolves in new shells. *Note: a shell started before the install (including the current agent session) has a stale PATH — tests below invoked the binary by absolute path to compensate.*
- **Config:** repo `.gitleaks.toml`, `useDefault = true` plus a minimal path allowlist.
- **Test A — clean scan:** `gitleaks detect --no-git --redact` over the full tree → *no leaks found*, exit 0 (~452 KB scanned).
- **Test B — planted fake secrets:** fixture containing a fake AWS key and a fake Google API key → *leaks found: 2*, exit 1. Fixture deleted; rescan returned to *no leaks found*.
- **Pre-commit blocking:** staged a file with a fake Google API key and ran `git commit` → **blocked**, value redacted, **no commit created** (count stayed at 1). Layer 2 verified independently against the same staged set: `gitleaks protect --staged` exits 1 on the leak and 0 when clean.
- **Cleanup confirmed:** no test fixtures on disk, nothing staged, still 1 commit, no test secret anywhere in the tree or index.

### Security defects found and fixed during this pass
1. **Over-broad allowlist regexes hid real findings (both layers).** `.gitleaks.toml` and `scan-staged-secrets.mjs` allowlisted any match containing "example". This suppressed AWS's own published test access key — Test B initially reported *no leaks* for a file full of fake credentials. A genuine credential containing that substring would have been hidden the same way. **Fix:** removed the broad value regexes entirely (verified the full tree still scans clean without them) and narrowed layer 1's placeholder rule to `<…>` / `your_` / `placeholder` / `changeme`. Re-tested: clean tree passes, planted keys are detected by both layers.
2. **Blanket `docs/` path allowlist in the Gitleaks config.** It excluded the largest body of text in the repo from layer 2. Verified the docs tree scans clean without it and removed the exclusion, so a credential pasted into documentation is now caught by both layers.
3. **Follow-on caught by the tightened rules:** the new scanner flagged AWS-key-shaped literals inside my own explanatory comments in `.gitleaks.toml` and `scan-staged-secrets.mjs`. Rather than adding allowlist exceptions, the comments were reworded so no credential-shaped literal exists anywhere in the repository.

### Regression after the fixes — all re-run, all PASS
Layer-1 scan (full tree) clean · Gitleaks staged scan clean · both layers still detect a planted key · ESLint clean · Prettier clean · web typecheck + build clean · backend boot + `/healthz` 200.

---

## P0-3 verification pass 3 — reappearing fixture file + detector hardening · 2026-08-12

### What happened
After pass 2 reported all test fixtures deleted, `GITLEAKS_TEST_FIXTURE.txt` was observed in the workspace again. Investigated before any commit.

**Timeline evidence:** file `created 13:28:45`, `modified 13:28:52` — roughly two minutes **after** the pass-2 scans completed at ~13:26. Those scans (Gitleaks working-tree + layer 1 over all 175 files) returned clean, which they could not have done had the file been present, so the pass-2 report was accurate when written and the file reappeared afterwards. **Its contents also differed from the fixture created during pass 2**, so it was not a resurrected copy of that file. The most likely causes are a stale editor buffer being written back to disk, or a deliberate re-creation to audit the gate; the evidence does not distinguish between them and no claim is made either way.

**Status:** the file was never tracked, never staged (outside deliberate scan tests), and never committed — verified by `git ls-files`, `git diff --cached`, and `git log --all --diff-filter=A`. It has been deleted and the tree re-verified.

### The genuinely important finding
When the reappeared file was staged and scanned, **both layers passed it** — and analysis showed two of its three lines were correctly ignored (an `xxxx…`-prefixed value that is not AWS-key-shaped, and a 35-character `AIza…` string, whereas real Google keys are 39). But the investigation exposed **two real detector gaps** in layer 1:

1. **Unquoted assignments were uncovered.** The generic rule required quotes around the value, so `.env` / `.ini` / `.yaml`-style `API_KEY=value` lines were only caught if the value matched a provider-specific pattern. Quotes are now optional.
2. **`\b` never matches inside snake_case names.** The rule anchored on `\baccess[_-]?key`, but underscore is a word character, so there is no boundary before `access` in `aws_access_key_id` — silently exempting that entire family of names. The leading `\b` was removed.

Additionally, the Google rule required the exact full key length (`AIza` + 35); it now matches `AIza` + 20 or more, so a truncated or partially-pasted key fragment is still blocked.

**Verified after hardening:** a three-line fixture (unquoted `aws_access_key_id=`, truncated `AIza…`, and `MY_TOKEN=`) is now caught on **all three lines**; the full 175-file staging set — including every doc and `.env.example` — produces **zero false positives**.

### Verification results (all re-run after deletion and hardening)
| Check | Result |
|---|---|
| Fixture file on disk | **NO** — deleted |
| Any `*fixture*` file in repo (excl. node_modules) | none |
| Any AWS/Google key-shaped content anywhere in repo | none |
| Tracked / staged / ever committed | 0 / 0 / 0 |
| Unreachable git objects | 0 (pruned again after test stagings) |
| Custom scanner, full staging set | clean |
| Gitleaks working tree | no leaks found |
| Gitleaks git history | no leaks found |
| ESLint / Prettier after scanner edits | clean |

**Real credentials involved: NO.** Every value used in every test throughout P0-3 was invented or a published non-functional documentation sample. No credential store, environment variable, or account was ever read.

### Operational note
A deleted file can return if an editor still holds its buffer. Close the tab for any deleted test file. This is precisely why the commit-time gate exists rather than relying on a one-off clean scan — and why the gate is now stronger than before this incident.

---

## P0-4 · Dataset acquisition — 2026-08-12 · Status: COMPLETED (verified)

**Scope:** download the approved source datasets, verify integrity, extract safely, capture licences, produce an inventory. No class census, deduplication, splitting, preprocessing or training — those remain P0-5 / P0-6 / Phase 4.

### Outcome: 6 datasets, 83,422 images, 16.3 GB, zero corrupt files in sampling

| Dataset | Images | Files | Decode | Checksum | Licence |
|---|---|---|---|---|---|
| plantvillage | 55,448 | 55,449 | 40/40 | ✅ publisher-matched | contested (see below) |
| plantdoc | 2,573 | 2,576 | 40/40 | local only (no publisher hash) | CC BY 4.0 |
| chilli_primary | 8,817 | 8,826 | 40/40 | ✅ publisher-matched | CC BY 4.0 |
| chilli_secondary | 1,515 | 1,526 | 40/40 | ✅ publisher-matched | CC BY 4.0 |
| cotton_sarcld2024 | 9,137 | 9,142 | 40/40 | ✅ publisher-matched | CC BY 4.0 |
| rice_odisha | 5,932 | 5,935 | 40/40 | ✅ publisher-matched | CC BY 4.0 |
| paddy_doctor_rice | — | — | — | — | **REJECTED** (no licence published) |

Final run re-verified every checksum and skipped every completed download/extraction, confirming **idempotency**.

### Files created / changed
Created: `scripts/ml/download_datasets.py`, `scripts/ml/dataset-sources.json`, `datasets/manifest-raw.json`, `datasets/licenses/{plantvillage,plantdoc,mendeley-chilli-cotton,rice-odisha}.md`.
Changed: `.gitignore` (un-ignore the licence records and manifest — they are the compliance evidence and must be committed), `docs/ml/dataset-research.md`, this log, `docs/development/MASTER-TODO.md`.

### Engineering decisions
1. **Explicit URLs + expected checksums in a declarative registry**, rather than API resolution. Mendeley's `public-api/datasets/{id}/files` returns 403 unauthenticated; explicit URLs also make provenance reviewable and integrity checkable.
2. **curl transport with automatic fallback.** Mendeley sits behind a Cloudflare bot challenge that rejects Python's TLS fingerprint regardless of User-Agent (403 "Just a moment..."); curl is served normally and brings resume/retry with it.
3. **Recursive nested extraction** (see findings) using the same traversal-safe extractor, with per-directory markers for idempotency.
4. **`py7zr` added** — an acquisition-time-only dependency (not part of the product). The Odisha rice data ships as `.7z` and is otherwise unreachable; no system 7-Zip is installed.
5. **macOS AppleDouble stubs excluded from inventory** — they are metadata, not data, and counting them silently doubled one dataset's apparent size.
6. **Paddy Doctor rejected, not quietly swapped.** Its registry entry is retained with both blockers documented so the decision is traceable.

### Problems found and fixed (each verified after fixing)
1. **Mendeley API 403** → switched to explicit publisher URLs.
2. **Windows cp1252 crash** on the script's Unicode output, mid-download → stream reconfiguration with `errors="replace"`.
3. **Cloudflare bot challenge** blocking all Python requests → curl transport.
4. **Windows-illegal filename** in PlantDoc (`IMG_1629.JPG?1507122477.jpg`, plus 86 others) aborted extraction after a successful 939 MB download → path-component sanitisation applied **after** the security checks, with every rename counted.
5. **Buffered stdout** hid all progress on multi-GB runs → `flush=True` on progress output.
6. **Nested archives left most data sealed** — cotton reported **0 images**, chilli_primary 2,053 of 8,817 → recursive extraction.
7. **`.7z` archive unsupported** → rice extracted 0 images → py7zr support with the same path-traversal validation.
8. **AppleDouble stubs counted as images** (3,030 apparent vs 1,515 real) → excluded, and the corrected count matches the publisher exactly.
9. **`chilli_secondary` download failed** at 60.2% with `curl: (56) Recv failure: Connection was reset` — an upstream network fault, not a tooling defect. Resumed from the intact `.part` on the follow-up pass.
10. **`--only` rewrote the manifest** with just the filtered datasets → resolved by running the full set last; noted so future partial runs are followed by a full run.

### Security verification
Before any real download: zip-slip rejected, absolute paths rejected, tar symlinks rejected, non-HTTPS refused, corrupt images surfaced not hidden. After adding sanitisation and 7z support, the traversal tests were **re-run and still pass** — safety checks execute against the original entry name, sanitisation only afterwards. Nothing downloaded is ever executed. Raw data and archives remain gitignored; only licences, the manifest and scripts are committable.

### Limitations / open items for P0-5
- **PlantVillage licence contested** (creators CC BY-SA 3.0 vs republication CC0 1.0); we comply with the strictest reading. Whether a trained model is a ShareAlike "adaptation" is unresolved and matters only for commercialisation.
- **Rice has no healthy class** — a product-level gap requiring an explicit audit decision.
- **PlantVillage includes `Background_without_leaves`** (~1,145 images) — keep or drop is an audit decision.
- **Cotton mixes original and augmented** images in one release; augmented data must never enter val/test.
- Earlier planning recorded a chilli set as CC BY-NC; **verification shows all three Mendeley sets are CC BY 4.0** with no NC or SA clause. ADR-012's swap-before-commercialisation obligation does not apply to them.

### What comes next
Next recommended TODO is proposed separately for approval. Nothing beyond P0-3 was implemented.
