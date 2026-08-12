# ADR-011 · Zero-cost hosting/service set
**Status:** Accepted (OD-2 ml-host pending latency test) · 2026-08-12
**Decision:** Vercel (web) · Render free + keep-alive (backend) · HF Spaces Docker primary / Render alt (ml) · Atlas M0 · Cloudinary · Expo Go/EAS. No credit card anywhere; Gemini/OpenRouter/Groq free tiers; Open-Meteo/data.gov.in free.
**Alternatives:** Railway (trial credit model shifted), Fly (card), student-pack clouds (unconfirmed availability — upgrade path noted if a Student Pack appears).
**Trade-offs:** cold starts/sleeps mitigated (keep-alive, warm-ups, chain design); accepted consciously and documented in viva prep ("first paid dollar" answer).
