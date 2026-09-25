import { describe, expect, it } from 'vitest';
import { olderBuild } from '../net/protocol';

describe('build order', () => {
  it('orders builds by bundle time', () => {
    const early = (1_790_000_000_000).toString(36);
    const late = (1_790_000_600_000).toString(36);
    expect(olderBuild(early, late)).toBe(true);
    expect(olderBuild(late, early)).toBe(false);
    expect(olderBuild(late, late)).toBe(false);
  });

  it('never calls a dev build older, so it cannot reload in a loop', () => {
    expect(olderBuild('dev', 'mfz0abc')).toBe(false);
    expect(olderBuild('mfz0abc', 'dev')).toBe(false);
  });
});
