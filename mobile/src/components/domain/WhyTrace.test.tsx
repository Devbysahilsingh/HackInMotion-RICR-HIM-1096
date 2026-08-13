/**
 * The trace is polymorphic, and the API is entitled to be.
 *
 * An irrigation item carries the engine's array of steps; a weather-risk item
 * carries `risk.data`, a flat object of the numbers compared against a
 * threshold (`feedComposer.js`: `trace: risk.data`). Both satisfy R12; only one
 * of them is an array. These tests exist because the failure mode of getting
 * that wrong is silent — a CRITICAL rain warning claiming "no calculation
 * details were recorded" while its numbers sit in the payload.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { initI18n } from '../../i18n';
import { WhyTrace } from './WhyTrace';

jest.mock('../../store/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: jest.fn() }),
}));

jest.mock('../../store/AuthContext', () => ({
  useAuth: () => ({ user: { voiceEnabled: false }, status: 'authenticated' }),
}));

beforeAll(() => {
  initI18n('en');
});

const open = () => fireEvent.press(screen.getByTestId('why-toggle'));

describe('WhyTrace', () => {
  it('renders an array of engine steps', () => {
    render(<WhyTrace trace={[{ step: 'SOIL', tawMm: 120, rawMm: 66 }]} />);
    open();

    expect(screen.getByText('SOIL')).toBeTruthy();
    expect(screen.getByText('tawMm')).toBeTruthy();
    expect(screen.getByText('120')).toBeTruthy();
  });

  it('presents a bare object as one unnamed step rather than claiming no trace', () => {
    render(<WhyTrace trace={{ rainMm: 48, rainProbPct: 80 }} />);
    open();

    expect(screen.getByText('VALUES')).toBeTruthy();
    expect(screen.getByText('rainMm')).toBeTruthy();
    expect(screen.queryByText('No calculation details were recorded for this item.')).toBeNull();
  });

  it('says so honestly when there is nothing to show', () => {
    render(<WhyTrace trace={null} />);
    open();

    expect(screen.getByText('No calculation details were recorded for this item.')).toBeTruthy();
  });

  it('renders a missing number as an em dash, never as zero', () => {
    render(<WhyTrace trace={[{ step: 'STAGE', kc: null }]} />);
    open();

    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });
});
