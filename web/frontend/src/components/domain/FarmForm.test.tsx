import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';
import { FarmForm } from './FarmForm';

/**
 * Farm-form validation (docs/testing/frontend-testing.md: "FarmForm validation
 * messages localized; soil-unknown path shows nudge") plus the GPS permission
 * matrix, which is the part most likely to strand a farmer.
 */
type GeolocationSuccess = (position: { coords: { latitude: number; longitude: number } }) => void;
type GeolocationFailure = (error: {
  code: number;
  PERMISSION_DENIED: number;
  TIMEOUT: number;
}) => void;

function stubGeolocation(
  implementation: (success: GeolocationSuccess, failure: GeolocationFailure) => void,
) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: implementation },
  });
}

const noop = () => {};

describe('FarmForm · validation', () => {
  it('blocks submission and names every required field', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<FarmForm submitLabel="Save" isSubmitting={false} onSubmit={onSubmit} />);

    // Location is what the form genuinely requires. The name is not — see the
    // naming test below.
    await userEvent.clear(screen.getByTestId('farm-state'));
    await userEvent.clear(screen.getByTestId('farm-district'));
    await userEvent.click(screen.getByTestId('farm-submit'));

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    for (const alert of alerts) expect(alert.textContent?.trim()).toBeTruthy();
  });

  it('wires each error to its own control for assistive technology', async () => {
    renderWithProviders(<FarmForm submitLabel="Save" isSubmitting={false} onSubmit={noop} />);

    await userEvent.clear(screen.getByTestId('farm-district'));
    await userEvent.click(screen.getByTestId('farm-submit'));

    const districtInput = await screen.findByTestId('farm-district');
    await waitFor(() => expect(districtInput).toHaveAttribute('aria-invalid', 'true'));

    const describedBy = districtInput.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!.split(' ').pop()!)?.textContent).toBeTruthy();
  });

  /**
   * A farmer who does not know what to call their field must not be stopped by
   * a naming decision. "North Field" is a developer's mental model; a farmer
   * thinks "मेरा खेत", or names it after where it is.
   */
  it('does not block creation on a name, and defaults it from the place', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<FarmForm submitLabel="Save" isSubmitting={false} onSubmit={onSubmit} />);

    await userEvent.clear(screen.getByTestId('farm-name'));
    await userEvent.clear(screen.getByTestId('farm-state'));
    await userEvent.type(screen.getByTestId('farm-state'), 'Madhya Pradesh');
    await userEvent.clear(screen.getByTestId('farm-district'));
    await userEvent.type(screen.getByTestId('farm-district'), 'Bhopal');
    await userEvent.type(screen.getByTestId('farm-village'), 'Kolar');
    await userEvent.click(screen.getByTestId('farm-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0]![0];
    expect(submitted.name).toBe('Kolar');
    expect(submitted.location.village).toBe('Kolar');
    expect(submitted.location.district).toBe('Bhopal');
  });

  it('sends no coordinates when the farmer never opened the advanced section', async () => {
    // The whole point of the location-first form: a farmer types a place, and
    // the server resolves the coordinates they should never have to know.
    const onSubmit = vi.fn();
    renderWithProviders(<FarmForm submitLabel="Save" isSubmitting={false} onSubmit={onSubmit} />);

    await userEvent.clear(screen.getByTestId('farm-state'));
    await userEvent.type(screen.getByTestId('farm-state'), 'Maharashtra');
    await userEvent.clear(screen.getByTestId('farm-district'));
    await userEvent.type(screen.getByTestId('farm-district'), 'Nashik');
    await userEvent.click(screen.getByTestId('farm-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0]![0];
    expect(submitted.location.lat).toBeUndefined();
    expect(submitted.location.lon).toBeUndefined();
    expect(submitted.location.source).toBe('manual');
  });

  it('rejects a coordinate outside India with a specific message', async () => {
    renderWithProviders(<FarmForm submitLabel="Save" isSubmitting={false} onSubmit={noop} />);

    await userEvent.type(screen.getByTestId('farm-name'), 'Test field');
    await userEvent.type(screen.getByTestId('farm-state'), 'Maharashtra');
    await userEvent.type(screen.getByTestId('farm-district'), 'Nashik');
    await userEvent.type(screen.getByTestId('farm-lat'), '48.85');
    await userEvent.type(screen.getByTestId('farm-lon'), '2.35');
    await userEvent.click(screen.getByTestId('farm-submit'));

    // Both coordinate fields are flagged — a lone valid half is not a location.
    expect(await screen.findAllByText(/outside India/i)).toHaveLength(2);
  });

  it('rejects half a coordinate — it is not a location', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<FarmForm submitLabel="Save" isSubmitting={false} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByTestId('farm-name'), 'Test field');
    await userEvent.type(screen.getByTestId('farm-state'), 'Maharashtra');
    await userEvent.type(screen.getByTestId('farm-district'), 'Nashik');
    await userEvent.type(screen.getByTestId('farm-lat'), '19.99');
    await userEvent.click(screen.getByTestId('farm-submit'));

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it('submits a valid manual-district farm and marks the location as manual', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<FarmForm submitLabel="Save" isSubmitting={false} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByTestId('farm-name'), 'North field');
    await userEvent.type(screen.getByTestId('farm-state'), 'Maharashtra');
    await userEvent.type(screen.getByTestId('farm-district'), 'Nashik');
    await userEvent.click(screen.getByTestId('farm-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const payload = onSubmit.mock.calls[0]![0];
    expect(payload.location.source).toBe('manual');
    expect(payload.location.lat).toBeUndefined();
    expect(payload.name).toBe('North field');
  });

  it('shows the soil-test nudge on the "I don\'t know" path', async () => {
    renderWithProviders(<FarmForm submitLabel="Save" isSubmitting={false} onSubmit={noop} />);

    // 'unknown' is the default, so the nudge is there from the start.
    expect(screen.getByText(/Soil Health Card/i)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByTestId('farm-soil'), 'black');
    await waitFor(() => expect(screen.queryByText(/Soil Health Card/i)).toBeNull());
  });

  it('renders its labels and errors in Hindi', async () => {
    renderWithProviders(<FarmForm submitLabel="सहेजें" isSubmitting={false} onSubmit={noop} />, {
      language: 'hi',
    });

    await userEvent.clear(screen.getByTestId('farm-name'));
    await userEvent.click(screen.getByTestId('farm-submit'));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts[0]!.textContent).toMatch(/[ऀ-ॿ]/);
  });
});

describe('FarmForm · GPS', () => {
  it('fills the coordinates and claims a GPS source on success', async () => {
    stubGeolocation((success) => success({ coords: { latitude: 19.997, longitude: 73.79 } }));

    const onSubmit = vi.fn();
    renderWithProviders(<FarmForm submitLabel="Save" isSubmitting={false} onSubmit={onSubmit} />);

    await userEvent.click(screen.getByTestId('farm-gps'));
    expect(await screen.findByTestId('farm-gps-success')).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('farm-name'), 'North field');
    await userEvent.type(screen.getByTestId('farm-state'), 'Maharashtra');
    await userEvent.type(screen.getByTestId('farm-district'), 'Nashik');
    await userEvent.click(screen.getByTestId('farm-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0].location.source).toBe('gps');
    expect(onSubmit.mock.calls[0]![0].location.lat).toBeCloseTo(19.997, 3);
  });

  /**
   * The four failure modes each get their own message, and none of them blocks
   * the form — the manual district fields are always present, which is the
   * whole point of the fallback.
   */
  const failures = [
    { name: 'permission refused', code: 1, pattern: /permission was refused/i },
    { name: 'position unavailable', code: 2, pattern: /not available right now/i },
    { name: 'timeout', code: 3, pattern: /took too long/i },
  ];

  it.each(failures)(
    'explains a $name and leaves the manual path open',
    async ({ code, pattern }) => {
      stubGeolocation((_success, failure) => failure({ code, PERMISSION_DENIED: 1, TIMEOUT: 3 }));

      const onSubmit = vi.fn();
      renderWithProviders(<FarmForm submitLabel="Save" isSubmitting={false} onSubmit={onSubmit} />);

      await userEvent.click(screen.getByTestId('farm-gps'));

      expect((await screen.findByTestId('farm-gps-error')).textContent).toMatch(pattern);

      // Still completable by hand.
      await userEvent.type(screen.getByTestId('farm-name'), 'North field');
      await userEvent.type(screen.getByTestId('farm-state'), 'Maharashtra');
      await userEvent.type(screen.getByTestId('farm-district'), 'Nashik');
      await userEvent.click(screen.getByTestId('farm-submit'));

      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    },
  );

  it('refuses a fix outside India rather than sending a 422', async () => {
    stubGeolocation((success) => success({ coords: { latitude: 48.85, longitude: 2.35 } }));

    renderWithProviders(<FarmForm submitLabel="Save" isSubmitting={false} onSubmit={noop} />);

    await userEvent.click(screen.getByTestId('farm-gps'));
    expect((await screen.findByTestId('farm-gps-error')).textContent).toMatch(/outside India/i);
  });
});
