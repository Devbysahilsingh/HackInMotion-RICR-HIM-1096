import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/test/render';
import * as fixtures from '@/test/fixtures';
import { AnalysisResult } from './AnalysisResult';

/**
 * The four documented result branches, plus the AI-safety guarantees the page
 * is responsible for upholding at the render edge.
 *
 * docs/testing/frontend-testing.md asks for "source labels per tier fixture
 * (Local AI / AI-assisted / Guided assessment); low-confidence branch shows
 * checklist CTA; severity marked 'assessed'". All three are below.
 */
describe('AnalysisResult · confident branch', () => {
  it('names the condition, its tier, and a numeric calibrated confidence', () => {
    renderWithProviders(<AnalysisResult log={fixtures.confidentLog} />);

    expect(screen.getByTestId('analysis-result')).toHaveAttribute('data-unknown', 'false');
    expect(screen.getByTestId('disease-name')).toBeInTheDocument();

    // The tier that answered, named — never a blended anonymous "AI".
    expect(screen.getByTestId('source-label').textContent).toMatch(/Local AI/i);

    // CALIBRATED is the one kind a percentage may be printed for.
    expect(screen.getByTestId('confidence-value').textContent).toBe('91%');
  });

  it('marks severity as assessed rather than measured', () => {
    renderWithProviders(<AnalysisResult log={fixtures.confidentLog} />);
    expect(screen.getByTestId('severity-badge').textContent).toMatch(/Assessed as moderate/i);
  });

  it('renders guidance from knowledge-base keys, in the documented order', () => {
    renderWithProviders(<AnalysisResult log={fixtures.confidentLog} />);

    for (const testId of ['symptoms', 'inspect', 'next-steps', 'prevention']) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }

    // Verdict before guidance: "what we saw" must precede "what to do".
    const html = document.body.innerHTML;
    expect(html.indexOf('data-testid="symptoms"')).toBeLessThan(
      html.indexOf('data-testid="next-steps"'),
    );
  });

  it('shows where the guidance came from', () => {
    renderWithProviders(<AnalysisResult log={fixtures.confidentLog} />);
    expect(screen.getByTestId('source-list').textContent).toContain('TNAU');
  });
});

describe('AnalysisResult · uncertain branch', () => {
  it('does not present an unnamed result as a diagnosis', () => {
    renderWithProviders(<AnalysisResult log={fixtures.uncertainLog} />);

    expect(screen.getByTestId('analysis-result')).toHaveAttribute('data-unknown', 'true');
    expect(screen.queryByTestId('disease-name')).toBeNull();
  });

  it('offers a retake and the guided-questions route', () => {
    renderWithProviders(<AnalysisResult log={fixtures.uncertainLog} />);

    const branch = screen.getByTestId('uncertain-branch');
    expect(branch.textContent).toMatch(/could not identify this confidently/i);
    expect(branch.querySelectorAll('a')).toHaveLength(2);
  });

  it('routes to a human when no tier could answer', () => {
    renderWithProviders(<AnalysisResult log={fixtures.uncertainLog} />);
    expect(screen.getByTestId('expert-referral').textContent).toMatch(/Kisan Call Centre/i);
  });

  it('shows the escalation path — which tier declined, and why', () => {
    renderWithProviders(<AnalysisResult log={fixtures.uncertainLog} />);
    expect(screen.getByText(/How we reached this/i)).toBeInTheDocument();
  });

  /**
   * A band is not a probability. `constants.js` is explicit that the 0.85 /
   * 0.65 / 0.4 values behind HIGH/MEDIUM/LOW "are NOT measured probabilities
   * and must never be presented as one".
   */
  it('never prints a percentage for a banded (AI-tier) confidence', () => {
    renderWithProviders(<AnalysisResult log={fixtures.unusablePhotoLog} />);

    expect(screen.getByTestId('confidence-value').textContent).not.toMatch(/%/);
    expect(screen.getByTestId('confidence-bar').textContent).toMatch(
      /confidence band, not a measured probability/i,
    );
  });
});

describe('AnalysisResult · unusable photo branch', () => {
  it('says what was wrong with the photo', () => {
    renderWithProviders(<AnalysisResult log={fixtures.unusablePhotoLog} />);
    expect(screen.getByTestId('image-assessment').textContent).toMatch(/does not appear to show a plant/i);
  });

  it('keeps AI observations under their own attributed heading, tagged English', () => {
    renderWithProviders(<AnalysisResult log={fixtures.unusablePhotoLog} />);

    const heading = screen.getByText(/What the AI reported seeing/i);
    expect(heading).toBeInTheDocument();

    // The model's free text is marked `lang="en"` so a Hindi screen reader
    // does not attempt it in Hindi — a stated limitation, handled honestly.
    const observation = screen.getByText(/plastic sheet/i);
    expect(observation.closest('[lang="en"]')).not.toBeNull();

    expect(screen.getByText(/observations, not advice/i)).toBeInTheDocument();
  });

  it('names the AI tier as AI-assisted, distinct from the local model', () => {
    renderWithProviders(<AnalysisResult log={fixtures.unusablePhotoLog} />);
    expect(screen.getByTestId('source-label').textContent).toMatch(/AI-assisted/i);
  });
});

describe('AnalysisResult · healthy branch', () => {
  it('treats a healthy verdict as a result, with prevention and no referral', () => {
    renderWithProviders(<AnalysisResult log={fixtures.healthyLog} />);

    expect(screen.getByTestId('analysis-result')).toHaveAttribute('data-unknown', 'false');
    expect(screen.getByTestId('prevention')).toBeInTheDocument();
    expect(screen.queryByTestId('next-steps')).toBeNull();
    expect(screen.queryByTestId('expert-referral')).toBeNull();
  });
});

describe('AnalysisResult · honesty labels', () => {
  it('labels a cache hit rather than passing it off as a fresh analysis', () => {
    renderWithProviders(
      <AnalysisResult
        log={{
          ...fixtures.confidentLog,
          freshness: { ...fixtures.confidentLog.freshness, status: 'cached' },
        }}
      />,
    );

    expect(screen.getByTestId('cached-notice')).toBeInTheDocument();
  });

  it('shows the coverage notice for a crop we know little about', () => {
    renderWithProviders(
      <AnalysisResult
        log={{ ...fixtures.uncertainLog, coverageNoticeKey: 'health.coverageUnsupported' }}
      />,
    );

    expect(screen.getByTestId('coverage-notice').textContent).toMatch(
      /do not have disease intelligence/i,
    );
  });

  it('renders the whole result in Hindi', () => {
    renderWithProviders(<AnalysisResult log={fixtures.confidentLog} />, { language: 'hi' });
    expect(screen.getByTestId('source-label').textContent).toMatch(/[ऀ-ॿ]/);
    expect(screen.getByTestId('severity-badge').textContent).toMatch(/[ऀ-ॿ]/);
  });

  /**
   * The disease knowledge base was English-only until 2026-08-13, and
   * `fallbackLng: 'en'` meant a Hindi screen quietly rendered English guidance
   * — present, readable to nobody who needed it, and invisible to the parity
   * gate. This asserts the actual KB text now arrives in Devanagari, which is
   * the only check that distinguishes a real translation from a fallback.
   */
  it('renders knowledge-base guidance itself in Hindi, not an English fallback', () => {
    renderWithProviders(<AnalysisResult log={fixtures.confidentLog} />, { language: 'hi' });

    for (const testId of ['symptoms', 'inspect', 'next-steps', 'prevention']) {
      const section = screen.getByTestId(testId);
      expect(section.textContent, `${testId} fell back to English`).toMatch(/[ऀ-ॿ]/);
      // And it is not the raw key either.
      expect(section.textContent).not.toMatch(/disease\./);
    }
  });
});
