import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';
import * as fixtures from '@/test/fixtures';
import SymptomCheckPage from './SymptomCheckPage';

/**
 * The guided (no-photo) route's result list.
 *
 * `symptomEngine.js#toCandidate` returns `matchScore`; the page was reading
 * `candidate.score`, so `score * 100` was `NaN` and every candidate showed
 * "NaN%" beside its band. The engine also returns no disease *name* — the code
 * is resolved through the registry, the same way `AnalysisResult` does it.
 */
async function submitSymptomCheck() {
  renderWithProviders(<SymptomCheckPage />);

  const cropSelect = await screen.findByTestId('symptom-crop');
  await userEvent.selectOptions(cropSelect, fixtures.dashboard.cropCards[0]!.cropId);
  await userEvent.selectOptions(screen.getByTestId('symptom-pattern'), 'SPOTS');
  await userEvent.click(screen.getByTestId('symptom-submit'));

  return screen.findByTestId('symptom-result');
}

describe('SymptomCheckPage · candidates', () => {
  it('prints the engine match score as a percentage, not NaN', async () => {
    await submitSymptomCheck();

    const cards = screen.getAllByTestId('symptom-candidate');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('72%');
    expect(cards[1]!.textContent).toContain('48%');
    expect(cards[0]!.textContent).not.toContain('NaN');
  });

  it('bands every candidate Possible or Likely — never "diagnosed"', async () => {
    const result = await submitSymptomCheck();

    const cards = screen.getAllByTestId('symptom-candidate');
    expect(cards[0]!.textContent).toMatch(/Likely/i);
    expect(cards[1]!.textContent).toMatch(/Possible/i);
    expect(result.textContent).not.toMatch(/diagnos/i);
  });

  it('names the condition from its code rather than a name the engine never sent', async () => {
    await submitSymptomCheck();

    const cards = screen.getAllByTestId('symptom-candidate');
    // The stub registry carries no `diseases`, so the code itself is the
    // honest fallback — what must never appear is an empty or undefined name.
    expect(cards[0]!.textContent).toContain('TOMATO_EARLY_BLIGHT');
    expect(cards[0]!.textContent).not.toContain('undefined');
  });
});
