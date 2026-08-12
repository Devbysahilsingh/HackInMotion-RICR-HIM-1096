# Architecture Overview

```mermaid
flowchart TB
  subgraph Clients
    W[Web · React+Vite · Vercel]
    M[Mobile · React Native/Expo · Android]
  end
  subgraph Backend [Node 20 + Express · Render]
    GW[API /api/v1 · JWT + ownership + Zod + rate limits]
    ENG[Engines (pure): irrigation FAO-56 · weather risk · market signal · crop-rec scoring · symptom rules · feed composer]
    JOBS[Jobs: weather q3h · market nightly · feed q30m · community q6h]
    INT[Integrations: Open-Meteo→OWM · data.gov.in · Gemini→OpenRouter · Cloudinary · Groq(P2)]
  end
  DB[(MongoDB Atlas M0)]
  MLS[ml-service · FastAPI+ONNX CPU · HF Spaces/Render]
  EXT1((Open-Meteo)); EXT2((OpenWeatherMap)); EXT3((data.gov.in)); EXT4((Gemini)); EXT5((Cloudinary))

  W -->|HTTPS JSON| GW; M -->|HTTPS JSON| GW
  GW --> ENG; GW --> DB; JOBS --> INT; JOBS --> DB; ENG --> DB
  GW -->|X-Service-Key| MLS
  INT --> EXT1; INT --> EXT2; INT --> EXT3; INT --> EXT4; INT --> EXT5
```
(architecture-diagram.png rendered from this mermaid source at implementation time — deliverable requirement.)

## Component responsibilities
- **Clients:** presentation + i18n rendering + client caching (React Query; mobile + AsyncStorage persistence). No business logic, no external API calls, no secrets.
- **Express backend:** the only public API. Auth, authorization, validation, orchestration, quotas. **Request path never calls weather/market providers** (DB-first rule); AI chain is the sole synchronous external interaction (bounded 15s budget).
- **Engines:** pure deterministic modules — input data, output verdict+trace. Unit-testable, viva-explainable, no I/O.
- **Jobs (node-cron in-process):** external data ingestion with validate-then-cache; feed composition; community aggregation. In-process cron on free tier (accepted trade-off: job pauses if instance sleeps → keep-alive ping; documented).
- **ml-service:** single-purpose inference (isolation rationale: python ML runtime separation, independent deploy/scale, key isolation). Internal contract only.
- **MongoDB:** system of record + external-data cache layers.

## Principles (decision log refs)
DB-first reads (ADR-008) · registry-driven crops, no crop conditionals (ADR-004) · pure engines (ADR-*) · one API for both clients (ADR-013) · AI perceives/engines decide/KB speaks (ADR-006) · zero-cost stack (ADR-011) · production security config in demo (ADR-009).
