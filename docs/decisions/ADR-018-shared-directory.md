# ADR-018 · shared/ directory (i18n, constants, schemas, types)
**Status:** Accepted · 2026-08-12
**Decision:** repo-level `shared/` holds canonical i18n resources, constants (geo, agronomy, voice-intents, climate normals), and cross-surface schemas/types; web imports directly (Vite), mobile via metro watchFolders, backend via relative path. No npm-workspace publishing ceremony.
**Reason:** single source for translations and domain constants across three JS consumers — the alternative (copies) guarantees drift within 72h.
**Trade-offs:** metro config nuance (documented at scaffold); backend↔frontend shared zod schemas used selectively (server remains authority).
