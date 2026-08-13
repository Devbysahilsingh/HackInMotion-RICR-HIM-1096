/**
 * Voice OUT — text to speech.
 *
 * ## The STT decision, recorded
 *
 * docs/voice/voice-interface.md offers three paths for voice *in* on Android:
 * a dev build carrying `expo-speech-recognition`, a `POST /voice/transcribe`
 * proxy in front of Groq Whisper, or intents-only. **This app ships
 * intents-only, and no microphone permission is requested** — `RECORD_AUDIO`
 * is explicitly blocked in app.config.ts.
 *
 * Why: the dev-build path forfeits the Expo Go demo route that
 * docs/mobile/deployment.md names as primary, and the Groq path needs a
 * `/voice/transcribe` endpoint that does not exist in `backend/src/routes/`
 * — building it is a server feature, not a mobile one, and no TODO has
 * approved it. The intent layer the voice doc describes is input-agnostic by
 * design ("voice, tap, or typed text"), so the six intents remain reachable as
 * large tappable targets, which is a genuine accessibility feature for a
 * low-literacy user rather than a consolation prize.
 *
 * Voice OUT is the piece the doc calls "the highest-value, lowest-risk", and
 * it works in Expo Go on the device's own engine — including offline.
 */
import * as Speech from 'expo-speech';

import type { Language } from '@shared/types/api';

/**
 * BCP-47 tags Android's TTS engine recognises. `hi-IN` is the one that
 * matters: the Hindi voice pack is a separate download on many handsets, which
 * is why `isLanguageAvailable` exists rather than assuming success.
 */
const SPEECH_LOCALE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN' };

export interface SpeakOptions {
  language: Language;
  onStart?: () => void;
  onDone?: () => void;
  onError?: () => void;
}

/**
 * Speaks a passage, replacing anything already being spoken.
 *
 * Stopping first is deliberate: tapping "read aloud" on a second card while
 * the first is still talking should switch to the new card, not queue behind
 * it. A farmer who taps again has changed their mind.
 */
export function speak(text: string, options: SpeakOptions): void {
  Speech.stop();

  Speech.speak(text, {
    language: SPEECH_LOCALE[options.language],
    // Slightly under natural pace: this is agronomic guidance, often numeric,
    // frequently heard once in a noisy field.
    rate: 0.92,
    pitch: 1.0,
    onStart: options.onStart,
    onDone: options.onDone,
    onStopped: options.onDone,
    onError: options.onError,
  });
}

export function stopSpeaking(): void {
  Speech.stop();
}

export const isSpeaking = (): Promise<boolean> => Speech.isSpeakingAsync();

/**
 * Whether the device can actually speak this language.
 *
 * Android reports installed voices; a handset with no Hindi pack returns none,
 * and the UI must hide or disable the speak button rather than offering a
 * control that silently does nothing (docs/voice R2).
 */
export async function isLanguageAvailable(language: Language): Promise<boolean> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    if (voices.length === 0) {
      // Some OEM engines report an empty list while still speaking correctly.
      // Treating that as "unavailable" would remove a working feature, so the
      // benefit of the doubt goes to the device.
      return true;
    }
    const wanted = SPEECH_LOCALE[language].toLowerCase();
    const prefix = wanted.split('-')[0] ?? wanted;
    return voices.some((voice) => {
      const tag = voice.language.toLowerCase().replace('_', '-');
      return tag === wanted || tag.startsWith(`${prefix}-`) || tag === prefix;
    });
  } catch {
    return false;
  }
}
