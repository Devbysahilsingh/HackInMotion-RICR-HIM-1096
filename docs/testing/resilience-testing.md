# Resilience Testing (failure-injection matrix)

Flags (non-prod env only, routing-layer only): FORCE_FAIL_OPENMETEO/OPENWEATHER/DATAGOVIN/GEMINI/OPENROUTER/ML/CLOUDINARY, FORCE_SLOW_<SVC>=ms.

| # | Scenario | Expected behavior | Verify |
|---|---|---|---|
| RES-01 | Open-Meteo down | OWM fallback; et0 absent → simplified mode labeled | snapshot source, verdict mode, UI label |
| RES-02 | both weather down | snapshot preserved, status stale; ● Cached + age | DB status; UI |
| RES-03 | malformed weather payload | fetch rejected; cache untouched; logged | validator log, snapshot unchanged |
| RES-04 | ml-service down | Gemini tier; source 'AI-assisted' | chain log, source label |
| RES-05 | ML+Gemini down | OpenRouter → rules; guided-assessment result | UI + log |
| RES-06 | all AI down | rules answer; app fully functional | E2E branch |
| RES-07 | data.gov.in down (nightly) | history serves; job logs failure; no data loss | job report |
| RES-08 | slow external (12s) | timeout at 8s → tier/fallback; request completes ≤ budget | latency assertion |
| RES-09 | mobile cold-start offline | cached dashboard renders + banners | manual matrix |
| RES-10 | connection drop mid-upload | retry UX, image retained, no orphan logs | manual |
| RES-11 | token expiry offline (mobile) | read-only cached mode, no wipe | manual |
| RES-12 | recovery (flags off) | labels flip to ● Live on next fetch; no stuck state | toggle test |
Plus: Mongo-down probe (dev only) → honest 500 envelope, process stays alive; cron overlap guard (job lock flag). Run: scripted portions Day 3 + full manual pass in demo rehearsal (incl. the staged RES-02 demo moment).
