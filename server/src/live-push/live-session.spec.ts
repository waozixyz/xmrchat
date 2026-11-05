import { LivePushState } from './live-push-state.entity';
import { isNewSession } from './live-session';

describe('live broadcast identity', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const state = Object.assign(new LivePushState(), {
    identities: { twitch: 'stream-1|' },
    lastSeenAt: now,
  });

  it('does not notify again after repeated scans or a temporary platform failure', () => {
    expect(
      isNewSession(
        state,
        { twitch: 'stream-1|' },
        new Date(now.getTime() + 3600000),
      ),
    ).toBe(false);
  });

  it('recognizes a new broadcast on an existing platform', () => {
    expect(isNewSession(state, { twitch: 'stream-2|' }, now)).toBe(true);
  });

  it('consolidates simultaneous platforms and a brief platform switch', () => {
    expect(
      isNewSession(state, { twitch: 'stream-1|', youtube: 'video-1|' }, now),
    ).toBe(false);
    expect(isNewSession(state, { youtube: 'video-1|' }, now)).toBe(false);
  });

  it('recognizes a later broadcast on a new platform', () => {
    expect(
      isNewSession(
        state,
        { youtube: 'video-2|' },
        new Date(now.getTime() + 3600000),
      ),
    ).toBe(true);
  });
});
