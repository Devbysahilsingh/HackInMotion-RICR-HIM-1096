# shared/

Canonical, cross-surface assets consumed by **backend**, **web** and (from Phase 6) **mobile**. Rationale and consumption mechanics: `docs/decisions/ADR-018-shared-directory.md`.

| Folder | Contents | Consumed by |
|---|---|---|
| `i18n/` | Canonical `en/` + `hi/` translation namespaces — the single source for both clients (`docs/i18n/architecture.md`) | web, mobile |
| `constants/` | Domain constants: geo (states/districts), agronomy (soil AWC tables), voice intents, climate normals | backend, web, mobile |
| `schemas/` | Shared validation schemas where client and server genuinely agree (the server always remains the authority) | backend, web, mobile |
| `types/` | Shared TypeScript types for API DTOs | web, mobile |

**Import paths:** web uses the `@shared/*` alias (`vite.config.ts` + `tsconfig.json`); backend imports by relative path; mobile will use a metro `watchFolders` entry.

Folders are intentionally empty until the TODO that introduces each concern populates them — no speculative content.
