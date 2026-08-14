import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import type { YieldEstimateResponse } from '@/api/types';
import { renderWithProviders } from '@/test/render';
import { YieldEstimateView } from './YieldEstimateView';

/**
 * The harvest-estimate view's honesty properties.
 *
 * These are not layout tests. Each one pins a rule the product is not free to
 * break on screen: the number is always a range, the fallback tier is always
 * visible, an unmatched district is always stated, a withheld total always says
 * why, and the word "prediction" never describes this feature.
 *
 * The fixture is shaped exactly as `yieldService.js` serialises it — a fixture
 * that drifts from the wire contract makes green tests that prove nothing.
 */
const base: YieldEstimateResponse = {
  cropId: 'crop-1',
  cropCode: 'WHEAT',
  names: { en: 'Wheat', hi: 'गेहूँ' },
  season: { value: 'RABI', basis: 'REGISTRY_SINGLE_SEASON', basisKey: 'yield.seasonFromRegistry' },
  location: {
    state: 'Punjab',
    district: 'Ludhiana',
    matchedState: 'Punjab',
    matchedDistrict: 'Ludhiana',
    districtMatched: true,
  },
  area: { value: 2, unit: 'acre' },
  estimated: true,
  reasonKey: null,
  tier: 'DISTRICT_SEASON',
  specificity: 'EXACT',
  basisKey: 'yield.basisDistrictSeason',
  basis: {
    medianYieldTHa: 4.97,
    medianYieldQuintalPerAcre: 20.11,
    lowYieldTHa: 4.6,
    highYieldTHa: 5.34,
    sdYieldTHa: 0.37,
    observations: 5,
    years: [2018, 2019, 2020, 2021, 2022],
    latestYear: 2022,
    annualBasis: null,
  },
  production: {
    areaHectares: 0.8094,
    midTonnes: 4.023,
    lowTonnes: 3.723,
    highTonnes: 4.322,
    midQuintals: 40.2,
    lowQuintals: 37.2,
    highQuintals: 43.2,
    unit: 'quintal',
  },
  productionUnavailableReason: null,
  productionUnavailableReasonKey: null,
  factors: [
    {
      factor: 'IRRIGATION',
      applied: false,
      multiplier: null,
      inputValue: 'canal',
      reasonKey: 'yield.factorIrrigationNotApplied',
      sourceRef: {
        org: 'Nature Communications',
        title: 'Zaveri & Lobell (2019)',
        url: null,
        accessed: null,
        confidence: null,
      } as never,
    },
    {
      factor: 'PEST_DISEASE_EVENT',
      applied: false,
      multiplier: null,
      inputValue: 0,
      reasonKey: 'yield.factorEventNotApplied',
      sourceRef: {
        org: 'Indian Journal of Entomology',
        title: 'Dhaliwal et al. (2015)',
        url: null,
        accessed: null,
        confidence: null,
      } as never,
    },
  ],
  limitations: [],
  isRange: true,
  rangeMeaningKey: 'yield.rangeTypicalYearToYear',
  disclaimerKey: 'yield.disclaimer',
  disclaimerVersion: 'yield-v1-2026-08',
  evidence: {
    resolution: 'RESOLVED',
    tier: 'DISTRICT_SEASON',
    specificity: 'EXACT',
    basisKey: 'yield.basisDistrictSeason',
    reasonKey: null,
    attempts: [{ tier: 'DISTRICT_SEASON', outcome: 'HIT', key: '3|36|WHEAT|RABI' }],
  },
  source: {
    name: 'Area, Production, Yield (APY)',
    publisher: 'Directorate of Economics & Statistics, Government of India',
    via: 'India Data Portal (ISB)',
    url: null,
    sha256: 'fe10fbf1',
    licence: 'Government Open Data License – India (GODL)',
    attribution:
      'Directorate of Economics & Statistics, Department of Agriculture & Farmers Welfare, Government of India — Area, Production and Yield of crops, district-wise and season-wise, via India Data Portal (ISB).',
    coverage: { from: '1997-1998', to: '2022-2023', states: 34, districts: 740 },
  },
  freshness: {
    status: 'historical',
    source: 'India Data Portal (ISB)',
    latestYear: 2022,
    dataVintageYears: 4,
  },
  trace: [
    { step: 'LADDER', attempts: [] },
    { step: 'PRODUCTION', formula: 'medianYieldTHa × areaHectares', midTonnes: 4.023 },
  ],
};

const view = (estimate: YieldEstimateResponse) =>
  renderWithProviders(<YieldEstimateView estimate={estimate} cropName="Wheat" />);

describe('YieldEstimateView · estimated', () => {
  it('shows a range, never a bare number', () => {
    view(base);
    const range = screen.getByTestId('yield-range');
    expect(range.textContent).toContain('37.2');
    expect(range.textContent).toContain('43.2');
  });

  it('says the range is year-to-year variation, not a confidence interval', () => {
    view(base);
    expect(screen.getByText(/normal year-to-year variation/i)).toBeInTheDocument();
    expect(screen.queryByText(/confidence interval/i)?.textContent).toMatch(/not a confidence/i);
  });

  it('never calls itself a prediction or a forecast', () => {
    view(base);
    // The mandatory framing is present…
    expect(screen.getByText(/not an AI prediction or a forecast/i)).toBeInTheDocument();
    // …and nothing on the screen claims otherwise.
    expect(document.body.textContent).not.toMatch(/\bwe predict\b|\bforecast of\b/i);
  });

  it('names which rung of the evidence ladder answered', () => {
    view(base);
    expect(screen.getByTestId('yield-specificity')).toHaveTextContent(/your district and season/i);
  });

  it('shows the years and observation count behind the number', () => {
    view(base);
    expect(screen.getByText(/5 reported years/i)).toBeInTheDocument();
    // Twice by design: once as the evidence hint, once inside the disclaimer,
    // which is required to name the years it is based on.
    expect(screen.getAllByText(/2018 to 2022/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('yield-disclaimer').textContent).toMatch(/2018 to 2022/);
  });

  it('carries the government attribution the licence requires', () => {
    view(base);
    expect(screen.getByTestId('yield-attribution').textContent).toMatch(
      /Directorate of Economics & Statistics/,
    );
  });

  it('reports both factors as not applied, with their citations', () => {
    view(base);
    const factors = screen.getByTestId('yield-factors');
    expect(factors.textContent).toMatch(/No adjustment factors were applied/i);
    expect(factors.textContent).toMatch(/Zaveri & Lobell/);
    expect(factors.textContent).toMatch(/Dhaliwal/);
    expect(screen.getAllByText(/not applied/i).length).toBeGreaterThan(0);
  });

  it('labels the data historical rather than live', () => {
    view(base);
    expect(screen.getByTestId('yield-estimate').textContent).toMatch(/historical/i);
  });
});

describe('YieldEstimateView · degraded evidence', () => {
  it('states plainly when the district could not be matched', () => {
    view({
      ...base,
      tier: 'STATE_SEASON',
      specificity: 'STATE',
      basisKey: 'yield.basisStateSeason',
      location: { ...base.location, matchedDistrict: null, districtMatched: false },
    });

    expect(screen.getByTestId('yield-unmatched-district').textContent).toMatch(/Ludhiana/);
    expect(screen.getByTestId('yield-specificity')).toHaveTextContent(/state average/i);
  });

  it('lists the limitations it cannot quantify', () => {
    view({
      ...base,
      limitations: [
        { key: 'yield.limitRainfed', data: {} },
        { key: 'yield.limitVintage', data: { latestYear: 2022, years: 4 } },
      ],
    });

    const limitations = screen.getByTestId('yield-limitations');
    expect(limitations.textContent).toMatch(/rainfed/i);
    expect(limitations.textContent).toMatch(/2022/);
  });

  it('explains a withheld total instead of showing a zero', () => {
    view({
      ...base,
      area: { value: 4, unit: 'bigha' },
      production: null,
      productionUnavailableReason: 'AREA_UNIT_AMBIGUOUS',
      productionUnavailableReasonKey: 'yield.productionAreaUnitAmbiguous',
    });

    expect(screen.getByTestId('yield-no-total').textContent).toMatch(/bigha is a different size/i);
    expect(screen.queryByTestId('yield-range')).not.toBeInTheDocument();
    // The district's own figure is still useful and still shown.
    expect(screen.getByText(/4.97 tonnes per hectare/i)).toBeInTheDocument();
  });
});

describe('YieldEstimateView · insufficient evidence', () => {
  const unavailable: YieldEstimateResponse = {
    ...base,
    estimated: false,
    reasonKey: 'yield.evidenceCropNotSupported',
    tier: null,
    specificity: null,
    basisKey: null,
    basis: null,
    production: null,
    factors: [],
    limitations: [],
    isRange: false,
    rangeMeaningKey: null,
    evidence: {
      resolution: 'INSUFFICIENT_EVIDENCE',
      tier: null,
      specificity: null,
      basisKey: null,
      reasonKey: 'yield.evidenceCropNotSupported',
      attempts: [],
    },
  };

  it('renders a designed state, not an error', () => {
    view(unavailable);
    expect(screen.getByTestId('yield-insufficient')).toBeInTheDocument();
    expect(screen.getByText(/Not enough historical evidence/i)).toBeInTheDocument();
  });

  it('says why, and says we will not guess', () => {
    view(unavailable);
    expect(screen.getByTestId('yield-reason').textContent).toMatch(
      /do not have reliable government yield records/i,
    );
    expect(screen.getByText(/rather show nothing than a made-up number/i)).toBeInTheDocument();
  });

  it('shows no number at all', () => {
    view(unavailable);
    expect(screen.queryByTestId('yield-range')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/quintal/i);
  });
});

describe('YieldEstimateView · Hindi', () => {
  it('renders the estimate in Hindi without falling back to English', () => {
    renderWithProviders(<YieldEstimateView estimate={base} cropName="गेहूँ" />, {
      language: 'hi',
    });
    expect(screen.getByText(/अनुमानित उत्पादन/)).toBeInTheDocument();
    expect(screen.getByTestId('yield-estimate').textContent).not.toMatch(/Estimated production/);
  });
});
