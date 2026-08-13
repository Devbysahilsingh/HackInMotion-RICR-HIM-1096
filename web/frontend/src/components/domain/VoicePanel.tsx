import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useLanguage } from '@/i18n/LanguageContext';
import { useSpeechRecognition } from '@/hooks/useSpeech';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Notice } from '@/components/ui/states';
import { IconChart, IconCamera, IconCloud, IconDroplet, IconHome, IconMic } from '@/components/ui/icons';

/**
 * Ask-by-voice (P2, ADR-017 — device-native, no cloud transcription).
 *
 * Two things make this safe to ship:
 *
 * 1. **The buttons are the primary interface.** Every intent below is a plain
 *    tap target that works in every browser. Speech is a shortcut to the same
 *    five destinations, never the only route to any of them — so a browser
 *    with no recognition API (Firefox) loses a convenience, not a feature.
 * 2. **Matching is keyword-based and local.** No transcript leaves the device;
 *    an unrecognised phrase says so and shows the buttons rather than guessing
 *    at a navigation the farmer did not ask for.
 */
interface Intent {
  path: string;
  labelKey: string;
  keywords: string[];
  Icon: typeof IconHome;
}

/**
 * Keyword sets, English and Hindi. Deliberately small and literal: a fuzzy
 * matcher would take a farmer somewhere they did not ask to go, and being
 * wrong here is worse than saying "I did not catch that".
 */
const INTENTS: Intent[] = [
  {
    path: '/dashboard',
    labelKey: 'voice:intentDashboard',
    keywords: ['home', 'dashboard', 'मुख्य', 'होम'],
    Icon: IconHome,
  },
  {
    path: '/dashboard',
    labelKey: 'voice:intentIrrigation',
    keywords: ['water', 'irrigate', 'irrigation', 'सिंचाई', 'पानी'],
    Icon: IconDroplet,
  },
  {
    // The dedicated weather entry — it forwards a single-farm account
    // straight to that farm's forecast.
    path: '/weather',
    labelKey: 'voice:intentWeather',
    keywords: ['weather', 'rain', 'मौसम', 'बारिश'],
    Icon: IconCloud,
  },
  {
    path: '/market',
    labelKey: 'voice:intentMarket',
    keywords: ['market', 'price', 'mandi', 'मंडी', 'भाव', 'दाम'],
    Icon: IconChart,
  },
  {
    path: '/scan',
    labelKey: 'voice:intentScan',
    keywords: ['scan', 'photo', 'disease', 'फोटो', 'रोग', 'बीमारी'],
    Icon: IconCamera,
  },
];

export function VoicePanel() {
  const { t } = useTranslation(['voice', 'common']);
  const { language } = useLanguage();
  const navigate = useNavigate();
  const recognition = useSpeechRecognition(language);

  const matched = matchIntent(recognition.transcript);

  // Navigate only once the recogniser has finished — acting on an interim
  // result would jump pages mid-sentence.
  useEffect(() => {
    if (recognition.isListening || !recognition.transcript || !matched) return;
    navigate(matched.path);
    recognition.reset();
  }, [recognition, matched, navigate]);

  return (
    <Card>
      <div className="space-y-4 p-4">
        {recognition.isSupported ? (
          <div className="space-y-2">
            <Button
              onClick={recognition.isListening ? recognition.stop : recognition.start}
              leadingIcon={<IconMic size={18} />}
              variant={recognition.isListening ? 'secondary' : 'primary'}
              data-testid="voice-mic"
            >
              {recognition.isListening ? t('voice:micStop') : t('voice:micStart')}
            </Button>

            <p aria-live="polite" className="min-h-5 text-sm text-ink-500">
              {recognition.isListening
                ? t('voice:listening')
                : recognition.transcript
                  ? t('voice:heard', { text: recognition.transcript })
                  : ''}
            </p>

            {recognition.error === 'permission-denied' && (
              <Notice tone="warning">{t('voice:permissionDenied')}</Notice>
            )}
            {recognition.transcript && !recognition.isListening && !matched && (
              <Notice tone="info">{t('voice:noMatch')}</Notice>
            )}
          </div>
        ) : (
          <Notice tone="info" data-testid="voice-unsupported">
            {t('voice:notSupported')}
          </Notice>
        )}

        <div>
          <p className="mb-2 text-sm font-medium text-ink-700">{t('voice:intentsHeading')}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {INTENTS.map((intent) => (
              <li key={intent.labelKey}>
                <Button
                  variant="secondary"
                  fullWidth
                  className="justify-start"
                  leadingIcon={<intent.Icon size={18} />}
                  onClick={() => navigate(intent.path)}
                >
                  {t(intent.labelKey)}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function matchIntent(transcript: string): Intent | null {
  if (!transcript) return null;
  const lowered = transcript.toLowerCase();
  return INTENTS.find((intent) => intent.keywords.some((word) => lowered.includes(word))) ?? null;
}
