# ADR-007 · Open-Meteo primary weather (OWM fallback)
**Status:** Accepted · 2026-08-12
**Decision:** Open-Meteo (keyless, free, 10k/day) primary — uniquely provides daily FAO ET₀ enabling the real irrigation engine; OpenWeatherMap free-tier fallback (no ET₀ → labeled simplified mode).
**Alternatives:** OWM-primary (no ET₀ = shallow engine); paid agri-APIs (cost); IMD (no clean public API).
**Trade-offs:** non-commercial license (fits hackathon; commercial swap documented); two providers to validate (worth it for resilience requirement).
