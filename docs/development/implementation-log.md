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

---

## P0-5 · Dataset audit — 2026-08-12 · Status: COMPLETED (verified)

**Scope:** measure and report — class census, duplicate/leakage analysis, quality sampling, cotton OD-1 gate evaluation. Explicitly NOT in scope and NOT done: no dedup removal, no splitting, no preprocessing, no training, no registry edits. Full results: `docs/ml/dataset-audit.md`; machine-readable: `datasets/audit-report.json`.

### Outcome: 83,421 images audited, 0 decode failures

| Finding | Value |
|---|---|
| Exact byte-identical redundancy | 2,502 groups / 2,830 redundant copies |
| Verified near-duplicate redundancy | 5,048 clusters / 9,021 images (10.8%) |
| **rice_odisha usable size** | **2,446 of 5,932 (−59%)** |
| Cross-dataset duplicate clusters | **0** — PlantDoc field test is not contaminated by PlantVillage |
| PlantDoc train↔test leakage | 11 byte-identical groups, **8 with conflicting labels** |
| Cotton OD-1 mechanical verdict | **PASS** — 6 of **7** classes ≥150 (plan assumed 8 classes) |
| In-scope class codes with data | 36; imbalance 36:1; smallest `POTATO_HEALTHY` = 152 |

### Files created / changed
Created: `scripts/ml/audit-datasets.py`, `datasets/audit-report.json`.
Changed: `docs/ml/dataset-audit.md` (plan → plan + results), `.gitignore` (un-ignore the audit report; `datasets/audit/` stays ignored), `docs/security/dependency-security.md` (numpy justification), `datasets/README.md` (stale script name and the already-corrected CC BY-NC claim), this log, `docs/development/MASTER-TODO.md`.

### Engineering decisions
1. **pHash for candidates, pixel correlation for verdicts.** pHash alone was measurably unusable here — see below. Candidates are verified by 64×64 normalised cross-correlation at a calibrated 0.95 cut before any cluster forms.
2. **Exact all-pairs search, not an approximate index.** 83k² Hamming distances via BLAS (`A@(1-B)ᵀ + (1-A)@Bᵀ`) in row chunks, so no qualifying pair can be missed. Runs in ~90 s.
3. **Explicit layout registry.** The extracted trees are irregular (doubled directory names, per-variant subtrees); containers are declared and a missing one is a hard error rather than a silent zero — the P0-4 lesson where cotton reported 0 images.
4. **No new dependency for hashing.** pHash is implemented directly against Pillow rather than adding `imagehash`; `numpy` is the only addition and is already transitively required by the committed training stack.
5. **Thumbnails in a binary sidecar, not base64 JSON** (~340 MB vs ~460 MB, and mmap-able).
6. **Contact sheets deliberately not committed** — 11 MB of derived image data, regenerable; the report and the JSON are the evidence.

### Problems found and fixed (each verified after fixing)
1. **pHash over-merged catastrophically** — the first run produced a single 14,367-image cluster spanning all six datasets, claiming chilli duplicates soybean. Cause: low-texture leaf-on-plain-background images collide in hash space and union-find chains them. Fixed by adding pixel verification; cross-dataset clusters fell 303 → 55 → **0**.
2. **The first verification cut was still too loose.** At 16×16/0.90, silhouette look-alikes (an apple leaf and a chilli cut-out) scored 0.90–0.93 and survived. Calibrated empirically instead of guessed: at 64×64, known-different candidates top out at 0.895 while re-encode/rescale/brightness duplicates stay above 0.979 → cut set to 0.95. 83.6% of candidates are now rejected.
3. **Stale cache silently reported as decode failures** — records written under the previous schema lacked thumbnails and were counted as errors instead of being re-probed. Fixed to treat schema drift as staleness.
4. **Union-find chaining hides its own artifacts** — added a cluster-size histogram and largest-cluster descriptors so collapse driven by chaining is visible rather than buried in a single "redundant images" number.
5. **`--only` rewrote the report with a single dataset**, exactly as it did in P0-4 — caught during final verification. The flag now warns loudly that cross-dataset analysis is meaningless in a partial run, and the full report was regenerated.

### Verification performed
| Check | Result |
|---|---|
| Positive control: byte-identical pairs | min NCC **1.000** (metric is sound) |
| Synthetic positives: JPEG q70 / 80% rescale / brightness ×1.15 | min NCC **≥0.979** (real duplicates survive the cut) |
| Hard negatives: pHash candidates that are visibly different crops | max NCC **0.895** (they do not) |
| 20,000 random pairs | mean 0.094, p99 0.626, **0** above the cut |
| Exact-duplicate claim cross-checked with an independent tool | `sha256sum` confirms the reported groups |
| Surviving cross-label pairs are agronomically plausible | cotton curl↔healthy, potato early↔late blight, maize GLS↔NLB — corroborates the cut |
| Repo lint + format | clean |
| Idempotency | second run reuses the cache and reproduces identical counts |
| Nothing outside scope touched | no image moved/deleted; registry, splits and training code untouched |

### Limitations (stated, not worked around)
- **Rotated, mirrored and >5%-cropped copies are undetectable** by this method. Cotton's augmented split must be excluded from val/test wholesale rather than trusted to dedup — only 4,114 of 7,000 augmented images link back to an original.
- **Label-error rate is not measured.** 24 of 73 contact sheets were reviewed visually by Claude, who is not an agronomist; the cotton gate's <10% criterion needs human sign-off.
- **Quality findings are observations, not verdicts** — notably `chilli_primary/Bacterial_Spot` looking heterogeneous.

### Decisions handed to the team (not pre-empted)
Cotton OD-1 · rice healthy class · `Background_without_leaves` keep/drop · chilli studio-only domain gap and whether the two chilli sets may be merged · PlantDoc cleaning · rice's real usable size · `POTATO_HEALTHY` at 152 vs the healthy-recall ship gate. Detail and options: `docs/ml/dataset-audit.md`.

### What comes next
Nothing was committed or pushed. Next TODO proposed separately for approval.

---

## P0-5b · Rice healthy acquisition — 2026-08-12 · Status: COMPLETED (one verification condition failed — see below)

**Why this ran before P0-6:** ADR-021 decision 2 (approved) adds `RICE_NORMAL` to the class map, and `prepare-datasets.py` encodes the class map into splits. Building splits first would have meant rebuilding them immediately. All seven ADR-021 decisions were approved by the team before this ran.

**Scope:** acquire and verify one dataset. No preprocessing, no splits, no training, no raw data modified or deleted.

### Outcome
`rice_healthy_diu` — Mendeley `g7tcwvshff` v1 (Labib, Mim & Mojumdar, Daffodil International University, Bangladesh), **CC BY 4.0**, 10,766 images, 948.9 MB.

| Check | Result |
|---|---|
| Licence read from the publisher's licence object | ✅ CC BY 4.0, no NC/SA |
| Publisher-published sha256 + byte size matched | ✅ `e4cc1f4b…`, 976,965,280 B |
| Published per-class counts reproduce | ✅ exactly — raw 2,508 / augmented 8,258 |
| Decode integrity | ✅ 0 failures |
| No duplication against `rice_odisha` | ✅ **0 cross-dataset clusters** |
| Internal redundancy | ✅ 341 of 10,766 (3.2%) |
| Whole corpus re-verified | ✅ 7 datasets, 94,187 images, 0 decode failures |
| **Healthy images field-realistic** | ❌ **FAILED — detached leaves on white paper** |

`RICE_NORMAL` now exists at **582** usable images (raw-only, deduplicated); usable rice rises from 2,446 to **4,058** across 5 classes.

### Files created / changed
Created: `datasets/licenses/rice-healthy-diu.md`.
Changed: `scripts/ml/dataset-sources.json` (new entry), `scripts/ml/audit-datasets.py` (`class_subdirs` layout support + class map), `datasets/manifest-raw.json` + `datasets/audit-report.json` (regenerated), `docs/decisions/ADR-021-…` (verification outcome), `docs/ml/dataset-audit.md` (addendum), `docs/ml/dataset-research.md`, `datasets/licenses/rice-odisha.md`, this log, `MASTER-TODO.md`.

### Engineering decisions
1. **Registered from the publisher's own sha256 and size**, discovered at `public-api/datasets/{id}/files?folder_id=root&version=1`. P0-4 recorded this endpoint as 403-only; it needs `folder_id=root`. This makes integrity a real check against the publisher rather than a self-consistency test, and is now the preferred registration route for Mendeley sources.
2. **`class_subdirs` added to the audit layout registry.** This publisher inverts the usual nesting — class first, then `orginal`/`augmented` inside it — so the group is selected within the class. A class missing all declared subdirectories is a hard error, consistent with the existing refusal to report a partial census.
3. **Publisher's misspelling `orginal` reproduced verbatim** rather than "corrected"; the healthy class uses `aug` where others use `augmented`, and both are declared.
4. **The `Rice` class (584 post-dedup) is left unmapped** — it is a whole-plant category, not a condition, and guessing it into a class code would be fabrication.

### Problems found
1. **The dataset is studio imagery, not field imagery** — the condition ADR-021 set for its own use. Detached leaves on white paper, the `chilli_secondary` pattern. The mitigation that motivated choosing this source did hold (the same campaign supplies healthy *and* three diseases, so background alone does not separate them), but `RICE_NORMAL` is now the only rice class with **zero** field-realistic examples. Escalated to the team; options recorded in ADR-021.
2. **0 original↔augmented duplicate clusters reported, while the publisher states the augmented images are derived from the raw ones.** This is the rotation/mirror blind spot documented in P0-5, observed in the wild — cotton showed 1,398 spanning clusters, this shows none. Recorded so nobody reads it as independence: **the raw-only rule is enforced by construction, not by trusting a dedup result.**
3. **Aggregated class counts in the report include augmented images** for cotton and DIU rice. Noted in the audit doc; per-group `dedup_counts_by_class` is the figure to use.

### Verification performed
Full 7-dataset audit re-run (94,187 images, 0 decode failures, 0 cross-dataset clusters); all six previously acquired archives re-checksummed `ok`; contact sheets regenerated and the healthy/tungro sheets reviewed visually; `--only` partial-report warning fired correctly and the full run was re-issued; repo lint + format clean; no file under `datasets/raw/` modified or deleted.

### What comes next
**Blocked on a team decision** — ADR-021 decision 2 is only partially satisfied. Nothing committed or pushed.

---

## P0-6 · Dataset preparation — 2026-08-12 · Status: COMPLETED (verified)

**Scope:** turn the approved ADR-021 decisions into machine-readable rules and a reproducible split manifest. **No training, no preprocessing, no image copying, nothing under `datasets/raw/` modified or deleted.** Team chose option (c) for rice: train on the studio healthy data, hold rice at GENERAL, never claim field robustness for healthy rice, and treat future field healthy data as evaluation-only.

### Outcome

| | |
|---|---|
| Enumerated | 94,187 |
| Kept (unique, in scope) | **39,960** |
| Train / val / test | **27,009 / 5,811 / 5,876** |
| Field test (PlantDoc, never trained on) | **1,264** |
| Excluded, every one with a reason | 54,227 |
| Classes | 36, all clearing the ≥50 test floor |

Exclusions by rule: unmapped classes 31,956 · rice-DIU augmented 8,258 · cotton augmented 7,000 · duplicate collapse 5,593 · `Background_without_leaves` 1,143 · label contradictions 146 · stock-provenance quarantine 15 · `COTTON_LEAF_VARIEGATION` 116.

### Files created / changed
Created: `scripts/ml/prepare-datasets.py`, `scripts/ml/curation-rules.json`, `datasets/manifest.json`, `datasets/splits/` (gitignored: `{train,val,test,fieldtest}.tsv`, `quarantine.tsv`, `exclusions.json`).
Changed: `docs/ml/dataset-preparation.md`, `docs/decisions/ADR-021-…` (second finding), this log, `MASTER-TODO.md`.

### Engineering decisions
1. **Rules are data, not code.** `curation-rules.json` carries each rule *with the decision it implements and the reason it exists*, so any excluded image traces back to a human decision. Changing a decision means editing a rule and re-running, not editing logic.
2. **Manifest instead of copying** (documented deviation from the original plan, which called for `datasets/prepared/<classCode>/`). Copying would duplicate several GB and create a second copy that can drift; referencing raw paths keeps one copy and preserves provenance. Preprocessing stays in the train-time transform, where it already had to exist.
3. **The audit's own code is imported, not reimplemented.** If the splits used a second definition of "near-duplicate", the leakage guarantee would only hold for whichever definition matched.
4. **Duplicates collapse to one representative.** Without this the manifest counts files, not distinct images: rice (59% redundant) would be silently up-weighted against PlantVillage (0.07%), and a test set would score the same photograph several times. This is what makes the approved "rice = 2,446 usable" figure true of the splits and not just of a report.
5. **Allocation, never gate-lowering.** Classes whose 15% test share missed the 50-image floor get a larger test fraction (capped at 40%); six classes needed it — `POTATO_HEALTHY`, `CHILLI_ANTHRACNOSE` and four cotton classes.
6. **Split lists are derived artifacts.** The committed manifest is 14 KB and reviewable; the member lists (and the 30 MB exclusion log) are gitignored and exactly regenerable, with a SHA-256 per list as the contract.

### Problems found and fixed
1. **The first implementation kept duplicate copies in the splits**, so class counts were file counts (e.g. `RICE_BROWN_SPOT` 1,600 instead of 606) — directly contradicting the "2,446 unique" figure the team had approved. Fixed by collapsing clusters to one representative; counts now match the audit's unique figures exactly.
2. **59 label contradictions inside the newly acquired rice healthy class.** Byte-identical photographs filed under *both* `Healthy _leaf` and `Tungro`, all in the raw tree approved for training — 7.7% of raw healthy, 19.8% of raw tungro, same camera timestamps, consistent with a directory copied during dataset assembly. The quarantine rule catches every copy (`RICE_NORMAL` = 549, not 582), but it is material evidence about that publisher's label quality and is recorded in ADR-021 for the team.

### Verification performed
| Check | Result |
|---|---|
| No duplicate cluster spans two splits | ✔ asserted, 38,696 clusters |
| Field test disjoint from train/val at cluster level | ✔ asserted |
| Field test disjoint from every split by path | ✔ asserted |
| Every class ≥50 test images | ✔ 36/36, `classes_below_min_test: []` |
| Class counts match the P0-5 unique figures | ✔ e.g. CHILLI_CERCOSPORA 1,997 · POTATO_HEALTHY 152 · RICE_BROWN_SPOT 606 |
| **Reproducibility** | ✔ re-ran end to end: all four split SHA-256s identical, only `generated_at` differed |
| Raw corpus untouched | ✔ 0 files modified or deleted under `datasets/raw/` |
| Repo lint + format | ✔ clean |

### Limitations (unchanged, restated where they now bite)
- Stock-image quarantine is **filename evidence only** (15 images). Pixel-burned watermarks with neutral filenames are not caught — the audit saw such cases visually. The human review queue remains outstanding for the 1,264-image field test set.
- `RICE_NORMAL` is 100% studio imagery; healthy-rice field performance is **unvalidated and must not be claimed**.
- The merged chilli label space is not trusted until the source-separability probe runs; both `pre_training_checks_required` entries are carried in the manifest so training cannot quietly skip them.
- Rotated/mirrored publisher augmentations remain undetectable; augmented groups are excluded **by construction**, never by trusting a dedup result.

### What comes next
Nothing committed or pushed — diff shown for review. Training remains gated on the two `pre_training_checks_required` items and the outstanding human review queue.

---

## P0-6b · Pre-training gates resolved — 2026-08-13 · Status: COMPLETED (verified)

The three items P0-6 could only report are now investigated and fixed. Still no training, no raw data touched.

### 1. Source/background confound — measured, then contained
New `scripts/ml/probe-confounds.py`. **Trains nothing:** separability is measured with a fixed background statistic (mean/std of the outer ring of the cached 64×64 thumbnail) plus an exhaustive threshold sweep, so the number is a *lower bound* — a learned model does at least as well.

| Crop | Source separability | Source-disjoint class pairs | Confounded |
|---|---|---|---|
| CHILLI | **0.91** | 3 (all involving `ANTHRACNOSE`) | **YES** |
| RICE | **0.96** | 1 (`RICE_NORMAL` vs `RICE_BROWN_SPOT`) | **YES** |
| TOMATO / POTATO / MAIZE | 0.96 / 0.95 / 0.91 | none | no |
| COTTON | single source | none | no |

Tomato/potato/maize being separable but *not* confounded is the design working: PlantDoc is field-test-only and every class exists in both sources.

**Fixed:** source-stratified splits (each (class, source) stratum split independently — verified: chilli cercospora is 1142/245/244 primary and 256/55/55 secondary), per-class source composition and split balance in the manifest, and `known_confounds` with a mandatory evaluation gate per confound. Not removable with this corpus; excluding `CHILLI_ANTHRACNOSE` would remove chilli's disjointness outright but costs a disease class, so it is left as a product decision.

### 2. Healthy-rice field caveat — no acquisition needed, gate encoded
Training is not blocked (`RICE_NORMAL` = 549); only *claims* are, and no quantity of studio data fixes that. Acquiring more now would also violate approved option (c), which reserves field-realistic healthy rice for evaluation unless separately approved for training. Encoded instead: GENERAL tier, `pre_training_checks_required` entry, manifest limitation, and a gate requiring the `RICE_NORMAL ↔ RICE_BROWN_SPOT` confusion cell to be reported explicitly — with the warning that unusually high `RICE_NORMAL` recall is evidence of the shortcut, not skill.

### 3. Field-test review — objective rules applied, remainder scoped
New `scripts/ml/review-fieldtest.py` renders every field-test image into numbered sheets with an index, so a flagged cell resolves to an exact path. **31 images quarantined after direct visual inspection**, each recorded in `scripts/ml/manual-quarantine.json` with evidence, category, reviewer and sheet cell: 18 stock watermarks (Alamy, Dreamstime, Shutterstock, Colourbox, photobucket, Minden), 8 composite figures, 4 non-photographs (a web factsheet screenshot, a bullet-point slide, a line illustration, a conference poster), 1 photograph of chopped herbs. Nothing deleted; no label reassigned.

**`TOMATO_SPIDER_MITES` has no usable field test** — its entire field-test set was 2 images and both are disease-comparison figures (filenames `SpotSpeckBlightMite-…` and `comparing-diseases-4-canker-tomato-…` corroborate). After quarantine: zero. Its lab-to-field gap is unmeasurable and must be reported as such.

**Coverage stated honestly: 209 of 1,264 reviewed (16.5%).** Sheets are path-ordered, so "sheet 00" is a class's first 30 images, not a random sample. The manifest carries this so no field-test number can be published without it.

### Validation re-run (all green)
| Check | Result |
|---|---|
| No duplicate cluster spans splits | ✔ 38,696 clusters |
| Field test disjoint from train/val (cluster + path) | ✔ |
| Every class ≥50 test images | ✔ 36/36, smallest is `CHILLI_ANTHRACNOSE` at exactly 50 |
| Class counts match P0-5 unique figures | ✔ |
| **Reproducibility** | ✔ re-ran: all four split hashes identical, only `generated_at` differed |
| Exclusions traceable | ✔ 54,258 across 9 rules, each naming its decision |
| Raw untouched, generated data gitignored | ✔ 0 files under `datasets/raw`/`_archives` changed |

Totals: 39,929 kept → train 27,009 / val 5,811 / test 5,876 / fieldtest **1,233**.

### Files created / changed
Created: `scripts/ml/probe-confounds.py`, `scripts/ml/review-fieldtest.py`, `scripts/ml/manual-quarantine.json`, `datasets/confound-report.json`.
Changed: `scripts/ml/curation-rules.json` (`known_confounds`, `source_stratified_splits`, manual-quarantine hook), `scripts/ml/prepare-datasets.py` (source stratification, manual quarantine, confound reporting), `.gitignore` (un-ignore the confound report — it is decision evidence), `docs/decisions/ADR-021-…`, `docs/ml/dataset-preparation.md`, this log, `MASTER-TODO.md`.

### Boundaries respected — left to human judgement, not guessed
Whether author-credited images (©T.A. Zitter, ©D. Maeso, university-extension marks) belong in a published benchmark · whether a photographed plant is the labelled species · every agronomic label question including cotton items (a)–(c) · whether to drop `CHILLI_ANTHRACNOSE` · whether to acquire field healthy rice **for training**.

---

## P1-1..P1-8 · Backend foundation — 2026-08-13 · Status: COMPLETED (verified, team-approved)

**Scope implemented:** Express foundation hardening, 14 Mongoose models with asserted indexes, the full authentication lifecycle, the ownership layer, Farms and Crops CRUD, the crop registry with a sourced knowledge base and versioned seed, the pure stage-derivation engine, and the security review + deployment configuration. The Render deploy itself is an external setup item, not a Phase-1 code gap — see P1-8 below.

**Verification:** `cd backend && npm test` → **235 tests, 235 pass, 0 fail**. Repo `npm run lint` clean · `prettier --check` clean · web `tsc --noEmit` clean · `npm audit` (with and without dev) **0 vulnerabilities** · `gitleaks detect` over the full tree **no leaks found** · `scripts/smoke.mjs` **18/18** against a local `NODE_ENV=production` server backed by a real database.

### Security gates
| Suite | Asserts | Result |
|---|---|---|
| **ST-50** API hygiene | forced-500 leaks no stack/message/path, unknown-route envelope, foreign origin denied CORS, credentials only on the auth path, rate-limit headers, 413 on oversized body, 422 on malformed JSON, correlation id, hardened headers | ✔ 9/9 |
| **ST-01..05** Auth | 6th login 429 keyed on IP+email (a different account from the same IP is unaffected), byte-identical 401 for unknown-email vs wrong-password **plus a timing-ratio assertion**, bcrypt cost 12, httpOnly path-scoped cookie, hash-at-rest, rotation chain, **replay → whole-family revocation + `token_reuse` audit**, other families untouched, idempotent logout, JWT tamper/alg-none/wrong-secret/expired/wrong-audience/wrong-issuer/malformed-header/deleted-user | ✔ 21/21 |
| **ST-10** Authorization matrix | generated from the route table: 401 anonymous, 404 for another farmer's resource, 404 indistinguishable from non-existent, 404 for malformed id with no cast-error leak, 401 tampered token, nested chain (crop via another's farm), list scoping, client-supplied `userId` cannot claim ownership, and every table row is actually mounted | ✔ 27/27 |

### Engineering decisions
1. **`node:test`, not Jest** (ADR-022) — the docs specified Jest but the shipped scaffold wired `node --test`, and no ADR recorded it. Resolved toward the code: ESM-native under ADR-019, and it adds zero framework dependencies to a locked list. Supertest replaced by real HTTP over an ephemeral port; `mongodb-memory-server` retained because index/uniqueness/TTL behaviour is server behaviour and a mock would prove nothing.
2. **14 models, not 12** — `docs/database/schema.md` and the plan spec both name 14 collections; only `MASTER-TODO` said 12. Built all 14; `communityAlerts` (P2) and `yieldEstimates` (P3) carry schemas and take no writes.
3. **`PAYLOAD_TOO_LARGE` (413) and `NOT_IMPLEMENTED` (501) added to the error catalogue** — ST-50 requires a 413 that no code covered, so body-parser errors were surfacing as 500. `entity.parse.failed` now maps to 422.
4. **Hand-written Mongo sanitizer** — the locked `express-mongo-sanitize` throws on Express 5 (`req.query` is getter-only). `docs/database/validation.md` already anticipated this ("sanitize-v5"). ~30 lines we control, non-mutating.
5. **`iss`/`aud` added to the JWT claim set and verified** — ST-05 calls for an audience test that the documented `{sub,jti,iat,exp}` claim set could not satisfy. Neither claim carries PII or roles.
6. **CORS credentials scoped to `/api/v1/auth`** — the code granted them globally; the docs say "credentials on auth path only".
7. **`CORS_ORIGINS` required in production; `MONGODB_URI` scheme-checked** — the origin list previously defaulted to localhost in every environment, so a forgotten variable would have deployed a silently broken allowlist.
8. **Refresh reuse distinguishes first detection from a dead family** — replaying an already-rotated token revokes the family and audits `token_reuse`; presenting a token from a family that is *already* dead returns the same 401 but does **not** re-audit. Found by a failing test: the naive version fired `token_reuse` on every retry, flooding the exact metric the threat model uses to detect theft.
9. **Registry seed validates every document before writing any** — ADR-002 rules out transactions, so a document that failed validation halfway through left a partly-applied registry (observed: 3 of 10 written, no seedMeta row). Now it fails before the first write and the collection stays on its last good state.
10. **`bcrypt` upgraded 5 → 6** — v5 pulls `@mapbox/node-pre-gyp` → `tar` with 2 high and 1 critical advisory; the dependency policy requires high/critical to be upgraded.

### Crop registry — sourcing
FAO-56 values were transcribed from the published tables (`x0490e0b.htm` Tables 11/12, `x0490e0e.htm` Table 22) cell-by-cell from raw HTML, because the summarised rendering corrupted values (wheat `0.25-0.4` plus footnote marker `10` became `0.25-0.41`, and Kc_ini vanished for 8 of 9 crops). Every number carries `{org,title,url,accessed,confidence}`.

**Recorded gaps — absent, never invented:** `soilSuitability` 0–3 scores for 8 of 9 crops (the source gives prose, not scores) · potato `tempOpt` (published as two stage-specific figures, not a range) · `durationDays` for all crops · per-crop weather `sensitivity` thresholds · disease KB entries for all 35 ML classes (blocks *model ship*, not Phase 1). Each is carried in the document's `dataGaps` and printed by the seed.

**Two findings that affect Phase 2, flagged now:**
- **Chilli has no FAO-56 entry at all.** Its Kc curve is proxied from `Sweet peppers (bell)` and marked `isProxy: true`. Irrigation advice for chilli rests on a bell-pepper curve until reviewed.
- **Rice `p = 0.20` is a fraction *of saturation*** (Table 22 footnote 4), not of TAW like the other eight. The standard `RAW = p × TAW` formula is wrong for rice — the irrigation engine must special-case it via `paddyFlooding`.

Also noted for the fertilizer TODO: `totalNpk` for tomato/chilli/onion is the **basal** dose, not a season total — the sources publish no sum and none was computed.

### Adversarial security review — findings and fixes

An independent review executed live probes against a running instance (in-memory mongod, real HTTP). **No critical finding.** Ownership enforcement, JWT verification, enumeration uniformity, `$`-operator filtering, prototype-pollution resistance and log redaction all held under direct attack. Every issue below is fixed, and each carries a regression test that fails against the old code.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **HIGH** | **Refresh rotation was not atomic.** Read-then-write: two concurrent presentations of one token both passed the `revokedAt` check, yielding two live lineages and **zero `token_reuse` audits** — defeating the exact control ST-04 exists to prove. Sequential tests passed; the race did not. | Rotation now claims the token with `findOneAndUpdate({tokenHash, revokedAt:{$exists:false}})` — the revoke *is* the guard, so exactly one concurrent request can win. Deliberate trade-off recorded: revoking before minting the successor means a crash mid-rotation logs the client out, which is the correct direction. Test: two `Promise.all` refreshes → `[200, 401]`, family revoked, exactly one audit row. |
| 2 | **HIGH** | **`X-Forwarded-For` reset the login and global buckets.** `trust proxy: 1` makes `req.ip` header-derived; rotating the header gave unlimited login attempts and also let an attacker choose the IP written to their own `auditLogs` and `refreshTokens` rows. Correct behind Render (which appends the real peer) but wide open anywhere without exactly one hop — including `npm run dev`. | `trust proxy` is now `1` only in production and `false` elsewhere, so outside production the socket address is authoritative. Test: 8 logins with rotating `X-Forwarded-For` still trip the bucket. |
| 3 | MEDIUM | **The 12-crop cap was not enforced.** `assertFarmHasCapacity` counted only `active` and ran only on create; a future sowing date yields `planned` (uncounted), and `PATCH {status:'active'}` never re-checked. 30 active crops on one farm were demonstrated. Harvest churn gave a second, unbounded bypass. | The count now includes `planned`, and the check re-runs on any transition into `active` (excluding the crop being promoted). Test covers both paths. |
| 4 | MEDIUM | **Unauthenticated 500 from a malformed refresh cookie.** `rt=%` made `decodeURIComponent` throw; the client envelope was clean, but each request wrote a full stack trace with absolute paths at ERROR level — an anonymous log-flood and 5xx-rate inflator. | The decode is guarded; an undecodable cookie is simply not a token → 401. Test covers three malformed escapes. |
| 5 | MEDIUM | **Unbounded `User-Agent` persisted** on every refresh-token row and every failed-login audit row (6000 chars demonstrated) — a cheap path to filling a 512MB M0 cluster. | New `utils/clientContext.js` truncates to `MAX_STORED_USER_AGENT` (256) at the single point both call sites use. Test asserts the bound. |
| 6 | MEDIUM | **`rate_limited` audit events were never written.** `attachAudit` was exported and never imported, so `req.recordAudit` was always undefined and the optional call silently no-opped. Only attempts *below* the threshold were audited; every trip past it was invisible — backwards for a brute-force signal. | Dead helper removed; the limiter records through `auditService` directly. Test asserts rows exist after tripping the bucket. |
| 7 | LOW | Crop cascade delete filtered on `cropId` alone, unlike the farm cascade. Not exploitable today (no endpoint writes those collections yet) but becomes a cross-user delete as soon as one accepts a client-named `cropId`. | `userId` added to every cascade filter. |
| 8 | LOW | `mongoSanitize` called `scrub(req.params)`, but it is app-level middleware so `req.params` is always `{}` — the documented defence did not exist. | The call is removed and the comment now states the truth: path params are guarded by `loadOwned`'s ObjectId check before any query. |
| 9 | LOW | The sanitizer's depth cap **abandoned** the subtree, leaving an operator nested past 12 levels untouched while the request appeared sanitized. | An over-deep body is now rejected outright (422) rather than partially cleaned. |
| 10 | LOW | `scrubMeta` converted arrays to objects (`Object.entries([a,b])` → `{0:a,1:b}`) and its denylist missed several key spellings. | Arrays handled explicitly, depth-bounded, denylist extended (`set-cookie`, `apiKey`, `x-service-key`, `sessionId`, snake_case token forms). |
| 11 | INFO | Nested crop routes ran `requireAuth` twice (two `User.findById` per request) because the farms router matched the shared prefix first. | Crops router mounted before the farms router. |

**Verified safe under direct attack** (attempted and failed): cross-user access on every addressable route · client-asserted ownership via body `userId` · `$`-operator and dotted-key injection through body and query · prototype pollution · login-bucket evasion by email case/whitespace/IPv6/field-shuffling · JWT `alg:none`, wrong secret, wrong `iss`/`aud`, expiry, tampering, deleted user · account enumeration by status, body or timing · CSRF against the cookie-authenticated refresh route · credential leakage into a 15.8KB captured log stream (password, raw refresh token, its sha256 and the access token appear zero times) · error disclosure on forced 500 · hardcoded secrets or dev bypasses.

One nuance worth carrying forward: CSRF protection on `/auth/refresh` currently works *incidentally* — a cross-site form POST fails because `express.json` will not parse it, so validation rejects the body before the handler. An explicit `Origin` / `Sec-Fetch-Site` check would make that deliberate. Logged for Phase 7 hardening rather than changed now.

### Deliberately not done
- **~21 LIMITED crops proposed, not seeded.** The roster is a product decision; the seed only includes it once `crops.limited.proposal.json` carries an `APPROVED` status. 5 of the 21 have no sourced Hindi name.
- **No `shared/constants/geo`** — farm `state`/`district` validate as trimmed strings, not the canonical list, because that list does not exist and inventing one would fabricate data.
- **No weather fetch on farm create.** `docs/api/farms.md` mentions an immediate on-demand fetch; that violates the DB-first rule and belongs to the Phase-2 job.
- **No ML work of any kind.** `datasets/` is untouched; the registry only *reads* `manifest.json` for class codes.

### Files
Created: `backend/src/config/{constants,db}.js`, `middleware/{sanitize,rateLimits,validate,requireAuth,loadOwned}.js`, `models/` (15 files), `services/{tokenService,authService,auditService,farmService,cropService,registrySeedService,registrySeedRunner}.js`, `routes/{auth,farms,crops,registry,ownership-table}.js`, `utils/{respond,locationKey}.js`, `engines/stage/deriveStage.js`, `knowledge/{crops.agronomy,crops.base,crops.fertilizer,crops.limited.proposal}.json` plus `README.md`, `scripts/{build-indexes,seed-registry,smoke}.mjs`, `tests/` (11 files), `shared/i18n/{en,hi}/{errors,auth,farm,crop}.json`, `render.yaml`, `docs/security/route-ownership.md`, `docs/decisions/ADR-022-node-test-runner.md`.
Changed: `backend/src/{app,server}.js`, `config/env.js`, `utils/{logger,errors}.js`, `middleware/errorHandler.js`, `routes/health.js`, `backend/package.json`, `eslint.config.js`, `docs/api/error-codes.md`, `docs/testing/{strategy,api-testing}.md`, `docs/security/security-testing.md`, `docs/deployment/{environment,backend}.md`, `docs/backend/architecture.md`, this log, `MASTER-TODO.md`.

### P1-8 — review pass complete; deploy is an external item
The **review pass is complete** (findings and fixes tabled above) and the **deployment configuration is delivered and locally verified**: `render.yaml` with every secret marked `sync: false`, the staging variable checklist in `docs/deployment/environment.md`, and `backend/scripts/smoke.mjs` (18/18 against a local production-mode server with a real database).

**Not done, and not claimed:** the Render deploy itself. No Render account exists — the Phase-0 accounts task is still open — so creating the service, setting the dashboard variables and verifying staging `/healthz` remain external setup items owned by A, tracked in the Phase-0 accounts row and the Phase 8 deploy sequence. Phase 1's *code* has no gap here.


### Phase 1 finalization — 2026-08-13

Phase 1 approved COMPLETE (P1-1..P1-8) by the team. Final gate re-run at sign-off: **235 backend tests / 235 pass / 0 fail / 0 cancelled** across 23 suites; repo lint clean; `prettier --check` clean; web `tsc --noEmit` clean; `npm audit` **0 vulnerabilities** with and without dev; layer-1 staged-secret scanner clean; `gitleaks protect --staged` and `gitleaks detect` over the full tree both report no leaks.

Committed alongside the code: `.claude/settings.json`, an approved project permission policy. It auto-approves routine development commands (repo file operations, npm/node scripts, tests, lint/format/typecheck, read-only git, shell inspection, the secret scanners, localhost smoke requests and read-only fetches of the project's documented data sources) while keeping publishing, history-rewriting, destructive, credential and arbitrary-egress operations behind an explicit prompt. Two pre-existing defects in the local settings were corrected in the same pass: `git commit`/`git push`/`git reset` had been auto-approved, and three entries embedded a live data.gov.in API key — all removed. Writes to `datasets/**` and reads of `.env`/`*.pem`/`*.key` are denied outright.

**No ML work was performed.** `datasets/` is byte-for-byte untouched; the curated manifest, curation rules and class decisions from P0-6/P0-6b are unchanged. The crop registry only *reads* `datasets/manifest.json` for class codes and support tiers.

---

## PHASE 2 — Data pipelines & engines (P2-1..P2-9) — 2026-08-13

**930 backend tests / 930 pass / 0 fail** across 177 suites (Phase 1 finished at 235). Repo lint clean · `prettier --check` clean · web `tsc --noEmit` clean · `npm audit --omit=dev` **0 vulnerabilities** · layer-1 staged-secret scanner clean · `gitleaks detect` over the full 470MB tree reports no leaks. **No new runtime dependency was added** — the scheduler, HTTP client, retry/jitter and circuit breaker are written against Node 20 built-ins, so even `node-cron` (which the dependency policy pre-approves) was not needed.

### What the analysis found before any code was written

Six parallel doc-analysis passes reconciled the Phase-2 specification against the shipped Phase-1 code. The specification turned out to be thorough on *policy* and largely absent on *protocol*: **no document in the repository publishes an Open-Meteo URL, an OpenWeatherMap endpoint, a data.gov.in resource id, a cron expression, or the severity function the weather-risk levels are defined in terms of.** Each had to be established rather than transcribed, and each is now recorded in the doc that should have had it.

### Engineering decisions (ADR-023 records the architectural subset)

| # | Decision | Why |
|---|---|---|
| 1 | **Open-Meteo request built from the named variables, then verified against the live API.** | The doc names the variables and nothing else. One real keyless call on 2026-08-13 returned 14 daily rows with every requested field non-null and `daily_units` of `°C / % / km/h / mm / % / mm`. That verified sample is the test fixture; units are pinned explicitly so an upstream default change cannot turn 15 km/h into 15 mph. |
| 2 | **Weather payload validation is per-source, not the flat 14 days `validation.md` states.** | The free OWM `/forecast` endpoint returns ~5 days of 3-hourly steps, no history and no ET₀. Enforcing 14 against both providers would reject every fallback payload — breaking RES-01, the test that exists to prove fallback works. |
| 3 | **Risk-type enum reconciled to `docs/api/weather.md`** (`HEAT`/`FROST`/`WIND`), not weather-architecture.md's `EXTREME_HEAT`/`FROST_COLD`/`HIGH_WIND`. | The API doc is the wire contract clients are written against. The prose doc was corrected to match. |
| 4 | **Severity banding defined as declared engine policy.** | The architecture doc defines level as `f(magnitude, stage sensitivity, imminence)` without defining `f`. It is now a magnitude band plus at most one step for a sensitive stage and one for imminence, every input written into the trace. Each risk carries `thresholdSource: REGISTRY \| ENGINE_DEFAULT` — which matters because **no seeded crop publishes any `sensitivity` value at all**, so every threshold in production today is an engine default and says so. |
| 5 | **No provider call on the weather request path.** | `docs/api/weather.md` and `docs/api/farms.md` both mandate an on-demand fetch; CLAUDE.md rule 3 forbids it and P1-5 already resolved this the same way. "On-demand" is instead: a location with no snapshot returns 200 `pending` with a retry hint and is queued for priority refresh on the next tick. A CLAUDE.md rule overrides doc prose. |
| 6 | **IST is the single day boundary, everywhere.** | `setHours(0,0,0,0)` is host-local. Render runs UTC, so on the deployed instance every day boundary would sit at 05:30 IST — shifting ledger entries into the wrong day and splitting an evening's rain across two rows, while passing on an IST laptop. `utils/day.js` owns every boundary, and Open-Meteo is queried with `timezone=Asia/Kolkata` so the provider's day and ours are the same day. |
| 7 | **Market fetch scope derived from reality, not from OD-7.** | The docs scope the nightly fetch to "demo commodities × states" where the states are an open decision. The work list is instead the commodities the registry can map and the states the platform's farms are actually in — no decision needed, cannot go stale, and nothing is fetched that nobody is farming. |
| 8 | **`marketPrices.flagged` added.** | `data-normalization.md` has always required `flagged: true` on a clamped modal price, and the field never existed — so a clamped row was indistinguishable from a published one. An adjusted number presenting itself as the mandi's own is exactly what honesty rule 9 forbids. |
| 9 | **`recommendations.dedupKey` added, with a unique index.** | The documented `type+cropId+day` tuple is insufficient: two simultaneous weather risks on one crop collide (one silently overwrites the other), farm-level items have no `cropId`, and it omits `userId` entirely. The composed key makes feed idempotency structural — enforced by the database, as `marketPrices` already does — rather than dependent on job logic. |
| 10 | **Feed ordering is done in memory.** | The `feed` index sorts `priority: 1`, i.e. the strings ascending: CRITICAL, HIGH, **INFO, MEDIUM**. That is not the documented order. Ordering over the bounded candidate set avoids a schema change and a new index; the tie-break chain is total, so two identical runs render identically. |
| 11 | **`NO_IRRIGATION_NEEDED` is not materialised into the feed.** | `relationships.md` says irrigation materialises "when priority ≥ MEDIUM"; the priority table puts `WAIT_RAIN` and `NO_NEED` at INFO. Resolved by what the item asks the farmer to *do*: `WAIT_RAIN_EXPECTED` changes today's behaviour and is emitted; a no-op confirmation would add one dead item per crop per day. |
| 12 | **Crop-rec missing evidence excludes a factor and renormalises the weights.** | Two of the four scoring inputs do not exist (climate normals at all; soil suitability for 8 of 9 crops). Substituting a neutral 0.5 would present a guess as a score. `evidenceRatio` reports how much of the documented weight was actually backed by data, so a crop scored on two factors is not silently equated with one scored on four. |
| 13 | **Ledger writes are deliberately not idempotent.** | No document specifies write-side dedupe, and a farmer genuinely can irrigate twice in one day. A unique `(cropId, date)` index would reject the second event and under-count applied water — the more dangerous error. Repeat submissions are bounded by the 10/day per-user limiter instead. |
| 14 | **Per-*user* daily rate buckets added.** | Every existing bucket is IP-keyed, which is right for anonymous abuse but wrong for the "10/day" and "20/day" account quotas the API docs specify: IP-keying would let one account exhaust a shared village connection, and let a user reset their own quota by changing networks. |

### Defect found and fixed in already-shipped Phase-1 code

| Severity | Finding | Fix |
|---|---|---|
| **HIGH** | **`deriveStage` held Kc flat at Kc_end across the entire late season.** The value stored on the LATE stage is FAO-56's Kc_end — the coefficient at the *end* of the late season — and `crops.agronomy.json` states outright that "the engine must interpolate Kc_mid -> Kc_end across the late stage, not hold it flat". Wheat declines 1.15 → 0.25 over 30 days, so the whole late season was modelled at the harvest-day value, understating ETc badly and under-watering every crop in its final stage. | LATE now interpolates from the preceding stage's Kc to its own published Kc_end, with a distinct trace entry. The stage suite went 57 → 59 tests; the one asserting the flat value was corrected, not relaxed. |

### Defects found and fixed within Phase 2, before completion

Each was surfaced by an independent test-authoring pass, and each now carries a regression test that fails against the old code.

| Severity | Finding | Fix |
|---|---|---|
| **HIGH** | **A partial irrigation log erased the whole standing deficit.** The ledger anchored on *any* log, so a farmer recording a 5 mm top-up reset an 80 mm deficit to zero and was then told no irrigation was needed. R8 makes only a log *without* `amountMm` a refill. | Only amount-less logs anchor; a measured application is subtracted like any other water. |
| **HIGH** | **A non-retryable 4xx was retried.** The error was thrown inside the `try` and caught by the retry handler, which treated every HTTP-status error as retryable — burning three attempts of a finite free-tier quota against a fault that was ours, not the provider's. | Retryability is carried on the error. The default also dropped from 2 retries to the documented 1, and the promised ±25% jitter — which did not exist — was implemented. |
| **HIGH** | **The irrigation engine threw on malformed input**, violating R14 ("never throws"): an unparseable `sowingDate` raised `RangeError` from `toISOString()` while building the trace, and a null `crop` or `registry` raised `TypeError` because `= {}` defaults only fire for `undefined`. One bad document would have 500'd the request. | Nullish coalescing plus a non-throwing ISO helper; both cases degrade to a designed no-verdict result carrying its trace. |
| **HIGH** | **`varietyClass` was stripped between the knowledge file and the wire.** `CropRegistry`'s fertilizer sub-schema never declared the field, so Mongoose dropped it during the seed. TNAU publishes three distinct rice doses (120–150 / 150 / 175 kg N/ha) and two cotton doses; all of them reached the farmer as an unlabelled list with nothing to say which row applied to the variety in the ground. | Field declared; asserted end to end from knowledge file through seed to response. |
| **MEDIUM** | **`p` clamped to zero made "irrigate today" permanently true.** Under extreme demand the Table-22 ETc correction yields a negative depletion fraction; clamping it to 0 makes RAW 0, so `D >= RAW` holds at *any* depletion including zero. | An out-of-range correction is discarded and the published table value stands, with the trace recording the rejection. No floor was invented — FAO publishes limits this repository has not transcribed. |
| **MEDIUM** | **Feed items expired 5h30m late.** `validUntil` stamped 23:59:59.999 **UTC** onto an IST calendar date, i.e. 05:29 IST the next morning — so "irrigate today" stayed live into the following day and overlapped the next day's dedup key. | `endOfDay()` from `utils/day.js`. |
| **MEDIUM** | **Every market feed item violated R12** ("no recommendation without trace data"): the engine produced a trace, but the projection feeding the feed job dropped it, so every market item was written with `data.trace: null`. | The trace stays in the projection. |
| **MEDIUM** | **`toDailySeries` bucketed a null date into 1970-01-01.** `new Date(null)` is epoch 0, not an Invalid Date, so a dateless row passed the `isNaN` guard, sorted to the front of the series and padded the prior window — able to flip a signal. | Nullish inputs are rejected before construction, centrally in `utils/day.js`. |
| **MEDIUM** | **`parseArrivalDate` did not calendar-validate its ISO branch.** `2026-02-31` rolled silently to 3 March and `2026-13-01` to next January, so a malformed seed date was stored on the wrong day instead of dropped and counted. | Both branches round-trip the parsed date back to its parts. |
| **LOW** | **A `sensitivity` threshold of 0 produced a CRITICAL warning from a dry day** (`rainMm >= 0` always true, divide-by-zero → Infinity band). | Non-positive magnitude thresholds fall back to the engine default. Frost is exempted — a crop safe to −2 °C is a real registry value. |
| **LOW** | **Prototype-chain hole in the AWC lookup.** `soilType: 'toString'` resolved to an inherited function — truthy, so the soil was reported as *known* while TAW became `NaN`. | `Object.hasOwn`. |
| **LOW** | **The dry-spell window summed up to 15 days against a threshold calibrated for 7**, and the band was not normalised by window length, so a fortnight with 4.9 mm scored as a drought. | Exactly seven days, straddling today. |
| **LOW** | **`runOnStart: false` made a job permanently undue**, not merely deferred: `lastStartedAt` was only ever written by `run()`, so a job that opted out of the boot run never became due at all. | The flag stamps the clock and defers by one interval. |
| **LOW** | **The active-feed query took the 40 newest and *then* sorted by priority**, so a CRITICAL item older than those 40 would vanish from the feed entirely. | The scan ceiling is far above the cap; the cap, not the scan window, decides what is shown. |
| **LOW** | **`runMarketRefresh` reported success when there was nothing to fetch**, making an empty platform indistinguishable from a total outage in the log. | A distinct `skipped: 'no_work'` outcome. |
| **LOW** | **The unit-less-dose explanation had no key to render from** — the response carried only a boolean. | `unitNoteKey` emitted alongside `unitUnknown`. |

### Performance

`GET /dashboard`, which the product calls "the single most important endpoint", measured over 30 sequential requests after 3 warm-ups against the in-memory server, seeded with **5 farms × 30 active crops × 40 recommendations for one user**:

**p50 10.5 ms · p95 15.7 ms · max 23.0 ms** (three runs: p95 13.5 / 13.9 / 15.7 ms)

The local gate is <300 ms (`docs/testing/api-testing.md`); the production NFR is p95 <800 ms. The N+1 guard compares the 30-crop p95 against a 1-crop p95 measured identically: **ratio ≈ 1.0**, confirming the fixed six-query budget — thirty crops cost the same round trips as one.

### Honest limitations shipped in this phase

These are stated in the product surface, not only here.

- **The market feed cannot go live.** Every stage after the fetch is built and fixture-tested, but `DATAGOVIN_API_KEY` and `DATAGOVIN_RESOURCE_ID` do not exist. The resource id is deliberately **not** defaulted: guessing it would produce a confident-looking request against an unverified endpoint. The job reports `skipped: 'not_configured'` naming both variables and touches nothing.
- **`scripts/seed-market.mjs` will not generate a price series.** It reads a CEDA bulk export a human has downloaded; absent that file it exits with instructions. A fabricated mandi series is indistinguishable from a real one once it is in the database.
- **`shared/constants/climate-normals.js` is empty by design.** Consequence: `S_temp` is never scored, `S_water` is scored only for irrigated farms, and the water hard gate cannot fire. The engine names the excluded factors in `limitations` and reports `evidenceRatio` so a thinly-evidenced ranking is not presented as a well-founded one.
- **The soil AWC table is second-tier provenance.** Its only source is a prose line citing "FAO Ch.: soil water properties" with no chapter, table or URL, and four of its eight keys are ICAR soil *orders* that FAO-56's texture-class table does not tabulate. Transcribed exactly as published, marked `confidence: 'S'`, recorded as an open verification task — deliberately not upgraded to sit alongside the cell-by-cell FAO transcriptions.
- **Chilli irrigation still rests on a bell-pepper Kc curve.** The registry seed drops the `proxy.isProxy` flag, so the engine cannot detect it and does not special-case any crop code. Labelling it remains a caller responsibility and an open item.
- **Agronomic Hindi in the five new namespaces is unverified.** `weather`, `irrigation`, `market`, `fertilizer` and `cropRec` were authored to satisfy the en/hi parity gate; CLAUDE.md rule 8 requires human verification before demo. The fertilizer disclaimer is a safety-bearing string whose Hindi the knowledge file explicitly declined to author.
- **`crops.fertilizer.json` publishes a stale disclaimer key** (`fertilizer.disclaimer.general`) that nothing reads; the code and the i18n bundle both use `fertilizer.disclaimerGeneral`. The knowledge file was left untouched — it is P1-6 approved content — but the divergence will mislead the next reader.

### Not done, deliberately

- **No ML work.** `datasets/` is byte-for-byte untouched; the manifest, curation rules and class decisions from P0-6/P0-6b are unchanged. No model was trained.
- **`GET /market/compare`** is specified as P1 and sits outside this TODO's scope.
- **`/system/status`** is referenced by two docs as a job-report sink but has no API contract and no FR mapping. The in-scope pieces are `systemStatus` inside `/dashboard`, plus `jobs` and `services` on `/healthz`.
- **`shared/constants/geo`** still does not exist, so market geography is whitespace-normalised and required non-empty but not fuzzy-matched against a canonical list — the same resolution P1-5 reached for farm validation, and for the same reason.

### Files

Created: `backend/src/utils/{httpClient,circuitBreaker,day}.js`, `config/failureFlags.js`, `integrations/{openMeteo,openWeatherMap,dataGovIn}.js`, `jobs/{scheduler,index,weatherRefresh,marketRefresh,feedRefresh,expiry}.js`, `services/{weatherValidation,weatherService,farmWeatherService,irrigationService,marketNormalizer,marketService,feedService,fertilizerService}.js`, `engines/{irrigation,weatherRisk,marketSignal,feedComposer,cropRec}/`, `routes/{market,dashboard,cropRecommendation}.js`, `scripts/{seed-market,trigger-jobs}.mjs`, 14 test files, `shared/constants/{agronomy,climate-normals}.js`, `shared/i18n/{en,hi}/{weather,irrigation,market,fertilizer,cropRec}.json`, `docs/decisions/ADR-023-phase2-engine-decisions.md`.

Changed: `backend/src/{app,server}.js`, `config/{constants,env}.js`, `middleware/rateLimits.js`, `models/{MarketPrice,Recommendation,CropRegistry}.js`, `engines/stage/deriveStage.js`, `routes/{crops,farms,health,ownership-table}.js`, `backend/package.json`, `shared/i18n/{en,hi}/farm.json`, `render.yaml`, and the docs listed in ADR-023.

---

## PHASE 3 — Crop health chain (P3-1..P3-8) — 2026-08-13

**1,203 backend tests / 1,203 pass / 0 fail** across 243 suites (Phase 2 finished at 931), plus **141 ml-service pytest / 141 pass**. Repo lint clean · `prettier --check` clean · web `tsc --noEmit` clean · `npm audit --omit=dev` **0 vulnerabilities** · layer-1 staged-secret scanner clean · `gitleaks detect` clean over both the committed history and a 471MB working-tree sweep. Four backend runtime dependencies added, all pre-approved in `docs/security/dependency-security.md`: `multer`, `sharp`, `file-type`, `cloudinary`. ml-service takes exactly its locked set (`fastapi`, `uvicorn`, `onnxruntime`, `pillow`, `pydantic`, `python-multipart`) plus `pytest`/`httpx` as dev-only.

### The prerequisite that was not on the TODO list

**The disease knowledge base did not exist.** `cropRegistry.diseases` was `[]` for all ten crops; `crops.agronomy.json` gap **G12** recorded diseases as "out of scope for this pass — not attempted". Registry-closing (P3-3), the symptom engine (P3-5), KB rendering (P3-6) and community fan-out (P3-8) all read it, and `docs/ml/crop-class-mapping.md` states the rule plainly: "every code has registry KB entry (symptoms/actions) BEFORE it may ship in the model (no diagnosis without guidance)."

It was authored the way the other knowledge files were — a sourced research pass, not from memory. **35 codes, 408 English strings**, every entry carrying the verbatim `publishedSymptoms` its tags were derived from, a `tagDerivation` line, and `sourceRefs` naming the exact URL fetched. Primary sources: TNAU Agritech / Crop Protection Guide, NIPHM IPM packages, ICAR e-publications, eagri courseware. **No dosage, active ingredient or product name appears anywhere** — the chemical recommendations on those pages were read and deliberately discarded, and each `sourceRefs.note` says so. Where a source could not be reached (`iimr.icar.gov.in` did not resolve; the ICAR-CPRI potato manual DNS-failed; CABI returned 403) the failure is written into `gaps` rather than filled from elsewhere.

Two source errors were quarantined rather than propagated: TNAU's tomato late-blight page prints "Sporangia formed when RH is < 90%" (inverted), and its potato early-blight page prints "Shot holes on fruits" (potato has no fruit a farmer inspects). Both are preserved verbatim in `publishedSymptoms`, both are untagged, and neither is ever rendered.

### Engineering decisions (ADR-024 records the full set)

| # | Decision | Why |
|---|---|---|
| 1 | Per-hop 10s bounded by a 15s E2E **deadline**; a hop with no budget is skipped, not started | Four docs say 10s per hop and the same doc says ≤15s E2E. 10+10 > 15, so a ceiling alone cannot honour the budget. |
| 2 | LIMITED routes to the rule engine + honest notice | `crop-health.md` (wire contract) beats `crop-support-matrix.md`'s "Gemini best-effort" — same precedent as the weather risk-type spellings. |
| 3 | Image cache keyed `(userId, cropId, imageHash)` over the **re-encoded** bytes, no new collection, no new index | Global would answer B's request with A's analysis (AU-1). Raw-byte hashes never collide — two shots of one leaf differ in EXIF timestamp. |
| 4 | Cache hit answers **200**, not the documented 201 | Nothing was created. A second row would duplicate the timeline and inflate that farmer's community report count. |
| 5 | Severity is declared **engine policy**, merged by `max` not average | No source publishes a banding function that generalises across pathogens. `evaluation-plan.md` names disease→HEALTHY as the dangerous direction; an average can under-call, a maximum cannot. |
| 6 | Append-only narrowed, not abandoned: only `severityFollowUp` + `analysis.severityAssessment` mutate | The API contract defines a follow-up that amends the log. Bounded explicitly and regression-tested. |
| 7 | Disease `names.hi` is nullable, with `hiVerified` | Requiring it left only two options: drop the sourced KB, or invent Hindi disease names. |
| 8 | `source` = tier (farmer-facing); `provider` + `escalationPath` = record | Keeps "no Gemini key" distinguishable from "Gemini said UNKNOWN". |
| 9 | `DISABLE_*` honoured in production; `FORCE_FAIL_*` still is not | Shedding a quota-exhausted tier without a redeploy is the whole point of a kill switch. Both stay routing-only. |
| 10 | Uploads held in memory; **no temp file at all** | Stronger than the doc's "deleted in finally-block": no path from user input, nothing survives a crash, no directory for another process to read. |

### Defects found and fixed within Phase 3, before completion

| Severity | Finding | Fix |
|---|---|---|
| **HIGH** | **An animated image was accepted and analysed as a photograph.** `sharp().metadata()` reports `pages: undefined` unless the instance is constructed with `{animated: true}`, so the animated guard never fired — a three-frame WebP was flattened into one tall still and sent down the chain. Found by the hand-built animated-WebP fixture; sharp cannot author one, so without that fixture the guard was untestable and silently dead. | Metadata is read animation-aware, `pages > 1` is checked *before* dimensions (with `animated: true`, `height` is every frame stacked), and `pageHeight` is used for the edge check. |
| **MEDIUM** | **A decompression bomb was reported as a corrupt photo.** `metadata()` at sharp's default `limitInputPixels` *throws* on an oversized declaration, so a 69-byte / 2.5-billion-pixel PNG landed in the catch branch and told the farmer to retake a photo that was never the problem — and told an operator "corrupt file" when they were being attacked. | The header read uses `limitInputPixels: false` (it decodes nothing, so no budget is at risk) and the explicit checks below produce the honest `DIMENSIONS_TOO_LARGE`. The decode step still carries the real limit, which is where a pixel budget protects something. |
| **MEDIUM** | **Crop deletion orphaned every photograph.** `imagePublicId` has carried the comment "Needed to destroy the Cloudinary asset on cascade delete" since Phase 1, but nothing ever called destroy: `deleteCropCascade` removed the rows holding the only reference to each asset. `select: false` made it a trap — a naive `find()` returns `undefined` and the "cleanup" silently no-ops. | Images are destroyed before the rows, reading `+imagePublicId` explicitly, best-effort so a down image host cannot block a farmer's delete. Five regression tests, including one asserting the `select: false` field is actually read and one asserting a co-tenant's asset is never touched. |
| **MEDIUM** | **Two reason vocabularies on one wire field.** `UPLOAD_ERROR.details[].rule` carried the reason class for ten cases but the coarse *storage* kind (`not_configured`) for the eleventh — caught while reconciling the API doc against the code. | One vocabulary: the class. The provider kind is logged server-side, where it is useful, and is of no use to a farmer who can only retry either way. |
| **LOW** | **A flaky test, root-caused rather than retried.** `records a rejected upload in the audit log` passed alone and failed about one run in three under full-suite load. The audit write is deliberately fire-and-forget so an audit failure cannot mask the farmer's response — so reading immediately after the response is a race. | A bounded `eventually()` poll in the test. The route was left alone: awaiting the audit write to make a test deterministic would have traded a real property for a convenient one. Verified across three consecutive full runs. |
| **LOW** | **An existing test asserted `gemini` was an unknown provider.** `httpClient.test.js` used it as its example of an id with no injection flag; P3-3 registered it, so the assertion began failing correctly. | The case now uses a permanently-unregistered id, so it tests the property (unknown implies never injected) independent of which providers exist, and a new case asserts each Phase 3 flag reaches exactly one provider and that the weather alias has not grown to cover the AI tiers. |

### Verification performed (all executed, results real)

| Check | Result |
|---|---|
| `backend && npm test` | **1203 / 1203 pass**, 243 suites, ~90s. Run three times consecutively after the flake fix; clean each time. |
| `ml-service && pytest` | **141 passed**, 2.1s. One third-party `StarletteDeprecationWarning`. |
| ST-30 upload (`tests/security/st-30-upload.test.js`) | 32 pass — polyglot JPEG+ZIP, PNG decompression bomb, oversize, exe-renamed-jpg, corrupt JPEG, EXIF-GPS stripped, heif container, animated, storage + cleanup failure |
| ST-20 privacy (`tests/security/st-20-privacy.test.js`) | 13 pass — recursive payload scan for identifying fields, consent filtering at the *input*, single-farmer silence |
| ST-10 authorization matrix | 100 pass (was 98 + 2 failing until `/community/alerts` was mounted — the table caught it) |
| Router matrix (`tests/services/cropHealthRouter.test.js`) | 22 pass, **all 8 documented combinations** + cache, budget, consent and cleanup invariants |
| Provider tiers (`tests/integrations/aiVision.test.js`) | 64 pass — primary to secondary to tertiary to safe failure, registry-closing, adversarial fixtures, kill switches |
| Symptom engine | 45 pass — determinism asserted by shuffling the KB array ten ways and comparing serialised output |
| `npm run lint` · `format:check` · web `tsc --noEmit` | clean |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `gitleaks detect` (history) · `--no-git` (471MB tree) | no leaks. `.gitleaks.toml` now excludes `node_modules/` and `.venv/` — vendor code that is gitignored and can never be committed. |
| Registry seed composition | 35 disease entries attached, matching `mlClassCodes` exactly per crop; 0 duplicates; 0 incomplete documents |

### Honest limitations shipped in this phase

- **No live provider call has been made.** `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `CLOUDINARY_URL` and `ML_SERVICE_URL` are all unset. Every tier is fixture-tested and every absence degrades to a labelled `not_configured` — but the fixtures are **synthetic-to-spec, not recorded live traffic**, and they are labelled as such inside each file. Nothing here claims a verified round-trip.
- **Disease-KB Hindi is 0 of 408 strings.** Reported by name and count on every test run. This is ADR-021 §1's cotton ship gate.
- **The model is a stub.** `stub-0.0.0-untrained`. τ, τ_healthy and the softmax temperature are `"calibrated": false` placeholders; the margin guard 0.15 is the one real value, because confidence-strategy.md publishes it. The backend never re-derives the gate — the service decides `uncertain` — so training drops in without a backend change.
- **HEVC-coded HEIC decoding is not demonstrated.** The libvips build has no HEVC encoder (`heifsave: Unsupported compression`), so no valid fixture could be produced. The heif container path is proven with AVIF and the undecodable path with a truncated HEIF. `sharp.metadata()` does report `compression: 'hevc'` on a real HEIC, which indicates a decoder is present — an indication, not a proof.
- **`OPENROUTER_MODEL` is an unverified free-tier guess.** No repository document names a model. If the `:free` suffix is retired the tier 4xxs and drops to the rule engine: degraded, never wrong.
- **The symptom-tag vocabulary has four recorded holes** — no interveinal, leaf-underside, shape-deformity or colour-neutral discolouration tag. `COTTON_LEAF_REDDENING` consequently carries no `pattern` tag (weight 3) and is structurally unable to rank; `MAIZE_NORTHERN_LEAF_BLIGHT` and `MAIZE_GRAY_LEAF_SPOT` share 7 of 9 tags because their real discriminator is lesion geometry. Recorded in the KB `gaps`; widening the vocabulary means re-tagging both parts.
- **`MAIZE_GRAY_LEAF_SPOT` has no Indian primary source.** Grey leaf spot appears on neither TNAU's maize index nor eagri's maize lecture, and `iimr.icar.gov.in` did not resolve in DNS. It rests on secondary sources and is graded `S`.
- **`CHILLI_ANTHRACNOSE` carries no `part:LEAF` tag** — TNAU describes it only on twigs, flowers and fruit, and no published leaf lesion was found. Awkward for a class trained on leaf photography, and left as the source has it.
- Three `expertThreshold` values were raised to 0.6 on broad/abiotic classes. They are **proposals, not measurements**; reverting all three to the 0.4 default breaks nothing.

### Not done, deliberately

- **No ML training.** No model was trained, exported or evaluated; `datasets/` is untouched. The ONNX harness is exercised against a ~700-byte hand-serialised graph so the code path is real, and `StubPredictor` is a deterministic hash — never a fabricated prediction dressed as one. `build_predictor` does **not** fall back: a configured-but-broken `MODEL_PATH` yields degraded health and 503, never silent hash noise.
- **No deploy.** OD-2 (ml-service host) is still open; the 20-round-trip latency test has not been run.
- **No `pip-audit`.** It is a pre-deploy gate and is recorded as such rather than claimed.
- **No consent-toggle endpoint.** `setCommunityConsent` exists in the service and `communityConsent` is on the user model, but `docs/api/users.md` owns that surface and it is not a Phase 3 item.
- **The four symptom-tag vocabulary holes were not patched.** Adding tags means re-tagging both KB parts against their sources; done badly it would introduce exactly the unsourced agronomy the pass exists to avoid.

### Files

Created: `backend/src/services/{imagePipeline,cropHealthService,aiVision,communityService}.js`, `integrations/{cloudinary,mlService,gemini,openRouter}.js`, `middleware/uploadImage.js`, `engines/{severity,symptom}/`, `routes/{cropHealth,cropHealthKeys,community}.js`, `jobs/communityAggregate.js`, `knowledge/crops.diseases.part-{rtp,ccm}.json`, `knowledge/i18n.diseases.part-{rtp,ccm}.json`, 9 test files (`tests/security/st-{20,30}-*.test.js`, `tests/api/cropHealth.test.js`, `tests/services/{cropHealthRouter,cropCascade}.test.js`, `tests/integrations/aiVision.test.js`, `tests/engines/symptomEngine.test.js`, `tests/jobs/communityAggregate.test.js`, `tests/i18n/disease-keys.test.js`), `tests/fixtures/images.js`, `tests/fixtures/external/ai/`, the whole of `ml-service/` (app, tests, Dockerfile, requirements, model manifest, scripts), `shared/i18n/{en,hi}/{health,community,disease}.json`, `docs/decisions/ADR-024-phase3-crop-health-decisions.md`.

Changed: `backend/src/config/{constants,env,failureFlags}.js`, `models/{CropHealthLog,CropRegistry}.js`, `services/{cropService,registrySeedService}.js`, `middleware/rateLimits.js`, `routes/{health,ownership-table}.js`, `src/{app,jobs/index}.js`, `backend/package.json`, `tests/{utils/httpClient,i18n/message-keys}.test.js`, `shared/i18n/{en,hi}/errors.json`, `.gitleaks.toml`, `.env.example`, `render.yaml`, and the docs listed in ADR-024.

---

## PHASE 5 — Web frontend (P5-1..P5-10) — 2026-08-13

The web client went from a scaffold that rendered one paragraph to the full farmer-facing surface: 18 routes, 15 i18n namespaces, and every screen wired to the real Phase 1–4 API. Architectural decisions are in **ADR-025**; this entry records what was found, what broke, and what is honestly still owed.

### What the API actually returns, versus what the client assumed

The single most valuable half-hour of this phase was spent walking every endpoint the client calls against a live local backend and printing the real response shapes. Three assumptions were wrong, and every one of them would have put a raw identifier or a false claim in front of a farmer:

- **`recommendations.type` is hyphenated** (`weather-risk`), not snake-cased. The per-type deep links would have been silently dead — nothing throws, the link just never matches.
- **`irrigation.verdict` can be `null`** when the engine declines to reach one at all; a crop that is not yet sown is the everyday case. `` `irrigation.title${verdict}` `` would have asked i18next for `irrigation.titlenull` and printed the key.
- **`market.signal.trend` can be `null`** with no observations. Same key-composition failure — and the tempting fallback, `STABLE`, would have told a farmer "prices are steady" on the strength of no data at all.

`freshness` also turned out to be three shapes rather than one: weather carries `fetchedAt`/`ageHours`/`staleWarning`, its pending branch carries `retryAfterSeconds`/`reason`, and market carries `latestDate`/`ageDays`. `FreshnessDot` now prefers the server's own `staleWarning` over its own arithmetic, because the 48-hour threshold is the server's to own.

None of this was visible from the docs. It came from running the thing.

### Defects found and fixed within Phase 5

- **The app hung forever on "Checking your session…".** An "already bootstrapped" `useRef` guard combined with a per-run `cancelled` flag meant React StrictMode's double mount cancelled the only in-flight refresh and then declined to start a replacement. Every route sat on the bootstrap screen indefinitely. De-duplication belongs in `refreshSession()`, which is already single-flight, so the ref was removed. **Found by Playwright, not by the RTL suite** — `renderWithProviders` does not wrap in StrictMode and `main.tsx` does. A StrictMode regression test now closes that gap.
- **A failed refresh left a dead access token in memory.** `refreshSession()` returned `null` on failure without clearing it, so the next request went out with a bearer token the server had just refused. Now cleared.
- **A CRITICAL weather warning claimed "no calculation details were recorded".** The feed's `data.trace` is polymorphic — an array of engine steps for irrigation and market, but `risk.data` (a flat object of the compared numbers) for a weather risk. `WhyTrace` accepted only arrays, so the one item class where the numbers matter most rendered as having none. It now normalises both shapes.
- **Irrigation feed items dropped their freshness label.** The composer attaches the weather freshness the verdict was computed from; the card ignored it. "Water this crop today" derived from a three-day-old forecast is exactly the case rule 9 exists for.

### Verification performed (all executed, results real)

| Check | Result |
|---|---|
| Frontend TypeScript (`tsc --noEmit`) | clean |
| Frontend lint | 0 errors, 4 `react-refresh` HMR warnings |
| Frontend unit + RTL (`vitest run`) | **87 passed**, 10 files |
| Backend (`npm test`) | **1203 passed** |
| ml-service (`pytest`) | **141 passed** |
| Frontend production build | succeeds; largest lazy chunk is Recharts at 368 kB, loaded only by the two chart routes |
| i18n parity (`scripts/check-i18n.mjs`) | passes — 976 keys, en↔hi both directions, interpolation-placeholder parity |
| Hardcoded UI strings (`scripts/check-ui-strings.mjs`) | 0 violations |
| Local MongoDB | connected (`him1096`), 24 indexes built, registry + demo seeded |
| Weather ingest | real Open-Meteo fetch, 1 location |
| Feed composition | 4 real items from those real conditions |
| OpenWeather fallback | verified live: with `FORCE_FAIL_OPENMETEO`, the refresh completed from `openweathermap` |

### Honest limitations shipped in this phase

- **No human Hindi verification.** The parity gate passes and 0/976 strings are reviewer-verified; `shared/i18n/hi/_verification.json` is the ledger and it is empty. `disease` is 0/408 by policy — no Hindi-language official source has been fetched, and rule 8 forbids unsourced agronomic translation. Cotton's ADR-021 bilingual ship gate is unchanged.
- **No visual review.** `MASTER-TODO` marks the charts row "✔ visual review"; no human has looked at these screens. The browser-automation extension was unavailable in this environment. Playwright exercises them at desktop and mobile viewports, which is not the same claim.
- **No axe-core, no Lighthouse.** Both are Day-3 items and neither has been run, so no score is claimed. The structural work they would check is in place.
- **The AI chain has not been exercised end to end.** Gemini and OpenRouter are now detected as configured, but no analysis has run against a real photograph, because image upload requires Cloudinary and the supplied `CLOUDINARY_URL` is malformed (see below). The scan flow's four result branches are covered by fixtures and E2E; the live chain is not.
- **No mandi data.** `DATAGOVIN_RESOURCE_ID` is absent, so `marketRefresh` correctly reports `skipped: "not_configured"`. Market screens render their designed empty/no-signal states, which is what the engine's `NO_OBSERVATIONS` branch is for.

### Environment findings (2026-08-13, credentials supplied by the owner)

Verified by structure and by exercise, never by printing a value:

| Variable | State |
|---|---|
| `GEMINI_API_KEY` | present · detected (`tiers.gemini.configured`) |
| `OPENROUTER_API_KEY` | present · detected (`tiers.openrouter.configured`) |
| `OPENWEATHER_API_KEY` | present · **exercised successfully against the live provider** |
| `DATAGOVIN_API_KEY` | present · read (absent from `missingConfig`) |
| `DATAGOVIN_RESOURCE_ID` | **absent** — no such line in `backend/.env`. Open decision OD-5. |
| `CLOUDINARY_URL` | present but **malformed**: no `@<cloud-name>` segment. The API refuses to boot, which is the documented fail-fast behaviour, not a bug. |

The Cloudinary shape check is deliberate (`config/env.js`: "a truncated paste fails at boot instead of at the first upload"). It was left exactly as it is.

### Not done, deliberately

- **No `i18next/no-literal-string` plugin.** `scripts/check-ui-strings.mjs` implements the rule against a locked dependency list.
- **No `StatePicker`/`DistrictPicker` enums.** `shared/constants/geo` is deliberately empty and `farms.js` says why: "an invented list would be worse than a late one." Free text, as the API expects.
- **No consent toggle in Settings.** The API exposes no user-update route, so the flag is shown read-only rather than as a control that does nothing.
- **No weakening of any security control to suit the tests.** The login limiter (5/15min) and refresh limiter (60/hour) shaped the E2E design instead: one signed-in browser context per worker, and navigation through the app's own links rather than repeated document loads.

### Addendum — 2026-08-13, credentials supplied and two integrations closed out

**Secret-exposure incident, contained.** The provider credentials had been written into `.env.example` — the **tracked** template — rather than into `backend/.env`, which is why the API kept refusing to boot and why `DATAGOVIN_RESOURCE_ID` read as absent. Checked before acting: the values were in the working tree only, never committed (`git show HEAD:.env.example` is placeholders throughout). The six provider values were moved into `backend/.env` (gitignored, backed up first, every other line preserved byte-for-byte), and `.env.example` was restored from git. No value was printed at any point; the diagnosis was done on structure alone — presence, length, `@`-count, regex-component pass/fail.

**Cloudinary.** The first value had no `@<cloud-name>` segment, so `config/env.js` refused to boot. That refusal is the documented Phase-3 fail-fast ("a truncated paste fails at boot instead of at the first upload") and was left exactly as written. With the corrected value the API boots and `tiers.storage.configured` is true.

**data.gov.in — a real defect found and fixed.** With the key and resource id in place the portal answered with 505 live rows, and the job **aborted**: 396 of them were commodities the registry does not map (brinjal, pomegranate, drumstick, coriander seed), a 78% drop rate against `MARKET_DROP_RATE_ABORT` of 30%.

The guard was doing its job; the fetch was not. `marketRefresh` filtered by **state only**, so it pulled a whole state's mandi feed and then discarded most of it — and `dropped.unmapped` conflated "out of scope" with "the portal renamed a field", which is the schema drift the guard exists to catch. The fetch now runs per **(state × commodity)**, driven by the registry's own alias list (the portal's spellings: `Paddy(Dhan)(Common)`, `Dry Chillies`, `Tomato`), which is what the job's own scope comment always described. Result on the same live data: **142 fetched, 101 inserted, 23% dropped, not aborted**, across 24 districts and 7 commodities including real Nashik onion markets (Lasalgaon, Pimpalgaon Baswant). Cost is ~12 requests a night instead of 1.

`market.test.js` RES-07 was updated with it: a total outage now reports one failure per attempt rather than one per state, so the assertion moved from an exact array to the property it actually cares about — every failure recorded, attributed and not swallowed.

**Market signals are still null, correctly.** One nightly run yields one arrival date; `MARKET_SIGNAL_WINDOW_OBS` needs seven. The screens render their designed "not enough recent reports" state until history accumulates, or until a CEDA export is placed for `npm run seed:market`.

**Hindi disease KB: 0/408 → 408/408.** Translated from the English that was already sourced from TNAU/ICAR, so no agronomic fact, threshold, practice, product or condition appears in the Hindi that is not in the English string it renders, and no pesticide dose appears in either language — the KVK/Kisan-Call-Centre referral is carried through verbatim. Terminology follows `docs/i18n/agricultural-terminology.md`; register is the आप-form per the translation strategy. The merge refused to write unless all 408 keys matched the English set exactly, with no empties and Devanagari present in every value.

**Sign-off is tracked separately from parity, deliberately.** `shared/i18n/hi/_verification.json` now records `verifiedBy` per namespace: `owner` for the 14 UI namespaces the project owner reviewed, `claude` for the disease KB. `check-i18n.mjs` reports 568/976 human-verified and flags the disease row as machine-translated. ADR-021's cotton gate is **mechanically satisfied and editorially still open** — the strings exist and render, but no Hindi-literate reviewer has read them. The `KNOWN_GAPS` exemption that let `disease` warn instead of fail was removed, so a missing disease key is now a hard failure like any other.

A regression test asserts the KB guidance renders in Devanagari on the result page rather than silently falling back to English — the failure mode `fallbackLng: 'en'` would otherwise hide from the parity gate entirely.

**Verification after all of the above:** backend 1203 passed · ml-service 141 passed · frontend 88 passed · tsc clean · repo lint 0 errors (4 `react-refresh` HMR warnings) · production build succeeds · i18n parity 976 keys, 0 missing · 0 hardcoded UI strings. The final E2E suite was **not** run — it is deferred to joint web+mobile integration verification at the owner's instruction.

### Addendum — 2026-08-13, productization pass: land ledger, localization closure, public landing page, IA repair

Owner-directed full-product pass ("audit → fix → verify, do not stop at prettier"). Everything below was driven by a three-way audit (page inventory, API contract, i18n coverage) whose findings are reproduced in the section they fixed.

**The land ledger — the missing business rule.** Nothing anywhere prevented a farm's crops from exceeding the farm: a 2-acre field could carry twelve 100-acre crops. Now enforced server-side in acre-equivalents (`ACRES_PER_UNIT` reconciles acre/hectare/bigha into one ledger): `cropService.assertAreaWithinFarm` on crop create and on the merged result of PATCH (value, unit, or both), `farmService.updateFarm` refuses to shrink a farm below its planted area, and `areaUnit` became required whenever `areaValue` is sent — an area without a unit is not a measurement. `planned` counts (one PATCH from occupying ground), `harvested` frees its area, a crop with no recorded area occupies nothing. Refusals carry `availableAcres`/`allocatedAcres` in the validation details so the client can say how much ground is left, and the keys `crop.areaExceedsFarm` / `farm.sizeBelowCropArea` render it. The form mirrors the rule before the round trip: the crop form shows "You have N acre available for crops" under the area field and refuses locally with the same message; the farm edit form mirrors the shrink rule. 22 new backend tests (`tests/services/cropAreaValidation.test.js` arithmetic; `tests/api/cropAreaLedger.test.js` proves every curl-shaped bypass — create, PATCH growth, unit-switch inflation, farm shrink — answers 422) and 2 new form tests.

**Localization closure — the "Onion stays Onion" bug.** The bilingual registry names were already used almost everywhere; the leaks were the market nearby-mandi surface (commodity dropdown and price rows rendered raw `WHEAT`/`ONION` codes), the community alert card (`alert.cropCode` raw), and feed/history strings that interpolate `{{cropCode}}` ("reported this on COTTON"). One hook (`useCropNames`) now joins registry names client-side; unknown codes fall back to title case of the provider's own id, never an invented translation. Also fixed: seven wrong-copy reuses found by the audit — the 404 page no longer says "Nothing here yet" (`errors.notFound*`), the history advice tab is no longer labelled "Home", the settings consent badge no longer reads "Done"/"Nothing here yet" (`community.consentOn/Off`), the crop seasons list is no longer headed "Status", the dataGaps notice no longer reuses the unsupported-crop text, both unit dropdowns are labelled "Unit" instead of "acre", and the dashboard's degraded-status line names Weather instead of Home. `<html lang>` is set from the saved preference before the bundle loads. Every machine-authored Hindi addition is recorded as `unverifiedAdditions` in `_verification.json` (blanket `"*"` sign-offs converted to explicit key lists for common/errors/community/crop, following the farm/market precedent).

**Public landing page.** `/` was auth-gated — the product had no front door. It is now a public landing page (hero, problem, how-it-works, four feature cards, trust list, CTA, footer; new `landing` namespace, 29 keys en+hi, Hindi machine-authored and ledgered as unverified). Imagery is inline SVG drawn from the design tokens — no external image hosts, nothing can arrive broken on a rural connection. Signed-in visitors forward through `/home`, where `PostAuthLanding` applies the unchanged onboarding-vs-dashboard policy. `index.html` gained a real description and OG tags.

**IA repair.** `/history` had zero inbound links and `/weather` did not exist. The sidebar now carries Weather and History (bottom tabs stay at five; History's mobile entry is the dashboard header). New `/weather` route: one farm forwards straight to its forecast, several ask which field, none shows the standard add-a-farm state. The voice "weather" intent now lands on `/weather` instead of the `/farms` nearest-guess. "What should I plant?" gained a durable entry in the farms-list header. Weather page: farm context in the header, risks moved above the charts (action first). Crop form and crop detail headers name the farm and district (context header). Other audit fixes: the crop form's registry fetch has an error+retry state (it used to fail into a picker offering only "Other"), history pagination no longer dead-ends when `meta.total` is absent, `Kc` is labelled "Crop coefficient (Kc)", Recharts actually got the vendor chunk the vite config comment claimed (385 kB no longer in the entry bundle), and the stale "0/408" comments in `resources.ts`/`types.ts` were corrected.

**Docs.** `routes.md` (new routes), `state-management.md` (language is device-local; no `PATCH /users/me`), `ux-flows.md` (market is location-first; land ledger), and the QA runbook: new §0.5 landing page, §5.2 land ledger (crop areas in the canonical flow adjusted to fit the 2-acre farm — the old numbers would now be refused, which is the rule working), §8/§9/§12.1/§13.1 updated to the actual UI.

**Verification:** backend 1260 passed (was 1238) · frontend 97 passed (was 95) · tsc clean · lint 0 errors (4 pre-existing HMR warnings) · i18n parity 1033 keys, 0 missing, 568 human-verified with every new key ledgered unverified · 0 hardcoded UI strings · production build succeeds (largest route chunk is the charts vendor split, loaded only by chart routes).

**E2E suite run (first time since Phase 5 deferred it) — one suite defect found and fixed.** First full run: 26 passed, 12 failed — 11 of the 12 in the `mobile-chromium` project, every one failing at the fixture's sign-in with the page parked on `/login`. Direct probe confirmed the API answering `429 RATE_LIMITED`: `guards.spec.ts` documents a budget of "two of the login limiter's five attempts", but that accounting predates the two-project config — run in both projects, the suite spends 6+ logins per 15-minute window, and each failure's worker restart spends another, which is the cascade. Per rule 2 the limiter is untouched; the suite now spends less instead: guards (viewport-independent by subject — redirects, revocation, 404) run on desktop only via `testIgnore` on the mobile project, bringing the budget to 4 of 5. Not a regression from this pass — the suite had never been run in this configuration.

**Second E2E finding — the suite is not idempotent.** A re-run against the same seed failed on every feed-dependent test: the previous run's acknowledge test had permanently acked the demo account's feed items (correct product behaviour — acked advice stays acked), `feedRefresh` deliberately does not resurrect them, so `feed-item` never rendered — and each of those failures restarted its worker, spent another fixture login, and re-triggered the limiter cascade downstream. Not a product bug: the reset is `npm run seed:dev -- --reset` + `weatherRefresh` + `feedRefresh` — the `--reset` flag matters, because without it the seed is deliberately additive (it must not reset a changed password), the demo user keeps its id, the day's dedup keys keep matching the acked rows, and `feedRefresh` reports `updated` rather than `inserted` for every candidate. Recorded here because the failure mode — "everything after test N failed at sign-in" — looks like an auth regression and is actually a spent budget.

---

## PHASE 6 — Android app (P6-1..P6-8) — 2026-08-14

**Mobile: 11 suites / 90 tests / 90 pass**, `tsc --noEmit` clean. **Backend 1,279 / 1,279 pass** across 255 suites (Phase 5 finished at 1,260). **Web 109 / 109 pass** across 14 files (was 97). Repo lint **0 errors**, 4 warnings — all four the pre-existing `react-refresh/only-export-components` HMR warnings in the web app. `check:i18n`: **1,152 keys · 0 missing in hi · 568 human-verified**, parity check passed. `check:ui-strings`: **0 hardcoded user-facing strings** across `web/frontend/src` **and** `mobile/src`, 30 files exempt.

The app is Expo SDK 57 / React Native 0.86.2 / React 19.2.3 / TypeScript **(superseded the same day — migrated down to SDK 54; see the migration entry at the end of this file)**: 24 screen files (23 navigator routes plus the crop-detail tab host) across 4 tabs and 5 stacks, consuming the same `/api/v1` contract as the web with no mobile-only endpoint except the one that had to be built (below). Nothing outside the Expo managed module set, so the Expo Go demo route survives.

**Nothing in this entry has been run on a phone.** No APK exists, no device or emulator has launched the app, and no row of the manual matrix in `docs/mobile/testing.md` has been executed. Everything claimed below was verified by a command that was run or read out of a file.

### The decision that shaped the phase: `shared/` grew

The mobile client is the second consumer of a contract that had exactly one. Five modules moved up out of `web/frontend/src`:

| Module | Contents |
|---|---|
| `shared/types/api.ts` | every wire type and enum; `web/frontend/src/api/types.ts` is now a one-line `export *` so the ~40 existing `@/api/types` imports keep resolving |
| `shared/client/errors.ts` | `ApiError`, `isApiError`, `isApiErrorBody`, `isRetryable`, plus a new `retryAfterSeconds` |
| `shared/client/queryKeys.ts` | the query-key registry and the `STALE_TIME` tiers |
| `shared/client/units.ts` | acre-equivalent land-ledger arithmetic |
| `shared/client/format.ts` | Intl date/number/currency formatting and `localizedName` |

Metro reaches them through `watchFolders: ['../shared']` plus an `@shared` alias in `resolver.extraNodeModules`, spelled identically in `tsconfig.json` and `jest.config.js`. That single move produced the most valuable finding of the phase: a transcription with one consumer is unfalsifiable.

### What the API actually returns, versus what the web client had been typing

The Phase 5 entry records three assumptions caught by running the thing. Extracting the types found **five more** — and every one had a *matching* error in the web's own test fixtures, so the suite was green against a contract the server does not implement. All five reached the screen:

| # | Field | Typed as | Actually served | Consequence on the **web** |
|---|---|---|---|---|
| 1 | `analysis.escalationPath[]` | `{tier, outcome, reasonCode}` | `{provider, reason, status?}` (`cropHealthService.js`, `aiVision.js`, `models/CropHealthLog.js`) | the component relabels the hop as the trace step name, so **every escalation heading rendered the literal string `undefined`** |
| 2 | fertilizer `recommendations[].schedule[]` | `{labelKey, due, timingKey, daysAfterSowing}` | `{stage, timing, fractionKey, note, window, isCurrent, timingUnknown}` (`fertilizerService.js`) | the label fell through to `String(step.stage)`, so the schedule printed **raw enum codes** — `BASAL`, `TOPDRESS_1` — and no entry was ever marked due |
| 3 | `symptomCheck.candidates[].score` | `score` | `matchScore` (`symptomEngine.js#toCandidate`) | `candidate.score * 100` over `undefined` → **`NaN%`** beside every candidate |
| 4 | `analysis.top3[]` | `{code, prob}` | `{diseaseCode, confidence}` — `integrations/mlService.js` normalises the model's own shape before storing | the ranked alternatives were unreadable |
| 5 | `irrigation.soil` | `{soilType, awcMmPerM, published, basis}` | **no top-level `soil` object at all** — only `soilUncertaintyWide: boolean`, with the inputs inside the `SOIL` trace step (`computeIrrigation.js`) | the "we are less sure on unspecified soil" notice **could never fire**: it tested `advice.soil?.soilType === 'unknown'` on a field that does not exist |

Fixtures were rebuilt from the emitting code rather than patched to agree with the new types, and three new web test files close the holes the old fixtures had been hiding: `FertilizerGuidanceView.test.tsx` (6), `IrrigationVerdictCard.test.tsx` (3), `SymptomCheckPage.test.tsx` (3). The escalation test now asserts positively that `ml-service`, `gemini` and `openrouter` each appear by name, that both `uncertain` and `not_configured` reach the panel, and that the string `undefined` does not.

Two properties nobody had written down surfaced while rebuilding those fixtures: `escalationPath` is **empty** when the local model answers, because `runChain()` pushes an entry only for a tier that *declined*, and it never contains the terminal rules tier.

### Defects found and fixed in already-shipped code

| Severity | Finding | Fix |
|---|---|---|
| **HIGH** | **`severityVisual` was never persisted into the health snapshot.** `buildSnapshot()` dropped the AI tier's visual severity estimate, so `POST /crop-health/logs/:id/severity` re-ran the engine with `severityVisual: null` and the farmer's two answers alone decided the level — silently discarding an input `severityEngine.js` documents as "one input among" several. Nothing failed; the number just quietly got worse. | Carried into the snapshot alongside `severityTrace`. |
| **MEDIUM** | **`systemStatus.ml` was hard-coded `'down'`.** Honest while Phase 3 was unbuilt, a lie once the service ships and answers — the dashboard told every farmer the disease model was down while it was classifying their photographs. | Derived from `tierConfig()`: `DISABLE_ML` → `down`; no `ML_SERVICE_URL` → `pending`, because nothing has been deployed to talk to; configured and enabled → `live`. Deliberately **not** a liveness probe — a dashboard request may not call an external service (rule 3) — so it reports how the tier is wired. A tier that is up but failing shows where it matters: the analysis response's own `source` and `escalationPath`. |
| **MEDIUM** | **`communityConsent` had a service function and no route.** `setCommunityConsent` has existed in `communityService.js` since P3-8 and `communityConsent` is on the user model, but nothing was ever mounted in front of it — community sharing was **unreachable from any client**, which is exactly why the web settings page shows the flag read-only (recorded in the Phase 5 "Not done, deliberately" list). | `PATCH /api/v1/users/me` — `backend/src/routes/users.js`, strict Zod body, `requireAuth`, ownership row `none³` (`me` is a literal, not an id), RL 30/h/user, `consent_changed` audit written only on a real transition, consent routed through `communityService` rather than assigned inline. 18 tests. |
| **MEDIUM** | **`disableHierarchicalLookup` broke the Metro build.** The standard monorepo recipe, applied to stop a duplicate React resolving from a parent — but this repo root carries only lint and formatting tooling, no React and no React Native, so there was nothing to shadow. Expo's own transitive dependencies (`expo-asset`, `expo-font`, …) are installed **nested** under `node_modules/expo/node_modules`, which a flat-only resolver cannot see. | Removed, with the reasoning written into `metro.config.js` so it is not re-added from a blog post. `nodeModulesPaths` alone is what `shared/` actually needs. |
| **LOW** | **Two mobile tests asserted impossible things.** One used **Kathmandu** as its example of a coordinate outside India — but `INDIA_BOUNDS` is a crude rectangle, not a border, and Kathmandu (27.7, 85.3) sits *inside* it, as do Colombo and most of Bangladesh; the test would have failed against a correct implementation. The other expected a **six**-decimal rounding but wrote the expectation out to **five** digits. | Dubai replaces Kathmandu, with a comment stating that the check asserts agreement with the server's rectangle and not knowledge of where India ends; the rounding expectation now carries the six decimals the code produces. |

### Engineering decisions

| # | Decision | Why |
|---|---|---|
| 1 | Refresh token in **SecureStore, sent in the request body** | React Native has no cookie jar. The server already accepts a body token on every route that takes one, so the contract did not change to accommodate the phone. The rotated successor is written to SecureStore **before** the new access token is published — a failed write fails the refresh rather than handing out a session whose successor has already been consumed server-side. |
| 2 | Single-flight refresh, one replay | Presenting a rotated refresh token twice is precisely what the server's reuse detector correctly treats as theft. A fan-out of parallel refreshes on a rural connection would revoke the family and sign the farmer out for having bad signal. A security property, not an optimisation. |
| 3 | **A refusal ends the session; a transport failure does not** | The web can treat every refresh failure as terminal because a browser that cannot reach the API has nothing cached to show. A phone has a persisted cache, a farmer standing in a field, and a radio that drops. `refreshSession()` clears SecureStore only when `error.response != null`. Which *kind* of 4xx it was is still never exposed to the caller, so revoked / expired / unknown remain indistinguishable on the wire. |
| 4 | NetInfo checked **before** the bootstrap refresh (RES-11) | The distinction in #3 can only be drawn after an attempt. Offline, no attempt is made at all: the credential survives, the app opens on the persisted cache, and `sessionUnverified` says out loud that nothing has been checked with the server. A NetInfo listener re-runs the real refresh on reconnect, and only a server refusal destroys anything. |
| 5 | **STT: intents-only. No microphone.** | The dev-build path (`expo-speech-recognition`) forfeits the Expo Go demo route `docs/mobile/deployment.md` names as primary; the Groq path needs `POST /voice/transcribe`, which does not exist in `backend/src/routes/` and which no TODO approved. The voice doc's intent layer is input-agnostic by design ("voice, tap, or typed text"), so the intents ship as large tappable targets — an accessibility feature for a low-literacy user, not a consolation prize. `RECORD_AUDIO` is in `blockedPermissions` so it cannot arrive transitively. |
| 6 | **No `locales` block in `app.config.ts`** | `docs/mobile/i18n.md` called for one to localize the OS permission strings. Expo's `locales` compiles to iOS `InfoPlist.strings` **only**, and Android's permission-sheet text is system-generated and cannot be overridden by an app. Android is the only shipped target, so the block would have been inert — a config line that reads like a feature and does nothing. The doc has been corrected. What the farmer reads in their language is our own in-context rationale screen. |
| 7 | `production` EAS profile carries **no** `EXPO_PUBLIC_API_URL` | The staging host does not exist (Render deploy, still owner A). Defaulting it to a domain nobody owns would ship an APK that talks to a stranger. It is passed at build time; the `app.config.ts` fallback is the emulator alias `10.0.2.2`, which cannot leave the machine. |
| 8 | No client idempotency key on upload | The plan called for one with a "server dedupe field reserved P3". The server already does this differently — a `(userId, cropId, imageHash)` cache over the re-encoded bytes answering **200** on a hit (ADR-024 §3–4). A client key would be a second, weaker mechanism for the same job. |
| 9 | The signed-in profile lives in the Query cache, not a third store | It rides the existing persister, is dropped by the same `queryClient.clear()` on logout, and lets an offline cold start greet the farmer by name. |
| 10 | Upload progress is **observed, never timed** | `compressing` ends when the manipulator resolves; `uploading` ends when axios reports every byte delivered; `analyzing` is the real window while the server-side conductor runs. A progress bar that moves without progress is a fabricated status (rule 7). |

### Verification performed (all executed, results real)

| Check | Result |
|---|---|
| `npm --prefix mobile test` | **90 / 90 pass**, 11 suites, ~4s |
| `npm --prefix mobile run typecheck` (`tsc --noEmit`) | clean |
| `npm --prefix backend test` | **1,279 / 1,279 pass**, 255 suites, ~79s (was 1,260) |
| `npm --prefix web/frontend test` | **109 / 109 pass**, 14 files, ~18s (was 97) |
| `npm run lint` (repo) | **0 errors**, 4 warnings — all pre-existing web `react-refresh` HMR warnings |
| `npm run check:i18n` | **1,152 keys · 0 missing in hi · 568 human-verified**; parity check passed |
| `npm run check:ui-strings` | **0 hardcoded user-facing strings** across both client surfaces; 30 files exempt |

Mobile coverage by file: `hooks/useAnalyze.test.ts` 23 · `api/client.test.ts` 16 · `hooks/useGeolocation.test.ts` 11 · `api/session.test.ts` 8 · `hooks/useAppStateRefetch.test.tsx` 6 · `hooks/useOnlineManager.test.ts` 5 · `hooks/usePrefetchRegistry.test.tsx` 5 · `screens/scan/AnalyzingScreen.test.tsx` 5 · `components/domain/WhyTrace.test.tsx` 4 · `components/domain/IrrigationVerdictCard.test.tsx` 4 · `hooks/useOfflineWriteGuard.test.tsx` 3. (An earlier run during this documentation pass read 10 suites / 83 tests and 1,145 i18n keys; the mobile source was being edited concurrently, and every figure in this entry is from the final run.)

Tooling changed to serve two clients rather than one: `scripts/check-ui-strings.mjs` now scans `mobile/src` alongside `web/frontend/src`, and its visible-attribute list gained `accessibilityLabel` / `accessibilityHint` / `accessibilityValue` — a screen reader speaks those verbatim, so an English literal there is as untranslated as visible text. `eslint.config.js` gained `shared/**` and `mobile/**` blocks: RN globals plus bundler-injected `__DEV__`, the `react-hooks` rules, and deliberately **no** `react-refresh/only-export-components`, which describes Vite's fast-refresh boundary and not Metro's. The root `package.json` gained `scan:apk`, `check:ui-strings`, `test:mobile`, `typecheck:mobile`, and a `verify` that runs them.

### Honest limitations shipped in this phase

- **No device has run this app.** No APK has been built, `eas init` has not been run, `extra.eas.projectId` is null, and none of the 17 manual-matrix rows in `docs/mobile/testing.md` has been executed. The bug bar — P0 screens crash-free through the matrix ×2 consecutive runs — has zero runs against it. Everything only a real handset can prove is marked ⏳ MANUAL DEVICE TEST PENDING in the mobile docs and in MASTER-TODO, and nothing anywhere claims it passed.
- **RES-09..12 are not passed.** The pieces they rest on are unit-tested (online manager, write guard, foreground refetch, registry prefetch, the upload machine's retry-same-bytes behaviour, the offline bootstrap branch), but the scenarios themselves are device procedures and are recorded as such in `docs/testing/test-matrix.md`.
- **ST-60's client half is blocked, not done.** `scripts/scan-apk-strings.mjs` exists and searches credential *shapes* rather than a denylist of this project's keys — reporting member, offset and pattern name, never the matched text — but it has never been run against a real APK, because none exists.
- **`mobile` Hindi is 118 keys / 0 human-verified.** Machine-authored, parity-complete, ledgered under `unverifiedAdditions` in `shared/i18n/hi/_verification.json`, with four additions flagged as needing an *agronomic* reviewer rather than only a language one (`irrigation.soilUncertaintyWide`, `irrigation.harvestApproaching`, `fertilizer.timingUnknown`, `market.dailyAverageNote`). `disease` remains 408 / 0 and remains ADR-021 §1's cotton gate.
- **No `@formatjs` ICU polyfill.** `shared/client/format.ts` uses `Intl` unchanged on both surfaces and no handset has been checked for `hi-IN` data. If a low-end Hermes build lacks it, that decision reopens.
- **Devanagari rendering, 1.3× text scaling, thumb reach and every other layout claim are unverified.**
- **`expo-image-manipulator` is untested.** It has no JS-side implementation under `jest-expo`; the compression parameters are code-verified against the server constants they mirror (`MAX_EDGE_PX` 1600 = `MAX_STORED_EDGE_PX`, JPEG q85, an 8 MiB ceiling matching `MAX_UPLOAD_BYTES`).
- **A captive portal still ends the session.** It answers with an HTTP response of its own, which `error.response != null` cannot distinguish from the API saying no. Dead DNS and dropped sockets are now safe; this case is not.

### Not done, deliberately

- **No Detox, no on-device E2E.** Unchanged from the scope `docs/mobile/testing.md` commits to.
- **No deep linking.** `NavigationContainer` is mounted with no `linking` prop, so the plan's "whitelisted screens only, no token-bearing links" holds by construction — there is no surface to whitelist and no parameter to validate. The `khetri` scheme is reserved in `app.config.ts`; the whitelist requirement returns with the feature.
- **No offline write queue.** Writes are blocked and explained, never queued and silently replayed. Still the P3 backlog item it always was.
- **No community write surface on mobile.** The alerts screen is read-only because there is no write route, and a "report this" button that posted nowhere would be worse than its absence.
- **No `name` field on `PATCH /users/me`.** No client edits it, and each of `name`/`email` would need its own verification story. Password change and account deletion stay the separate endpoints `docs/api/users.md` describes.
- **Two dead members left alone** — the mobile source was being edited by another agent during this pass: `MAX_UPLOAD_BYTES` is exported from `services/image.ts` but never checked against the compressed output, and `CropDetailTab` is declared independently in `navigation/types.ts` and `screens/farm/CropDetailTabs.tsx` (same four members today, two declarations that can drift).
- **One doc/code drift left alone:** the header comment in `mobile/src/store/AuthContext.tsx` still describes `refreshSession()` as unable to tell a refusal from an unreachable server and calls closing that gap future work. `api/client.ts` closes it. `docs/mobile/authentication.md` follows the code and records the discrepancy rather than quietly agreeing with the comment.

### Files

Created: the whole of `mobile/` — `app.config.ts`, `eas.json`, `metro.config.js`, `babel.config.js`, `jest.config.js`, `jest.setup.js`, `index.ts`, `README.md`, `.gitignore`, `assets/`, and `src/` (`api/`, `components/`, `config/`, `hooks/`, `i18n/`, `navigation/`, `screens/`, `services/`, `store/`, `theme/`) — plus `shared/types/api.ts`, `shared/client/queryKeys.ts`, `shared/i18n/{en,hi}/mobile.json`, `backend/src/routes/users.js`, `backend/tests/api/users.test.js`, `scripts/scan-apk-strings.mjs`, `web/frontend/src/components/domain/{FertilizerGuidanceView,IrrigationVerdictCard}.test.tsx`, `web/frontend/src/pages/health/SymptomCheckPage.test.tsx`.

Changed: `shared/client/{errors,format,units}.ts`, `backend/src/{app.js, config/constants.js, middleware/rateLimits.js, routes/ownership-table.js, services/cropHealthService.js, services/feedService.js}`, `backend/tests/api/dashboard.test.js`, `web/frontend/src/api/{types,errors,queryKeys}.ts`, `web/frontend/src/lib/{format,units}.ts`, `web/frontend/src/components/domain/{AnalysisResult,AnalysisResult.test,FertilizerGuidanceView,IrrigationVerdictCard}.tsx`, `web/frontend/src/pages/health/SymptomCheckPage.tsx`, `web/frontend/src/test/fixtures.ts`, `eslint.config.js`, the root `package.json`, `scripts/check-{i18n,ui-strings}.mjs`, `shared/i18n/{en,hi}/fertilizer.json`, `shared/i18n/hi/_verification.json`, and the docs: all twelve `docs/mobile/*.md`, `docs/api/users.md`, `docs/database/schema.md`, `docs/security/route-ownership.md`, `docs/testing/test-matrix.md`, `docs/development/MASTER-TODO.md`, and the root `README.md`.

---

## MOBILE — Expo SDK 57 → 54 migration — 2026-08-14

**Dependency versions only. No file under `mobile/src/` changed, and no Phase 6 feature was dropped.** This entry supersedes the stack line in the Phase 6 entry above; everything else in that entry stands.

### Why

The demo handset has **Expo Go 54.0.8** installed and will not be upgraded. Expo Go loads only projects built against its own SDK, so the project's SDK is not a free choice — the client already on the device fixes it. Phase 6 shipped on SDK 57 / RN 0.86.2 / React 19.2.3, which that Expo Go refuses to open, which would have left the Expo Go LAN demo — the path `docs/mobile/deployment.md` names as primary and the advantage ADR-015 chose the framework for — with no device behind it. The EAS APK backup is not available either: it is still `⚠ BLOCKED` on the Render deploy and an Expo account. A framework picked for an instant on-device demo has to match the device that will do the demoing.

### How the versions were chosen

Out of **`expo@54.0.36`'s own `bundledNativeModules.json`**, package by package — not guessed, and not derived by decrementing a major. That matters more than it sounds, because the two SDKs version their modules differently: SDK 57 moves the `expo-*` packages in lockstep at `57.x`, while SDK 54 versions each independently. The correct SDK 54 numbers therefore bear no visible relation to the SDK or to each other, and anything inferred by pattern would have been wrong.

| Package | was (SDK 57) | now (SDK 54) |
|---|---|---|
| `expo` | ~57.0.12 | ~54.0.36 |
| `react-native` | 0.86.2 | 0.81.5 |
| `react` | 19.2.3 | 19.1.0 |
| `expo-camera` | ~57.0.3 | ~17.0.10 |
| `expo-constants` | ~57.0.10 | ~18.0.13 |
| `expo-image-manipulator` | ~57.0.9 | ~14.0.8 |
| `expo-image-picker` | ~57.0.9 | ~17.0.11 |
| `expo-linking` | ~57.0.5 | ~8.0.12 |
| `expo-localization` | ~57.0.1 | ~17.0.9 |
| `expo-location` | ~57.0.9 | ~19.0.8 |
| `expo-secure-store` | ~57.0.1 | ~15.0.8 |
| `expo-speech` | ~57.0.1 | ~14.0.8 |
| `expo-status-bar` | ~57.0.1 | ~3.0.9 |
| `react-native-gesture-handler` | ~2.32.0 | ~2.28.0 |
| `react-native-safe-area-context` | ~5.7.0 | ~5.6.0 |
| `react-native-screens` | ~4.26.0 | ~4.16.0 |
| `react-native-svg` | 15.15.4 | 15.12.1 |
| `@react-native-community/netinfo` | 12.0.1 | 11.4.1 |
| `@react-native-async-storage/async-storage` | 2.2.0 | 2.2.0 — unchanged |
| `jest-expo` | ^57.0.4 | ~54.0.17 |
| `babel-preset-expo` | ~57.0.6 | ~54.0.12 |
| `react-test-renderer` | ^19.2.3 | 19.1.0 |
| `@types/react` | ~19.2.2 | ~19.1.17 |
| `typescript` | ~6.0.3 | ~5.9.2 |
| `i18next` / `react-i18next` | ^26 / ^17 | ^25.2.1 / ^15.5.2 |

### Why no source changed

The two APIs that could plausibly have broken across three SDK majors did not. `expo-image-manipulator`'s **context API** — `ImageManipulator.manipulate()` → `renderAsync()` → `saveAsync()`, which `services/image.ts` is written against — already exists in 14.0.8. The `expo-camera` surface the scan screens use matches 17.x as written. So the compression path, the camera permission branches, the offline persistence, TTS, the upload state machine and all 24 screens are byte-identical to what Phase 6 verified.

### Verification performed (all executed, results real)

| Check | Result |
|---|---|
| `npx expo install --check` | **Dependencies are up to date** |
| `npx expo-doctor` | **18 / 18 checks passed** |
| `npx tsc --noEmit` | **0 errors** |
| `npx jest` | **11 suites / 90 tests pass** — identical to SDK 57 |
| `npx eslint mobile/src` · `npm run format:check` | clean |
| `npx expo start --lan` | manifest serves `"sdkVersion":"54.0.0"`, `"runtimeVersion":"exposdk:54.0.0"`, `extra.apiUrl` = the LAN URL |
| Android bundle over LAN | **HTTP 200, 8.2 MB, 1321 modules** |
| `npx expo export --platform android` | **3.55 MB Hermes bundle**, clean |
| ST-60 `npm run scan:apk --bundle <hbc>` | **PASS**, and the scanner was proven able to read strings out of that bundle |

The `ERR_INVALID_ARG_TYPE` noise the SDK 57 CLI printed on start no longer appears at all.

That ST-60 run is the **first time the client-half scanner has been pointed at a real artefact**. It is a Hermes bundle from `expo export`, not an APK, so ST-60's APK half remains blocked — but the scanner is no longer merely written: it read strings out of a genuine compiled bundle and returned PASS, which is the part of it that had never been exercised.

### Still true, unchanged by this migration

**No APK has been built and no physical device has run this app** — not on SDK 57, not on SDK 54. `eas init` has not been run, `extra.eas.projectId` is null, and none of the 17 rows of the manual matrix in `docs/mobile/testing.md` has been executed. The pin is reasoned from the handset's stated Expo Go version, not from an observed successful launch; every device row stays ⏳ MANUAL DEVICE TEST PENDING. The Hindi verification state, the captive-portal limitation, the absent ICU polyfill and the untested `expo-image-manipulator` are all exactly as the Phase 6 entry left them.

### The cost, recorded

SDK 54 is behind current, and the project carries that gap for as long as the pin holds. The pin is to **a device, not a date**: if that handset's Expo Go changes — reinstall, replacement phone, store update — the SDK moves with it and the app has to be re-tested against whatever Expo Go the device then has. Dependency additions are no longer free-hand; anything new must resolve against SDK 54, checked with `expo install --check` and `expo-doctor`. Recorded as a decision in `docs/mobile/technology-decision.md`.

### Files

Changed: `mobile/package.json` (+ `package-lock.json`), `mobile/README.md`, `docs/mobile/technology-decision.md`, `docs/mobile/architecture.md`, `docs/development/MASTER-TODO.md`, this file, and the root `README.md`. Nothing under `mobile/src/`.

---

## Phase 9 (partial) — repo deliverables, product name, status honesty — 2026-08-14

The repo-artefact half of Phase 9. What needs the team in a room — rehearsal, the deck,
the viva walkthroughs — is untouched and still open.

### P9-1 · Repo deliverables

**`architecture-diagram.png`** rendered at 2400px with `@mermaid-js/mermaid-cli` from a
committed **`architecture-diagram.mmd`**. The source is kept beside the binary
deliberately: a PNG cannot be reviewed in a diff, so a diagram-only artefact drifts from
the system it claims to depict and nobody notices. The diagram shows the two clients over
one REST contract, the middleware chain, the eight pure engines separated from the
services that do the I/O, the scheduled ingestion jobs, and the external providers with
their fallback pairs.

**`api-documentation.md`** at the repo root — the single-page reference the submission
asks for. All **38 routes**, transcribed from `backend/src/routes/ownership-table.js`
rather than from prose. That matters: a test asserts that table against the live Express
router, so this document cannot drift from the mounted routes without the suite failing.
It also carries the envelope, the closed error-code set, the four ownership shapes, the
four decision engines, the `freshness`/`trace` honesty contract, the rate limits and the
five-step upload pipeline. Per-resource field detail stays in `docs/api/` — this indexes
it, it does not replace it.

**`README.md`** rewritten against real run output only: 1,566 backend · 131 web · 110
mobile · 143 ml-service (+1 known pre-existing manifest-hash failure, unchanged since
`29543d1` and left for the ML owner rather than silently regenerated).

### P9-2 · The product is Khetri (closes OD-4)

`KrishiSaarthi` was a placeholder from the plan document and had leaked into 12 files.
Renamed across all of them — display strings *and* the Android identifiers:
`package` → `in.him1096.khetri`, `slug` → `him-1096-khetri`, deep-link `scheme` → `khetri`.

Renaming the package is only cheap because **no APK has ever been built**. After a first
install, an Android package rename is a different application: no upgrade path, and every
tester reinstalls from scratch. This was the last moment it costs nothing.

Verified: mobile `tsc --noEmit` clean and `mobile/src/security.test.ts` **20/20** — that
suite asserts the declared scheme and the absence of a deep-link router, so a half-finished
rename would have failed it rather than passing quietly.

### P9-3 · Status honesty pass

Phase headers, the README status block and the deliverables list now match what the suites
actually print. The substantive change is stating the **deferred-vs-blocked** distinction
for Phase 8 rather than leaving a reader to infer it from an unticked box.

**Phase 8 is deferred by decision, not blocked by a dependency.** Every free tier this
project runs on — Render's spin-down window, Atlas M0, HF Spaces, Vercel, an Expo account
and its EAS build quota — begins consuming a finite allowance the moment it is
provisioned. Spending those windows before the qualifier result is known spends them on
nobody. Everything that can be prepared without an account is committed and locally
verified: `render.yaml` with every secret `sync: false`, the environment checklist, and
`backend/scripts/smoke.mjs` passing **18/18** against a local `NODE_ENV=production` server
on a real database. On qualification the deploy is an execution step measured in hours.

### Still true, unchanged

**Nothing is deployed, no APK exists, and no physical device has launched this app.** The
17-row matrix in `docs/mobile/testing.md` has zero executed rows; RES-09..12 are unpassed;
the CI workflow in `.github/workflows/ci.yml` has never run. None of that is claimed
anywhere in this repository.

### Files

Added: `architecture-diagram.mmd`, `architecture-diagram.png`, `api-documentation.md`.
Changed: `README.md`, `CLAUDE.md` (OD-4 closed), `docs/development/MASTER-TODO.md`,
`mobile/README.md`, `mobile/app.config.ts`, `mobile/src/security.test.ts`,
`web/frontend/index.html`, `docs/product/product-spec.md`, `docs/mobile/navigation.md`,
`docs/mobile/deployment.md`, `docs/security/phase-7-scorecard.md`, and this file.
