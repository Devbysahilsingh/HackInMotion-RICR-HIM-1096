import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';

import type { FertilizerGuidance } from '@/api/types';
import { renderWithProviders } from '@/test/render';
import * as fixtures from '@/test/fixtures';
import { FertilizerGuidanceView } from './FertilizerGuidanceView';

/**
 * The schedule row, against the shape `fertilizerService.js` actually returns.
 *
 * This screen was reading `labelKey` and `due` — two field names the service
 * has never emitted — so every row fell through to `String(step.stage)` and
 * printed the raw enum (`BASAL`, `TOPDRESS_1`) with no "due now" badge ever
 * appearing. The real entry carries three different kinds of text, and the
 * distinction is the whole point of these tests:
 *
 *   `fractionKey`  an i18n key → translated
 *   `timing`       the source's own words → printed verbatim, tagged English
 *   `timingUnknown` no day count could be read out of the source → said out
 *                   loud, because a blank row reads as "nothing to do".
 */
const scheduleOf = (guidance: FertilizerGuidance) => guidance.recommendations[0]!.schedule;

describe('FertilizerGuidanceView · schedule', () => {
  it('renders the fraction from its i18n key, not the raw stage code', () => {
    renderWithProviders(<FertilizerGuidanceView guidance={fixtures.fertilizerGuidance} />);

    const steps = screen.getAllByTestId('fertilizer-schedule-step');
    expect(steps).toHaveLength(scheduleOf(fixtures.fertilizerGuidance).length);

    expect(steps[0]!.textContent).toContain(
      'Full published N, P and K plus farmyard manure and micronutrients at planting',
    );
    expect(steps[1]!.textContent).toContain('A fixed quantity of nitrogen, as published');

    // The old bug's fingerprints: a raw enum, a raw key, or a missing field.
    const html = screen.getByTestId('fertilizer-recommendation').textContent ?? '';
    expect(html).not.toMatch(/\bBASAL\b|\bTOPDRESS_1\b/);
    expect(html).not.toContain('fertilizer.schedule.');
    expect(html).not.toContain('undefined');
  });

  it('prints the published timing verbatim and marks it as English', () => {
    renderWithProviders(<FertilizerGuidanceView guidance={fixtures.fertilizerGuidance} />);

    const timing = screen.getByTestId('fertilizer-timing');
    expect(timing.textContent).toBe('30 d');
    // Source text, not a translation: a Hindi screen reader must not attempt it.
    expect(timing).toHaveAttribute('lang', 'en');
  });

  it('says the source published no day count rather than leaving the row blank', () => {
    renderWithProviders(<FertilizerGuidanceView guidance={fixtures.fertilizerGuidance} />);

    const steps = screen.getAllByTestId('fertilizer-schedule-step');

    // The basal entry publishes no timing at all — `timingUnknown` is true.
    const unknown = within(steps[0]!).getByTestId('fertilizer-timing-unknown');
    expect(unknown.textContent).toMatch(/does not publish a day count/i);
    expect(within(steps[0]!).queryByTestId('fertilizer-timing')).toBeNull();

    // The entry that does parse says nothing of the sort.
    expect(within(steps[1]!).queryByTestId('fertilizer-timing-unknown')).toBeNull();
  });

  it('badges only the entry the engine marked current', () => {
    renderWithProviders(<FertilizerGuidanceView guidance={fixtures.fertilizerGuidance} />);

    const steps = screen.getAllByTestId('fertilizer-schedule-step');
    expect(steps[0]!.textContent).not.toMatch(/Due around now/i);
    expect(steps[1]!.textContent).toMatch(/Due around now/i);
  });

  it('shows no badge at all when nothing is current', () => {
    const guidance: FertilizerGuidance = {
      ...fixtures.fertilizerGuidance,
      daysSinceSowing: 5,
      recommendations: [
        {
          ...fixtures.fertilizerGuidance.recommendations[0]!,
          schedule: scheduleOf(fixtures.fertilizerGuidance).map((step) => ({
            ...step,
            isCurrent: false,
          })),
        },
      ],
    };

    renderWithProviders(<FertilizerGuidanceView guidance={guidance} />);
    expect(screen.getByTestId('fertilizer-recommendation').textContent).not.toMatch(
      /Due around now/i,
    );
  });

  it('renders the schedule in Hindi, timing prose excepted', () => {
    renderWithProviders(<FertilizerGuidanceView guidance={fixtures.fertilizerGuidance} />, {
      language: 'hi',
    });

    const steps = screen.getAllByTestId('fertilizer-schedule-step');
    expect(steps[0]!.textContent).toMatch(/[ऀ-ॿ]/);
    expect(screen.getByTestId('fertilizer-timing-unknown').textContent).toMatch(/[ऀ-ॿ]/);
    // The published string itself stays as published.
    expect(screen.getByTestId('fertilizer-timing').textContent).toBe('30 d');
  });
});
