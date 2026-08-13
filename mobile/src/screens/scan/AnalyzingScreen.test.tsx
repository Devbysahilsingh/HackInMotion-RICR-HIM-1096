/**
 * The wait-time sentence a rate-limited farmer reads.
 *
 * Only the pure helper is exercised here: what matters is that the app never
 * names a duration the server did not send, and that the one it does name is
 * rounded in the direction that cannot produce a second refusal. Rendering the
 * screen would test React, not that promise.
 */
import { rateLimitWait } from './AnalyzingScreen';

jest.mock('../../api/endpoints', () => ({ healthApi: { analyze: jest.fn() } }));
jest.mock('../../services/image', () => ({ prepareForUpload: jest.fn() }));

describe('rateLimitWait', () => {
  it('says nothing when the server sent no Retry-After', () => {
    expect(rateLimitWait(null)).toBeNull();
  });

  it('says nothing for a wait that has already elapsed', () => {
    expect(rateLimitWait(0)).toBeNull();
  });

  it('reads a sub-minute wait in seconds, unrounded', () => {
    expect(rateLimitWait(42)).toEqual({
      key: 'mobile:upload.rateLimitedWaitSeconds',
      count: 42,
    });
  });

  it('rounds a minutes-scale wait up, never down', () => {
    // 61s is "2 minutes", not "1 minute": sending the farmer back at 60s would
    // earn them a second 429.
    expect(rateLimitWait(61)).toEqual({
      key: 'mobile:upload.rateLimitedWaitMinutes',
      count: 2,
    });
    expect(rateLimitWait(60)).toEqual({
      key: 'mobile:upload.rateLimitedWaitMinutes',
      count: 1,
    });
  });

  it('reads the daily cap in hours', () => {
    expect(rateLimitWait(7200)).toEqual({
      key: 'mobile:upload.rateLimitedWaitHours',
      count: 2,
    });
  });
});
