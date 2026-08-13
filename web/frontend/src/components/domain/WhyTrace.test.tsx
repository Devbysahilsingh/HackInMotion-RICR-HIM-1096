import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';
import * as fixtures from '@/test/fixtures';
import { WhyTrace } from './WhyTrace';

/**
 * WhyTrace (docs/testing/frontend-testing.md: "given engine trace fixture →
 * all numbers rendered, localized labels (both locales)").
 *
 * Rule R12 says no recommendation ships without its trace; this is the test
 * that the trace actually reaches the farmer rather than being carried in the
 * payload and dropped at the render.
 */
const trace = fixtures.irrigationAdvice.trace;

describe('WhyTrace', () => {
  it('is collapsed by default and expands on the "why?" control', async () => {
    renderWithProviders(<WhyTrace trace={trace} />);

    const toggle = screen.getByTestId('why-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('why-trace')).toBeNull();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('why-trace')).toBeInTheDocument();
  });

  it('renders every step and every number the engine recorded', async () => {
    renderWithProviders(<WhyTrace trace={trace} defaultOpen />);

    const panel = screen.getByTestId('why-trace');

    // One list item per step, and each step's own name.
    expect(panel.querySelectorAll('li')).toHaveLength(trace.length);
    for (const step of trace) {
      expect(screen.getByText(String(step.step))).toBeInTheDocument();
    }

    // The numbers that produced the verdict, not a summary of them.
    expect(panel.textContent).toContain('tawMm');
    expect(panel.textContent).toContain('92.4');
    expect(panel.textContent).toContain('rawMm');
    expect(panel.textContent).toContain('36.9');
    expect(panel.textContent).toContain('38.2');
  });

  it('renders a null field as an em dash rather than the word null', () => {
    renderWithProviders(
      <WhyTrace trace={[{ step: 'VERDICT', amountMm: null, days: 0 }]} defaultOpen />,
    );

    const panel = screen.getByTestId('why-trace');
    expect(panel.textContent).toContain('—');
    expect(panel.textContent).not.toContain('null');
  });

  it('summarises nested values instead of dumping JSON at the farmer', () => {
    renderWithProviders(
      <WhyTrace
        trace={[{ step: 'PROJECTION', projection: [1, 2, 3], soil: { awcMmPerM: 200 } }]}
        defaultOpen
      />,
    );

    const panel = screen.getByTestId('why-trace');
    expect(panel.textContent).toContain('[3]');
    expect(panel.textContent).toContain('{…}');
  });

  it('says so honestly when an item carries no trace', () => {
    renderWithProviders(<WhyTrace trace={[]} defaultOpen />);
    expect(screen.getByTestId('why-trace').textContent).toMatch(/No calculation details/i);
  });

  it('localizes its chrome in Hindi while leaving engine field names intact', async () => {
    renderWithProviders(<WhyTrace trace={trace} />, { language: 'hi' });

    const toggle = screen.getByTestId('why-toggle');
    expect(toggle.textContent).toMatch(/[ऀ-ॿ]/);

    await userEvent.click(toggle);
    const panel = screen.getByTestId('why-trace');

    // The heading is translated…
    expect(panel.textContent).toMatch(/[ऀ-ॿ]/);
    // …but `tawMm` is not, deliberately: a translated variable name could not
    // be checked against the engine that produced it.
    expect(panel.textContent).toContain('tawMm');
  });
});
