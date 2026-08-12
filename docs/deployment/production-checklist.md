# Production Checklist (Day 3 gate — every box or documented exception)

## Pre-deploy
- [ ] All blocking test suites green (strategy.md table)
- [ ] npm audit (backend/web/mobile) + pip-audit: no high/critical
- [ ] Gitleaks full-history clean; .env absent; .env.example current
- [ ] i18n parity script clean; Hindi verification sign-off recorded
- [ ] Registry + KB seeds applied (versioned seedMeta); demo farm seeded; market seed loaded
- [ ] Model artifact = evaluated version (manifest hash matches evaluation report)
## Deploy sequence
- [ ] Atlas reachable, indexes built (script asserts)
- [ ] ml-service live, /healthz modelVersion correct, latency spot-check
- [ ] Backend live, /healthz green (db+jobs), CORS verified from prod web origin
- [ ] Jobs primed manually (weather+market fetch succeeded — freshness ● Live visible)
- [ ] Web deployed, API URL correct, no secrets in bundle
- [ ] Keep-alive ping + UptimeRobot active
- [ ] Mobile: Expo Go verified on demo phone; EAS APK triggered/installed
## Post-deploy
- [ ] Smoke suite vs prod (auth round-trip, dashboard, weather, market, analyze with test image, headers)
- [ ] Failure-injection rehearsal on STAGING flags... (prod flags disabled — verify FORCE_FAIL_* absent in prod env)
- [ ] Demo accounts: fresh signup works; seeded farmer loads rich
- [ ] README deployment URLs updated; architecture-diagram.png committed; api-documentation.md current
- [ ] Recorded video backup of full demo flow captured
