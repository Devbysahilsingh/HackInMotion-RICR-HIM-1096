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
