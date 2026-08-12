# ADR-017 · Voice: device-native speech stack + keyword intents
**Status:** Accepted · 2026-08-12
**Decision:** Web Speech API STT (hi-IN) + speechSynthesis TTS on web; expo-speech TTS on mobile (Expo Go-safe); mobile STT via dev-build native recognizer OR Groq Whisper proxy (Day-1 decision point); intents = deterministic trilingual keyword matcher over 6 fixed intents with tappable-buttons fallback.
**Alternatives:** cloud STT everywhere (needless keys/quota), LLM intent parsing (rate/latency risk for a demo; P3 no-match assist only), skipping voice (fails challenge coverage).
**Trade-offs:** browser/device support variance — degradation designed (buttons serve low-literacy users regardless).
