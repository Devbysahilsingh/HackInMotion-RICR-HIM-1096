import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';
import { CropForm } from './CropForm';

/**
 * Crop-form validation.
 *
 * The interesting rule is the registry escape hatch: an unknown crop code is
 * accepted **only** with the farmer's own label for it (`resolveCropCode`
 * throws `unknown_requires_label` otherwise), and the platform is honest up
 * front that such a crop gets less advice.
 */

/**
 * The crop select is disabled until the registry query resolves, so every test
 * that picks an option has to wait for the options to exist — otherwise it is
 * asserting against a disabled control and the selection silently does nothing.
 */
async function readyCropSelect(): Promise<HTMLElement> {
  const select = await screen.findByTestId('crop-code');
  await waitFor(() => expect(select).not.toBeDisabled());
  await waitFor(() => expect(select.querySelectorAll('optgroup').length).toBeGreaterThan(0));
  return select;
}

describe('CropForm', () => {
  it('offers the registry crops grouped by how much we actually know', async () => {
    renderWithProviders(<CropForm isSubmitting={false} onSubmit={() => {}} />);

    const select = await screen.findByTestId('crop-code');
    await waitFor(() => expect(select.querySelectorAll('optgroup').length).toBeGreaterThan(0));

    // Best-supported first — a farmer choosing between two crops should see
    // that one of them will produce real advice.
    const groups = [...select.querySelectorAll('optgroup')].map((group) => group.label);
    expect(groups[0]).toMatch(/full support/i);
  });

  it('blocks submission until a crop is chosen', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<CropForm isSubmitting={false} onSubmit={onSubmit} />);

    await userEvent.click(screen.getByTestId('crop-submit'));

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('requires a label for a crop outside the registry, and says why', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<CropForm isSubmitting={false} onSubmit={onSubmit} />);

    const select = await readyCropSelect();
    await userEvent.selectOptions(select, 'OTHER');

    // The limitation is stated before the crop is created, not discovered after.
    expect(await screen.findByText(/advice will be limited/i)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('crop-submit'));
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());

    await userEvent.type(screen.getByTestId('crop-free-text'), 'Ragi');
    await userEvent.click(screen.getByTestId('crop-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ cropCode: 'OTHER', freeTextLabel: 'Ragi' });
  });

  it('sends an ISO sowing date and omits an empty area', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<CropForm isSubmitting={false} onSubmit={onSubmit} />);

    await userEvent.selectOptions(await readyCropSelect(), 'TOMATO');
    await userEvent.click(screen.getByTestId('crop-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

    const payload = onSubmit.mock.calls[0]![0];
    expect(payload.cropCode).toBe('TOMATO');
    expect(payload.sowingDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // An unfilled area is absent, not zero — the API treats them differently.
    expect(payload).not.toHaveProperty('areaValue');
    expect(payload).not.toHaveProperty('freeTextLabel');
  });

  it('bounds the sowing date to the range the API accepts', async () => {
    renderWithProviders(<CropForm isSubmitting={false} onSubmit={() => {}} />);

    const input = screen.getByTestId('crop-sowing-date');
    // 400 days back / 180 forward, from `SOWING_DATE_MAX_*` in the backend.
    expect(input).toHaveAttribute('min');
    expect(input).toHaveAttribute('max');

    const min = new Date(input.getAttribute('min')!);
    const max = new Date(input.getAttribute('max')!);
    const spanDays = Math.round((max.getTime() - min.getTime()) / 86_400_000);
    expect(spanDays).toBe(580);
  });

  it('refuses a crop larger than the remaining farm area, and names what is left', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <CropForm isSubmitting={false} onSubmit={onSubmit} availableAcres={20} />,
    );

    // The remaining ground is stated up front, not discovered on rejection.
    expect(screen.getByText(/20 .*available for crops/i)).toBeInTheDocument();

    await userEvent.selectOptions(await readyCropSelect(), 'TOMATO');
    await userEvent.type(screen.getByTestId('crop-area'), '25');
    await userEvent.click(screen.getByTestId('crop-submit'));

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
    expect(
      await screen.findByText(/cannot be greater than your farm's remaining area/i),
    ).toBeInTheDocument();
  });

  it('accepts a crop that fits, converting units into one ledger', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <CropForm isSubmitting={false} onSubmit={onSubmit} availableAcres={20} />,
    );

    await userEvent.selectOptions(await readyCropSelect(), 'TOMATO');
    // 8 hectare ≈ 19.77 acres — inside the 20 remaining.
    await userEvent.type(screen.getByTestId('crop-area'), '8');
    await userEvent.selectOptions(screen.getByLabelText(/unit/i), 'hectare');
    await userEvent.click(screen.getByTestId('crop-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ areaValue: 8, areaUnit: 'hectare' });
  });

  it('renders in Hindi', async () => {
    renderWithProviders(<CropForm isSubmitting={false} onSubmit={() => {}} />, { language: 'hi' });

    expect(screen.getByTestId('crop-submit').textContent).toMatch(/[ऀ-ॿ]/);
    const select = await screen.findByTestId('crop-code');
    await waitFor(() => expect(select.querySelectorAll('optgroup').length).toBeGreaterThan(0));
    expect(select.querySelector('optgroup')?.label).toMatch(/[ऀ-ॿ]/);
  });
});
