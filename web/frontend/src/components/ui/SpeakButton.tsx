import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/i18n/LanguageContext';
import { useSpeechSynthesis } from '@/hooks/useSpeech';
import { cn } from '@/lib/cn';
import { IconSpeaker, IconX } from './icons';

/**
 * Reads a piece of the screen aloud.
 *
 * Low-literacy provision as much as an accessibility one (accessibility.md:
 * "TTS readout"). It renders nothing at all where the browser has no speech
 * synthesis — a dead button that silently does nothing would be worse than its
 * absence, and every screen is fully usable without it.
 */
export function SpeakButton({
  text,
  className,
  size = 18,
}: {
  text: string;
  className?: string;
  size?: number;
}) {
  const { t } = useTranslation('common');
  const { language } = useLanguage();
  const { isSupported, isSpeaking, speak, stop } = useSpeechSynthesis(language);

  if (!isSupported || !text.trim()) return null;

  const label = isSpeaking ? t('action.stopSpeaking') : t('action.speak');

  return (
    <button
      type="button"
      data-testid="speak-button"
      aria-label={label}
      title={label}
      onClick={() => (isSpeaking ? stop() : speak(text))}
      className={cn(
        'touch-target inline-flex items-center justify-center rounded-lg text-ink-500 hover:bg-brand-50 hover:text-brand-700',
        isSpeaking && 'text-brand-700',
        className,
      )}
    >
      {isSpeaking ? <IconX size={size} /> : <IconSpeaker size={size} />}
    </button>
  );
}
