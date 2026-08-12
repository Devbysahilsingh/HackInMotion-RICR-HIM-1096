# Deployment Architecture (all free-tier, no card)

| Component | Host | Plan/limits | Notes |
|---|---|---|---|
| Web | Vercel Hobby | generous static+CDN | preview deploys per PR |
| Backend | Render free web service | sleeps 15min idle → ~50s cold start | **keep-alive: cron-job.org ping /healthz q10min** during hackathon window + UptimeRobot monitor |
| ml-service | HF Spaces (Docker, CPU basic) — primary; Render second service — alt (**OD-2**: decide after Day-1 latency spike test on real image round-trip) | Spaces sleep after inactivity; CPU basic free | model baked in image (~20MB) |
| DB | MongoDB Atlas M0 | 512MB | IP allowlist limitation documented (threat model §5) |
| Images | Cloudinary free | 25 credits/mo | ample for demo scale |
| Mobile | Expo Go + EAS APK | free build queue | docs/mobile/deployment.md |

Deploy order: Atlas (+seed) → ml-service (healthz green) → backend (env wired, healthz green, jobs primed via manual trigger scripts) → web (API URL env) → mobile config → smoke suite → keep-alive/monitors on.
Health checks: backend /healthz {status, db, jobs lastRun, services circuit states — auth-free, internals-free}; ml /healthz {status, modelVersion}.
Cold-start mitigations: keep-alive; demo script warms both services before stage; first-request retry in clients (one transparent retry on 502/timeout for GETs).
CORS: exact Vercel prod URL + localhost dev (env CORS_ORIGINS). No wildcard, credentials on auth path only.
