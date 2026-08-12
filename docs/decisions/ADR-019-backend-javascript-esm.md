# ADR-019 · Backend in JavaScript (ESM), independent package per app

**Status:** Accepted · 2026-08-12 (implemented in P0-3)

**Context:** The approved plan fixed Node + Express but deliberately left the language open ("JS, or TS if scaffolded so"). The repo also needs a package layout that will still work when Expo joins in Phase 6.

**Decision:**
1. Backend is **JavaScript with ES modules** (`"type": "module"`), with Zod for runtime validation and JSDoc types where they aid readability. Web and mobile remain TypeScript.
2. **No npm workspaces.** Each app owns its `package.json`; the root package carries only shared tooling (ESLint, Prettier, TypeScript, hooks) and orchestration scripts.
3. Configuration loads via Node's native `--env-file` in development; production reads host-injected environment variables. No `dotenv` dependency.
4. **Express 5**, whose native async error forwarding removes the need for an async-wrapper dependency.

**Alternatives considered:**
- *TypeScript backend* — better compile-time safety, but adds a build step to every run and deploy (or a `tsx` runtime loader on Render), for a service whose real risk surface is untrusted input at runtime. Zod already guards that boundary.
- *npm workspaces* — nicer single-install ergonomics, but hoisted `node_modules` is a well-known source of metro/Expo resolution failures; debugging that mid-hackathon would be expensive.
- *dotenv* — one more dependency for something Node 20 does natively.

**Trade-offs:** No compile-time types in backend code; mitigated by Zod at every boundary, JSDoc on shared utilities, and the fact that engines are pure functions with fixture tests. One `npm install` per app instead of one at the root — an acceptable cost for Phase-6 safety.

**Revisit if:** shared DTO types between backend and clients start drifting badly, at which point `shared/types` plus JSDoc `@import` can close the gap without a full TS migration.
