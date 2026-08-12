# Voice Interface (FR-V1 · P2)

Goal: real accessibility for low-literacy users, Hindi + English — not a fake button. Research basis: subagent report 2026-08-12 (sources at bottom).

## Product definition
- **Voice OUT (TTS "सुनाओ / Read aloud")** on every recommendation card — the highest-value, lowest-risk piece; P2 first.
- **Voice IN (STT)** for 6 fixed intents: (1) weather tomorrow? (2) should I irrigate? (3) market price? (4) check my crop → opens camera, (5) read my tasks, (6) open farm. Recognized text shown editable before executing.
- No-match behavior: show the 6 intents as large tappable buttons (good for low-literacy regardless — the intent layer is input-agnostic: voice, tap, or typed text).

## Technical approach (all $0, no card)
| Piece | Web | Mobile (Expo Android) |
|---|---|---|
| STT | Web Speech API `SpeechRecognition`, `lang: hi-IN`/`en-IN` (Chrome/Edge/Android Chrome; server-based, online-only; Firefox/iOS → button hidden, tappable intents shown) | Primary plan: `expo-speech-recognition` (Android's Google recognizer, free, hi-IN) — **requires dev build, not Expo Go** → build dev client Day 1 or fall back to record (`expo-audio`) → `POST /api/v1/voice/transcribe` → **Groq Whisper free tier** (~2k req/~8h audio per day, no card) |
| TTS | `speechSynthesis` with hi-IN voice (handle `onvoiceschanged`, `hi_IN` underscore quirk on Android) | `expo-speech` `language:'hi-IN'` — **works in Expo Go** (device Google TTS; verify Hindi pack on demo phone) |
| Intent | Shared keyword matcher (`shared/constants/voice-intents`): keyword sets per intent in English, Devanagari (मौसम, सिंचाई/पानी, भाव/मंडी, फसल/कैमरा, सुनाओ/पढ़ो, खेत), and romanized Hinglish (mausam, paani, bhav…); normalize → score by hits → tie/no-match → intent menu. Deterministic > LLM for a demo (never rate-limited). Optional P3: Gemini classify on no-match. | same module |

Groq key stays server-side (`/voice/transcribe` proxy, auth-required, rate-limited 20/day/user).

## Data requirements
None stored: transcripts are processed in-memory for intent matching and discarded (privacy §docs/security). No `voiceInteractions` collection — decision recorded (minimal collection principle).

## Architecture placement
Client: `useVoice()` hook (web) / voice service (mobile) → intent id → existing app navigation/API calls. Backend: single optional `/voice/transcribe` proxy. No other server surface.

## MVP vs future
- **MVP (P2):** TTS readout both surfaces + web STT with 6 intents + intent-button fallback everywhere.
- **Stretch (P2+):** mobile STT via dev build if Day-1 build succeeds; else Groq path; else tappable intents only (still a genuine accessibility feature).
- **Future (P3):** free-form NLU, Marathi/Telugu, offline on-device models (Android 13+ pre-downloaded hi-IN).

## Risks & tests
R1 Dev-build discovery on demo day → mitigated: decision point end of Day 1. R2 Demo device missing Hindi TTS voice/recognizer app → test on exact demo phone Day 2; pre-install packs. R3 Venue network (web STT is server-based) → demo voice on mobile TTS + web STT only if network verified; rehearse both. Tests: docs/testing/ voice matrix (permission denied, no-match, Hindi/English toggle, TTS interruption).

## Sources
jamsch/expo-speech-recognition (GitHub) · Expo Speech SDK docs · MDN SpeechRecognition + caniuse · addpipe Web Speech deep dive · talkrapp/testmuai speechSynthesis quirks · grizzlypeaksoftware + apio.sh (Groq free tier) · aipromptshub/aifreeapi (Gemini free tier).
