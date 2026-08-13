import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';

import { renderWithProviders } from '@/test/render';
import { FreshnessDot } from './FreshnessDot';
import { PriorityChip } from './PriorityChip';

/**
 * The accessibility regression guard named in docs/testing/frontend-testing.md:
 * "FreshnessDot + PriorityChip: icon+text presence (never color-only)".
 *
 * These two components are the only place ranked meaning is encoded visually,
 * so a change that reduced either to a coloured dot would be a real regression
 * for a colour-blind farmer and for a screen-reader user — and would pass every
 * other test in the suite.
 */
describe('PriorityChip', () => {
  const priorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'INFO'] as const;

  it.each(priorities)('renders %s with an icon AND a text label', (priority) => {
    renderWithProviders(<PriorityChip priority={priority} />);

    const chip = screen.getByTestId('priority-chip');
    expect(chip).toHaveAttribute('data-priority', priority);

    // The icon: present, and hidden from assistive tech because the text beside
    // it already carries the meaning.
    const icon = chip.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');

    // The text: non-empty, and not the raw enum value.
    expect(chip.textContent?.trim()).toBeTruthy();
    expect(chip.textContent?.trim()).not.toBe(priority);
  });

  it('gives each priority a distinct label, so colour is never the only difference', () => {
    const labels = priorities.map((priority) => {
      const { unmount } = renderWithProviders(<PriorityChip priority={priority} />);
      const text = screen.getByTestId('priority-chip').textContent?.trim() ?? '';
      unmount();
      return text;
    });

    expect(new Set(labels).size).toBe(priorities.length);
  });

  it('renders Devanagari labels under the Hindi locale', () => {
    renderWithProviders(<PriorityChip priority="CRITICAL" />, { language: 'hi' });
    expect(screen.getByTestId('priority-chip').textContent).toMatch(/[ऀ-ॿ]/);
  });
});

describe('FreshnessDot', () => {
  const statuses = ['live', 'cached', 'historical', 'pending'] as const;

  it.each(statuses)('labels the %s state in words, not just colour', (status) => {
    renderWithProviders(
      <FreshnessDot freshness={{ status, source: 'open-meteo', fetchedAt: null }} />,
    );

    const dot = screen.getByTestId('freshness-dot');
    expect(dot).toHaveAttribute('data-status', status);
    expect(dot.textContent?.trim()).toBeTruthy();
    // The bullet glyph itself is decorative.
    expect(within(dot).getByText('●')).toHaveAttribute('aria-hidden', 'true');
    // A hover explanation is always available.
    expect(dot.getAttribute('title')?.length ?? 0).toBeGreaterThan(0);
  });

  it('keeps the label available to screen readers in compact mode', () => {
    renderWithProviders(
      <FreshnessDot compact freshness={{ status: 'cached', source: 'owm', fetchedAt: null }} />,
    );

    const dot = screen.getByTestId('freshness-dot');
    const srOnly = dot.querySelector('.sr-only');
    expect(srOnly?.textContent?.trim()).toBeTruthy();
  });

  it('adds an explicit warning once a cached value passes 48 hours', () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 3_600_000).toISOString();
    renderWithProviders(
      <FreshnessDot freshness={{ status: 'cached', source: 'owm', fetchedAt: threeDaysAgo }} />,
    );

    expect(screen.getByTestId('freshness-stale-warning')).toBeInTheDocument();
  });

  it('renders nothing when the API sent no freshness block', () => {
    renderWithProviders(<FreshnessDot freshness={null} />);
    expect(screen.queryByTestId('freshness-dot')).toBeNull();
  });
});
