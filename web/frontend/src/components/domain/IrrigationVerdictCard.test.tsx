import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { IrrigationAdvice } from '@/api/types';
import { renderWithProviders } from '@/test/render';
import * as fixtures from '@/test/fixtures';
import { IrrigationVerdictCard } from './IrrigationVerdictCard';

/**
 * The soil honesty label.
 *
 * `computeIrrigation.js` returns no top-level `soil` object — the soil inputs
 * exist only inside the `SOIL` trace step. The card used to test
 * `advice.soil?.soilType === 'unknown'`, which is `undefined` against every
 * real response, so the "this estimate is less precise" caveat never rendered
 * for the farmer it was written for. The engine's own flag is
 * `soilUncertaintyWide`, and it is set by exactly one AWC entry: the
 * unspecified-soil placeholder (shared/constants/agronomy.js).
 */
const withWideSoil = (advice: IrrigationAdvice): IrrigationAdvice => ({
  ...advice,
  soilUncertaintyWide: true,
  trace: advice.trace.map((step) =>
    step.step === 'SOIL'
      ? {
          ...step,
          soilType: 'unknown',
          awcMmPerM: 120,
          published: '120',
          basis: 'documented placeholder for unspecified soil',
          wideUncertainty: true,
        }
      : step,
  ),
});

describe('IrrigationVerdictCard · soil uncertainty', () => {
  it('warns that the estimate is less precise when the soil is unspecified', () => {
    renderWithProviders(<IrrigationVerdictCard advice={withWideSoil(fixtures.irrigationAdvice)} />);

    expect(screen.getByTestId('irrigation-soil-uncertain').textContent).toMatch(
      /Soil type is not recorded/i,
    );
  });

  it('stays quiet when the farmer told us the soil', () => {
    renderWithProviders(<IrrigationVerdictCard advice={fixtures.irrigationAdvice} />);
    expect(screen.queryByTestId('irrigation-soil-uncertain')).toBeNull();
  });

  /**
   * The card states no soil figure of its own, because the response carries
   * none at the top level. The figures the engine did use are still reachable —
   * in the trace, where they can be checked against the engine that produced
   * them (R12).
   */
  it('surfaces the soil inputs through the trace rather than claiming them on the card', async () => {
    renderWithProviders(<IrrigationVerdictCard advice={fixtures.irrigationAdvice} />);

    const card = screen.getByTestId('irrigation-verdict');
    expect(card.textContent).not.toContain('awcMmPerM');

    await userEvent.click(screen.getByTestId('why-toggle'));

    const trace = screen.getByTestId('why-trace');
    expect(trace.textContent).toContain('SOIL');
    expect(trace.textContent).toContain('awcMmPerM');
    expect(trace.textContent).toContain('200');
    expect(trace.textContent).not.toContain('undefined');
  });
});
