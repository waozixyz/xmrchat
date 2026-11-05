import { CreateLiveStreamDto } from '../live-streams/dtos/create-live-stream.dto';
import { LivePushState } from './live-push-state.entity';

export function streamIdentities(
  streams: CreateLiveStreamDto[],
): Record<string, string> {
  return Object.fromEntries(
    streams.map((stream) => [
      stream.platform,
      `${stream.videoId || stream.channelId || stream.channelName || ''}|${stream.startedAt || ''}`,
    ]),
  );
}

export function isNewSession(
  state: LivePushState | undefined,
  identities: Record<string, string>,
  now: Date,
) {
  if (!state) return true;
  const shared = Object.keys(identities).filter(
    (platform) => state.identities[platform] !== undefined,
  );
  if (
    shared.some(
      (platform) => state.identities[platform] === identities[platform],
    )
  )
    return false;
  if (shared.length) return true;
  return now.getTime() - state.lastSeenAt.getTime() > 15 * 60_000;
}
