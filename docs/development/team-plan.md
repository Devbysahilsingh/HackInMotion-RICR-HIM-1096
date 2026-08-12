# Team Plan (1–2 humans + Claude as executing engineer)

`[DECISION REQUIRED OD-3: confirm 1 or 2 humans — plan below covers both]`

## Roles
**Dev A — Sahil (confirmed):** product owner + reviewer of record. Owns: backend domain decisions, security review sign-off, deployments + env/secrets, account/key management (Kaggle, data.gov.in, Gemini, Atlas, Cloudinary, Render, Vercel, HF), demo driving, viva lead. Genuine commits: backend features he implements/modifies during review-iterate cycles, security test suite runs+fixes, deployment configs, seed data authoring.
**Dev B (if present):** owns web+mobile UX implementation passes, **Hindi terminology verification (mandatory human task)**, manual mobile test matrix execution, demo script + presentation.pptx, market/fertilizer KB data entry from sourced docs. Genuine commits: screens/components, i18n resources, test matrix reports, pptx/docs.
**Claude (me):** ML pipeline end-to-end (download→audit→train→evaluate→export→integrate) with all majors reported for approval; code scaffolding + engine implementations + integrations + test suites; documentation upkeep. Everything lands via PRs reviewed by Dev A (and B in their areas).

## Solo-mode deltas (1 human)
Dev A absorbs review of all areas (accepting lighter review depth — flagged risk R1b); mobile MVP narrows (feature-scope cut order); Hindi verification becomes Dev A task with external help if available (fallback: verified-subset shipping rule in translation-strategy applies); presentation built from docs by Claude, edited by Dev A.

## Contribution integrity
GitHub history reflects real ownership above — meets "meaningful contributions" requirement without manufactured commits. Claude-authored commits carry co-author trailer; human commits are humans' actual work (reviews-with-changes, data curation, tests, configs, UX passes). Walkthrough sessions (Day 2 night + pre-viva): every team member can explain every subsystem — scheduled, not optional (viva requirement "team understands the project").
