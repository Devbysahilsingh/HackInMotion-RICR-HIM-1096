import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { WeatherDay } from '@/api/types';
import { renderWithProviders } from '@/test/render';
import * as fixtures from '@/test/fixtures';
import { PriceTrendChart } from './PriceTrendChart';
import { RainfallChart, TemperatureChart } from './WeatherCharts';

/**
 * Chart safety and accessibility.
 *
 * The dataviz rules this suite holds to: every chart is safe when data is
 * missing, every chart has a table equivalent (an SVG is unreadable to a
 * screen reader and to anyone who wants the actual number), and a chart with
 * two series carries a legend.
 *
 * Recharts needs a measured container, which jsdom does not provide, so the
 * plot itself renders empty here. That is fine — what is under test is the
 * frame, the empty handling and the table, all of which are ours.
 */
describe('PriceTrendChart', () => {
  it('renders a designed empty state rather than an axis with no data', () => {
    renderWithProviders(<PriceTrendChart series={[]} days={30} />);

    expect(screen.getByText(/No price reports in this window/i)).toBeInTheDocument();
    expect(screen.queryByTestId('chart-table-toggle')).toBeNull();
  });

  it('offers the same data as a real table', async () => {
    renderWithProviders(<PriceTrendChart series={fixtures.priceSeries.series} days={30} />);

    await userEvent.click(screen.getByTestId('chart-table-toggle'));

    const table = screen.getByTestId('chart-table');
    expect(table.querySelector('table')).not.toBeNull();
    // Header cells are scoped, so a screen reader can associate them.
    expect(table.querySelectorAll('th[scope="col"]').length).toBeGreaterThan(0);
    expect(table.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  });

  it('collapses several mandi reports on one day into one point', async () => {
    renderWithProviders(<PriceTrendChart series={fixtures.priceSeries.series} days={30} />);

    await userEvent.click(screen.getByTestId('chart-table-toggle'));

    // The fixture holds ten rows across ten distinct days from two mandis.
    const rows = screen.getByTestId('chart-table').querySelectorAll('tbody tr');
    const days = new Set(fixtures.priceSeries.series.map((row) => row.date.slice(0, 10)));
    expect(rows.length).toBe(days.size);
  });
});

describe('WeatherCharts', () => {
  const daily = fixtures.farmWeather.daily;

  it('carries a legend for its two temperature series', () => {
    renderWithProviders(<TemperatureChart daily={daily} />);

    // Two series must never rely on colour matching alone.
    expect(screen.getByText(/Daytime high/i)).toBeInTheDocument();
    expect(screen.getByText(/Night-time low/i)).toBeInTheDocument();
  });

  it('needs no legend for a single rainfall series', () => {
    renderWithProviders(<RainfallChart daily={daily} />);

    // The title names what is plotted; a one-swatch legend would restate it.
    const frame = screen.getByTestId('chart-frame');
    expect(frame.querySelector('ul')).toBeNull();
  });

  it('survives days with no readings at all', () => {
    const missing: WeatherDay[] = daily.map((day) => ({
      ...day,
      tMinC: null,
      tMaxC: null,
      rainMm: null,
    }));

    renderWithProviders(<TemperatureChart daily={missing} />);
    renderWithProviders(<RainfallChart daily={missing} />);

    // No crash, and no fabricated zero standing in for a missing reading.
    expect(screen.getAllByText(/Nothing here yet/i).length).toBeGreaterThan(0);
  });

  it('renders its labels in Hindi', () => {
    renderWithProviders(<TemperatureChart daily={daily} />, { language: 'hi' });
    expect(screen.getByTestId('chart-frame').textContent).toMatch(/[ऀ-ॿ]/);
  });
});
