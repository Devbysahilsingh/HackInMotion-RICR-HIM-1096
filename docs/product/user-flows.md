# User Flows

Notation: each flow lists happy path → alternates/errors. All states localized (en/hi).

## UF-1 First run & registration
Open app → language select (हिंदी default if device locale hi) → value intro (3 cards, skippable) → register (name, email/phone, password) → login → empty dashboard with guided "Create your farm" CTA.
- Errors: duplicate email (generic message — no enumeration), weak password (inline rules), offline (queue nothing; explain — auth requires connectivity).

## UF-2 Farm setup
Dashboard CTA → New farm → location: [Use GPS] (mobile permission flow; fallback manual) or state→district picker → land size + unit (acre default, hectare/bigha option) → soil type picker (8 options + "don't know" → advice degrades gracefully + soil-test nudge) → irrigation method (canal/borewell/rainfed/drip/sprinkler/unknown) → save → prompted to add crop.
- Missing GPS permission: picker path, no dead end. Invalid size: inline validation.

## UF-3 Add crop
Farm → Add crop → registry search/picker (shows support badge: Specialized AI / General / Limited) → sowing date (calendar, defaults to today; future dates = "planned crop") → optional variety/area → save → crop card appears with stage timeline; engines activate on next refresh (≤ minutes).
- Unsupported crop typed: create as LIMITED with explicit coverage notice; weather/irrigation-generic still works. Never block, never fabricate.

## UF-4 Daily check (the core loop)
Open app → dashboard: prioritized feed (🔴 CRITICAL → 🟢 INFO) + per-crop status cards → tap any item → detail with verdict, why-trace, action buttons (e.g., "Mark irrigated", "Scan crop", "View market") → act → item acknowledged → history updated.
- All external APIs down: feed renders from last-known-good with ● Cached badges + age. Nothing blank.

## UF-5 Crop health scan (hero mobile flow)
Scan tab → pick crop (single-crop farms auto-select) → camera (or gallery) → client compress → upload (progress bar; retry on fail; draft saved offline for later upload — P2) → analyzing state (≤15s) → result: diagnosis + confidence + severity assessment + what-to-check + next steps + prevention + "consult expert" threshold guidance → saved to history; if diseased and user consents, feeds community aggregation (district-level only).
- Low confidence: designed outcome — "couldn't identify confidently" + retake tips + symptom-checklist path (rule engine) + Gemini escalation transparently labeled.
- Image rejected (size/type/not-a-plant): specific localized message + guidance.

## UF-6 Irrigation decision
Crop card → irrigation verdict (IRRIGATE_TODAY / IRRIGATE_IN_N_DAYS / WAIT_RAIN_EXPECTED / NO_NEED) + amount + why-trace (ET₀, Kc, stage, soil water, rain forecast) → "I irrigated today" button → ledger updated → balance recomputed.
- No ET₀ (fallback weather source): rain-based mode, labeled "simplified guidance".

## UF-7 Market check
Market tab → user's crops preloaded → 30-day trend chart + RISING/FALLING/STABLE signal + plain-language guidance + nearby mandi comparison → freshness label (mandi data is often 1–3 days old — always dated).

## UF-8 Crop recommendation (P1)
Wizard: farm auto-filled (location/soil/season) + water availability question + preference (food/cash crop) → scored list with reasons per crop ("Suitable: Kharif ✓, black soil ✓, moderate water vs your borewell ✓; caution: price volatility") → save as planned crop.

## UF-9 Fertilizer guidance (P1)
Crop detail → Fertilizer tab → stage-based guidance (nutrient focus now, timing, deficiency signs to check) + soil-test nudge; dosage ranges only with source attribution, labeled educational.

## UF-10 Voice (P2)
Mic button (dashboard) → listening state → recognized text shown (editable) → intent matched (6 intents) → answer card + TTS readout in user language.
- Unrecognized: "Try asking: …" examples. No mic permission: hide button, tooltip explains.

## UF-11 Community alert (P2)
≥3 distinct farmers, same district+crop+disease, 7-day window → district advisory generated → appears in feed of farmers with matching crop+district ("14 reports of tomato early blight in Nashik this week — inspect your crop"; INFO/HIGH by count). No reporter identity, ever.

## UF-12 Offline open (mobile, P2)
Airplane-mode open → cached dashboard/weather/market/history readable, all ● Cached-labeled with age → writes disabled with explanation → auto-refresh on reconnect.
