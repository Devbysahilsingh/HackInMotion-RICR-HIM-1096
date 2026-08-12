# ADR-020 · Two-layer secret-scanning pre-commit gate

**Status:** Accepted · 2026-08-12 (implemented in P0-3)

**Context:** The plan specified Gitleaks as the pre-commit secret gate. Reconnaissance found Gitleaks is **not installed** on the development machine, and it cannot be assumed present on a teammate's or judge's machine. A hook that skips its check when the tool is missing provides the *appearance* of protection — precisely the "fake security" CLAUDE.md forbids.

**Decision:** Two layers in `.githooks/pre-commit`:
1. **Layer 1 — `scripts/scan-staged-secrets.mjs` (always runs).** Dependency-free Node scanner over staged files: forbidden paths (`.env`, `*.pem`), provider key patterns (Google, Anthropic, OpenAI, OpenRouter, Groq, AWS, GitHub, Slack), private-key blocks, credential-bearing MongoDB/Cloudinary URIs, and generic long-secret assignments. Documentation placeholders are excluded; findings are **redacted** in output (prefix + length only); a `pragma: allowlist-secret` comment handles genuine false positives.
2. **Layer 2 — Gitleaks (runs when installed).** Full upstream rule set for depth, configured by `.gitleaks.toml`; prints an informational note when absent.

The hook is enabled automatically by `npm install` at the repo root (`prepare` → `git config core.hooksPath .githooks`).

**Alternatives considered:** Gitleaks-only (silently absent on most machines — rejected); Gitleaks required, blocking all commits until installed (hostile onboarding mid-hackathon); husky + lint-staged (another dependency for what one `prepare` line does).

**Trade-offs:** Layer 1's rule set is narrower than Gitleaks' and pattern-based, so it can miss exotic credential formats and can false-positive on long random-looking strings — hence the allowlist pragma. It is a gate, not a guarantee: the primary control remains "secrets live only in environment variables" (`docs/security/secrets-management.md`).

**Verified in P0-3:** a planted fake Google API key was blocked with the value redacted, no commit was created, and a clean staged tree passed.

**Update (verification pass 2, 2026-08-12):** Gitleaks 8.30.1 is now actually installed (winget, official release, hash-verified) and on the user PATH, so layer 2 runs in practice — clean scan, fake-secret detection, and pre-commit blocking were all exercised against the real binary.

Two allowlist defects were found and fixed while testing, both of which had made the gate weaker than it appeared:
- Allowlisting any match containing the word **"example"** suppressed AWS's own published test access key — a file full of fake credentials scanned as clean. Broad value regexes are now gone from both layers; only `<…>`, `your_`, `placeholder` and `changeme` remain in layer 1.
- The Gitleaks config **path-allowlisted all of `docs/`**, exempting the repo's largest body of text. Verified the docs tree scans clean and removed the exclusion.

Lesson recorded for future rules: an allowlist entry that matches on a *word inside the secret* silently disables detection; prefer excluding whole files that exist to hold placeholders. No credential-shaped literal is kept anywhere in the repository, including inside the detectors' own comments.

**Update (verification pass 3, 2026-08-12):** two further layer-1 gaps were found and closed while investigating a reappearing test file:
- **Unquoted assignments were uncovered** — the generic rule required quotes, exempting `.env`/`.ini`/`.yaml`-style `KEY=value` lines unless the value matched a provider pattern. Quotes are now optional.
- **`\b` cannot match inside snake_case** — `\baccess[_-]?key` never fires within `aws_access_key_id`, because underscore is a word character. The leading `\b` was removed.
- The Google rule now matches `AIza` + 20 or more characters instead of the exact 39-character form, so truncated key fragments are also blocked.

Verified: all three assignment styles are detected, and the full repository (including all documentation and `.env.example`) yields zero false positives. Rule-writing lesson: **test each rule against the naming style it is meant to catch** — regex anchors that look correct can silently exempt an entire class of names.
