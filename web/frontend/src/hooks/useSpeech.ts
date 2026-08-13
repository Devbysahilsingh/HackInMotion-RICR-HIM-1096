/**
 * Browser-native speech (ADR-017 — device-native, no paid cloud service).
 *
 * Both halves are progressive enhancement. Support is *detected*, never
 * assumed: Web Speech recognition ships in Chromium and Safari but not
 * Firefox, and `speechSynthesis` may have no Hindi voice installed even where
 * the API exists. Everything the voice layer can do is also reachable by tap,
 * so a browser without either API loses nothing but convenience — which is the
 * rule voice has to obey ("never allow voice failure to block normal usage").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Language } from '@/api/types';

// ── Types ───────────────────────────────────────────────────────────────────
// The Web Speech recognition API is not in TypeScript's DOM lib (it is not on
// the standards track), so the shape we actually touch is declared here rather
// than reached for through `any`.

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechCapableWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

const BCP47: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN' };

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = window as SpeechCapableWindow;
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

// ── Text to speech ──────────────────────────────────────────────────────────

export interface SpeechSynthesisState {
  isSupported: boolean;
  isSpeaking: boolean;
  speak: (text: string) => void;
  stop: () => void;
}

export function useSpeechSynthesis(language: Language): SpeechSynthesisState {
  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [isSpeaking, setIsSpeaking] = useState(false);

  const stop = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [isSupported]);

  // A queued utterance outlives the component that started it, so an unmount
  // has to cancel or the page will keep talking after the farmer navigates.
  useEffect(() => stop, [stop]);

  const speak = useCallback(
    (text: string) => {
      if (!isSupported || !text.trim()) return;

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = BCP47[language];

      // Prefer a voice that actually matches the locale. If none is installed
      // the platform picks its default, which will read Devanagari badly — but
      // silence would be worse, and the button is optional either way.
      const voice = window.speechSynthesis
        .getVoices()
        .find((candidate) => candidate.lang?.toLowerCase().startsWith(language));
      if (voice) utterance.voice = voice;

      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [isSupported, language],
  );

  return useMemo(
    () => ({ isSupported, isSpeaking, speak, stop }),
    [isSupported, isSpeaking, speak, stop],
  );
}

// ── Speech to text ──────────────────────────────────────────────────────────

export type RecognitionError = 'not-supported' | 'permission-denied' | 'failed' | null;

export interface SpeechRecognitionState {
  isSupported: boolean;
  isListening: boolean;
  transcript: string;
  error: RecognitionError;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

export function useSpeechRecognition(language: Language): SpeechRecognitionState {
  const Constructor = useMemo(recognitionConstructor, []);
  const isSupported = Constructor !== null;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<RecognitionError>(isSupported ? null : 'not-supported');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
    },
    [],
  );

  const start = useCallback(() => {
    if (!Constructor) {
      setError('not-supported');
      return;
    }

    recognitionRef.current?.abort();

    const recognition = new Constructor();
    recognition.lang = BCP47[language];
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let text = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        text += event.results[index]?.[0]?.transcript ?? '';
      }
      setTranscript(text.trim());
    };

    recognition.onerror = (event) => {
      setError(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'permission-denied'
          : 'failed',
      );
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    setTranscript('');
    setError(null);
    setIsListening(true);

    try {
      recognition.start();
    } catch {
      // `start()` throws if called while already running. Nothing to recover.
      setIsListening(false);
      setError('failed');
    }
  }, [Constructor, language]);

  const reset = useCallback(() => {
    setTranscript('');
    setError(isSupported ? null : 'not-supported');
  }, [isSupported]);

  return { isSupported, isListening, transcript, error, start, stop, reset };
}
