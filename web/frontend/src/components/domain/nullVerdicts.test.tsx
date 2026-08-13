import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import type { IrrigationAdvice, MyCropSignal } from '@/api/types';
import { renderWithProviders } from '@/test/render';
import * as fixtures from '@/test/fixtures';
import { IrrigationVerdictCard } from './IrrigationVerdictCard';
import { MarketSignalCard } from './MarketSignalCard';

/**
 * The "no verdict" branches.
 *
 * Both engines return `null` rather than a neutral-looking placeholder when
 * they have nothing to say — a crop that is not in the ground has no watering
 * verdict, and a commodity with no recent reports has no trend. Composing an
 * i18n key from that null prints `irrigation.titlenull` at a farmer, and no
 * other test in the suite would catch it because the happy-path fixtures never
 * carry one.
 *
 * These two shapes were taken from the live API, not invented: a planned wheat
 * crop and a commodity with zero mandi rows both produce them on a clean local
 * database.
 */
const noVerdict: IrrigationAdvice = {
  verdict: null,
  hasVerdict: false,
  reasonCode: 'CROP_NOT_ACTIVE',
  mode: null,
  amountMm: null,
  amountLitersPerAcre: null,
  days: null,
  trace: [{ step: 'NO_VERDICT', reasonCode: 'CROP_NOT_ACTIVE' }],
  freshness: { status: 'live', source: 'open-meteo', fetchedAt: new Date().toISOString() },
};

const noSignal: MyCropSignal = {
  ...fixtures.myCropSignals[0]!,
  signal: {
    trend: null,
    changePct7d: null,
    changePct30d: null,
    momentumDiverges: false,
    guidanceKey: 'market.guidanceUnavailable',
    reasonCode: 'NO_OBSERVATIONS',
    trace: [{ step: 'NO_VERDICT', reasonCode: 'NO_OBSERVATIONS' }],
  },
  freshness: { status: 'historical', source: null, latestDate: null },
};

describe('IrrigationVerdictCard · no verdict', () => {
  it('never renders a key composed from a null verdict', () => {
    renderWithProviders(<IrrigationVerdictCard advice={noVerdict} />);

    const card = screen.getByTestId('irrigation-verdict');
    expect(card).toHaveAttribute('data-verdict', 'UNAVAILABLE');
    expect(card.textContent).not.toMatch(/titlenull|irrigation\./);
  });

  it('explains why there is no verdict', () => {
    renderWithProviders(<IrrigationVerdictCard advice={noVerdict} />);

    expect(screen.getByTestId('irrigation-reason').textContent).toMatch(
      /not in the ground right now/i,
    );
  });

  it('shows no amount when the engine produced none', () => {
    renderWithProviders(<IrrigationVerdictCard advice={noVerdict} />);
    expect(screen.getByTestId('irrigation-verdict').textContent).not.toMatch(/\bmm\b/);
  });
});

describe('MarketSignalCard · no signal', () => {
  it('says there is no trend rather than inventing a steady one', () => {
    renderWithProviders(<MarketSignalCard signal={noSignal} />);

    const card = screen.getByTestId('market-signal');
    expect(card.textContent).not.toMatch(/titlenull|market\./);
    expect(card.textContent).toMatch(/Not enough recent reports/i);
    // Specifically not the STABLE copy — "steady" is a claim, and there is no
    // data behind it here.
    expect(card.textContent).not.toMatch(/Prices are steady/i);
  });

  it('renders the engine own unavailable guidance', () => {
    renderWithProviders(<MarketSignalCard signal={noSignal} />);
    expect(screen.getByTestId('market-signal').textContent).toMatch(
      /not enough recent price reports/i,
    );
  });

  it('still labels freshness when the market block carries no fetch time', () => {
    renderWithProviders(<MarketSignalCard signal={noSignal} />);
    expect(screen.getByTestId('freshness-dot')).toHaveAttribute('data-status', 'historical');
  });
});
