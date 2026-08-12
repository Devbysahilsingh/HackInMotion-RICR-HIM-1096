# Technical Viva Preparation

Format: Q → the concept we must be able to explain (not scripts to recite). Walkthroughs scheduled (team-plan). Answers must match committed artifacts — no claims beyond evaluation reports.

## Architecture
Why MERN+FastAPI split? (runtime isolation, key isolation, independent deploy — ADR-001) · Why DB-first reads? (resilience + latency + quota; jobs own external I/O) · Scaling path? (stateless API → horizontal; jobs → extracted worker; Atlas tier bump; CDN already; ml-service replicas) · Why no microservices beyond ml? (team size; complexity budget — deliberate).
## Database
Why Mongo? (document fit for registry/KB + iteration speed; ADR-002) · Ownership model? (denormalized userId, AU-invariants) · Why 404 not 403? (existence non-disclosure) · Index strategy? (per named query; M0 memory).
## ML (hardest section — Dev A must own this)
Why EfficientNet-B0? (accuracy/size/4GB envelope; table) · Transfer learning staging? (head warmup → partial unfreeze; catastrophic-forgetting avoidance) · Class imbalance? (weighted sampler + CE; macro-F1 primary) · **Domain gap?** (PV lab images; PlantDoc field test; number disclosed; Grad-CAM background probe) · Calibration? (temperature scaling; ECE; why raw softmax overconfident) · Threshold derivation? (precision-coverage curve, not guessed; stricter healthy gate + why) · Leakage prevention? (pHash cross-set dedup, cluster-atomic splits) · Why unified+masking vs per-crop models? (ADR-005) · Metrics honesty? (artifacts committed; failed runs logged).
## AI
Why Gemini AND custom ML? (specialization+cost+offline-path vs breadth; chain) · Hallucination control? (schema-constrained, closed code list, KB-only advice — "AI perceives, engines decide, KB speaks") · Prompt injection? (quarantined description, re-encoded images).
## Irrigation (the agronomy flex)
FAO-56 walkthrough with real numbers (ETc=ET₀×Kc; TAW/RAW; ledger) · assumptions owned (0.8 effective rain, AWC table, 60% prob threshold) · why not soil sensors (cost; stated estimate) · rice special-casing.
## Security
JWT rotation + reuse detection story · upload pipeline (re-encode = polyglot kill) · why no admin panel (surface elimination) · secrets lifecycle · what we'd add with time (CSRF-double-submit if cookies widen, pinning, WAF).
## Resilience/Cost
Chain per dependency (table) · validate-then-cache · why zero cost holds at 10× users (quota math) · first paid dollar? (Atlas tier or Render always-on, ~$7).
## Product/impact
Why these 9 crops · farmer-centric loop · honest limitations recital (rehearsed verbatim — turning weaknesses into credibility) · future scope with hooks already built.
