# Git / GitHub Workflow

Repo: `HackInMotion-HIM-1096` (naming per general instructions). Required artifacts at root: README.md, architecture-diagram.png, api-documentation.md (generated summary of docs/api/), presentation.pptx.

## Branching
`main` = always-demoable (protected by convention: no direct pushes after Day 1 morning). Branches: `feat/<area>-<slug>`, `fix/…`, `docs/…`, `ml/<experiment>`. Short-lived (≤1 day), merged via PR.
## PRs
Small, single-purpose; description: what/why + FR refs + test evidence; reviewer = the non-author human (Claude-authored code ALWAYS human-reviewed — team rule); merge = squash for features, merge-commit for day milestones; CI-substitute: PR checklist (tests run locally, lint, Gitleaks hook passed, i18n keys added).
## Commits
Conventional: `feat(irrigation): implement FAO-56 depletion ledger`, `test(auth): refresh rotation suite`, `docs(ml): dataset audit results`, `ml(training): effnet-b0 run 2 config`. Genuine work only — **no fake/split/padding commits; contribution requirements are met by real ownership** (team-plan.md); Claude co-author trailer on Claude-generated commits per CLI convention.
## Cadence & milestones
Push at least every 2–3 hours of work (progress evidence + backup); tags `day-1`, `day-2`, `day-3`, `submission`; daily milestone = demoable increment noted in tag message.
## Hygiene
Gitleaks pre-commit; .gitignore: .env, node_modules, datasets/ (except README+manifest), model artifacts >LFS-threshold, build outputs; no force-push to main; secrets incident procedure in docs/security/secrets-management.md.
