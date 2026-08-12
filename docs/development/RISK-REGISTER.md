# Risk Register

P=probability, I=impact (H/M/L). Owner drives mitigation; contingency = pre-decided plan B (no mid-crisis design).

| ID | Risk | P | I | Mitigation | Contingency | Owner |
|---|---|---|---|---|---|---|
| R1 | Scope (web+mobile+ML+6 challenge features) vs 1–2 humans | H | H | Claude executes bulk; phased TODO with hard cut-order checkpoints (h48/h60); web = fallback demo surface | Execute cut-order; mobile MVP floor = auth+camera+dashboard | A |
| R1b | Solo mode: review depth + Hindi verification capacity | M | M | prioritized review targets (security, engines); verified-subset i18n rule | External Hindi reviewer; ship verified screens only | A |
| R2 | Dataset surprises (labels, dedup inflation, licenses) | M | H | Day-0 audit gate BEFORE training; cotton demotion pre-agreed; class merge playbook | Drop affected classes/crops; registry flip; announce | C |
| R3 | Model misses ship gates | M | M | ResNet18 baseline early warning; 2 overnight windows; per-crop demotion rule | Ship Gemini-primary for weak crops (product unaffected — chain design) | C |
| R4 | data.gov.in key delay/flaky (OD-5) | H | M | apply hour 0; nightly cache; CEDA seed ready | Launch on seed labeled Historical; retry job | A |
| R5 | Field-photo accuracy ≪ lab metrics | H | M | measured on PlantDoc + disclosed; confidence gating; Gemini escalation | Raise τ (more escalations); demo with dataset-style printed leaves (disclosed as such) | C |
| R6 | Render cold start / free-tier sleep during judging | M | M | keep-alive q10min; demo warm-up step; client GET retry | Local backend run as emergency demo host (documented switch) | A |
| R7 | Expo Go network issues at venue | M | M | EAS APK installed on phone Day 3 morning; tunnel mode rehearsed | APK-only demo; web mobile-viewport as visual backup | B |
| R8 | Gemini free-tier change/exhaustion | L | M | quota monitor; usage ≪ limits; OpenRouter tier | Rules tier + recorded Gemini demo segment | C |
| R9 | GPU/laptop failure mid-training | L | H | checkpointing (resume-safe); configs+code pushed continuously | Colab free T4 fallback (scripts are env-agnostic; documented) | C |
| R10 | Venue internet dead during demo | M | H | cache-first app survives (that's the feature); backup video of every flow; mobile hotspot | Video-led demo + local stack | A/B |
| R11 | Secret leak to repo | L | H | Gitleaks hook+CI+history scan; env-only policy | Immediate rotation + BFG procedure (documented) | A |
| R12 | i18n parity slip (Hindi lag) | M | M | parity script blocking Day 3; verification sessions scheduled; priority order defined | Ship verified screens; en-fallback flagged visibly (never silent) | B |
| R13 | Mendeley/chilli license stricter than expected on download | L | M | exact texts captured at audit | Chilli → GENERAL tier; classes dropped; announced | C |
| R14 | EAS build queue > hours on Day 3 | M | L | trigger morning; Expo Go primary | Expo Go/tunnel only | B |
| R15 | Atlas M0 512MB pressure (market history) | L | L | 180-day purge; per-state filters; size budget doc | Tighten to 90-day + demo states only | C |
| R16 | Judges challenge pre-trained-during-window legitimacy | L | M | training logs/timestamps kept; experiments.md history | Show live fine-tune epoch as evidence | A |
| R17 | Voice device quirks on demo phone | M | L | test on exact phone Day 2; TTS-first strategy; intent buttons fallback | Drop STT from demo; show TTS + buttons | B |
Review cadence: risks re-scored at each roadmap checkpoint (h24/48/60); new risks appended, never overwritten.
