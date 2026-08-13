/**
 * The irrigation card's contract branches.
 *
 * These are regression tests for the three shapes `computeIrrigation.js` can
 * answer in, because two of them are easy to mistake for errors and one of them
 * (`verdict: null`) will happily produce `irrigation.titlenull` and print a raw
 * identifier at a farmer if a key is composed from it carelessly.
 *
 * Voice is switched off through the auth stub: `SpeakButton` asks the TTS
 * engine whether it can speak, which is an async native round trip with nothing
 * to assert here.
 */
import { render, screen } from '@testing-library/react-native';

import type { IrrigationAdvice } from '@shared/types/api';

import { initI18n } from '../../i18n';
import { IrrigationVerdictCard } from './IrrigationVerdictCard';

jest.mock('../../store/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: jest.fn() }),
}));

jest.mock('../../store/AuthContext', () => ({
  useAuth: () => ({ user: { voiceEnabled: false }, status: 'authenticated' }),
}));

beforeAll(() => {
  initI18n('en');
});

const base: IrrigationAdvice = {
  verdict: null,
  hasVerdict: false,
  reasonCode: 'OK',
  mode: null,
  amountMm: null,
  amountLitersPerAcre: null,
  days: null,
  trace: [],
  freshness: { status: 'cached', source: 'open-meteo', fetchedAt: '2026-08-13T04:00:00.000Z' },
};

describe('IrrigationVerdictCard', () => {
  it('renders a verdict with its amount', () => {
    render(
      <IrrigationVerdictCard
        advice={{
          ...base,
          verdict: 'IRRIGATE_TODAY',
          hasVerdict: true,
          reasonCode: 'OK',
          mode: 'full',
          amountMm: 24.5,
          amountLitersPerAcre: 99_000,
          days: 0,
        }}
      />,
    );

    expect(screen.getByText('Water this crop today')).toBeTruthy();
    expect(screen.getByText('24.5 mm')).toBeTruthy();
  });

  it('explains the SIMPLIFIED_INTERVALS_NOT_SOURCED branch instead of showing a bare code', () => {
    render(
      <IrrigationVerdictCard
        advice={{
          ...base,
          verdict: 'UNAVAILABLE',
          hasVerdict: false,
          reasonCode: 'SIMPLIFIED_INTERVALS_NOT_SOURCED',
          mode: 'simplified',
        }}
      />,
    );

    expect(screen.getByText('We cannot advise on watering yet')).toBeTruthy();
    expect(screen.getByTestId('irrigation-reason')).toBeTruthy();
    // Simplified mode is an honesty label, not decoration.
    expect(screen.getByTestId('irrigation-simplified')).toBeTruthy();
  });

  it('collapses a null verdict onto the UNAVAILABLE copy rather than composing a key from null', () => {
    render(
      <IrrigationVerdictCard
        advice={{
          ...base,
          verdict: null,
          hasVerdict: false,
          reasonCode: 'BEYOND_SEASON',
          harvestApproaching: true,
        }}
      />,
    );

    expect(screen.getByText('We cannot advise on watering yet')).toBeTruthy();
    expect(screen.queryByText(/titlenull/)).toBeNull();
    expect(screen.getByText('This crop is past the end of its published calendar.')).toBeTruthy();
  });

  it('labels a wide soil-uncertainty range', () => {
    render(
      <IrrigationVerdictCard
        advice={{
          ...base,
          verdict: 'NO_IRRIGATION_NEEDED',
          hasVerdict: true,
          mode: 'full',
          soilUncertaintyWide: true,
          nextCheckDays: 3,
        }}
      />,
    );

    expect(screen.getByTestId('irrigation-soil-uncertainty')).toBeTruthy();
    expect(screen.getByText('We will check again in 3 days.')).toBeTruthy();
  });
});
