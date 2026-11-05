import { LiveStreamPlatformEnum } from '../shared/constants';
import { LivePushService } from './live-push.service';
import { LivePushState } from './live-push-state.entity';

describe('live push snapshot and outbox', () => {
  const stream = (videoId: string) => ({
    pageId: 1,
    platform: LiveStreamPlatformEnum.YOUTUBE,
    videoId,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    data: { embedUrl: 'https://example.com/player' },
  });

  it('preserves the existing live service without accessing push tables when unconfigured', async () => {
    const service = new LivePushService(
      { get: () => undefined } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const snapshot = [stream('first')];
    await expect(service.updateSnapshot({} as any, snapshot)).resolves.toBe(
      snapshot,
    );
  });

  it('keeps a silent baseline, preserves stream data and emits one event for a later simulcast', async () => {
    const saved = new Map<number, LivePushState>();
    const events: any[] = [];
    const states = {
      existsBy: async ({ pageId }) => saved.has(pageId),
      findOneBy: async ({ pageId }) => saved.get(pageId),
      create: (value) => Object.assign(new LivePushState(), value),
      save: async (value) => saved.set(value.pageId, value),
    };
    const page = { id: 1, path: 'creator', isPublic: true };
    const manager = {
      query: jest.fn(),
      getRepository: () => states,
      findBy: async () => [page],
      save: async (_entity, event) => events.push(event),
    };
    const service = new LivePushService(
      { get: () => 'configured' } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const first = stream('first');
    const baseline = await service.updateSnapshot(manager as any, [first]);
    const repeated = await service.updateSnapshot(manager as any, [first]);
    expect(events).toHaveLength(0);
    expect(repeated[0].data.notificationSessionId).toBe(
      baseline[0].data.notificationSessionId,
    );
    expect(repeated[0].data.embedUrl).toBe(first.data.embedUrl);

    await service.updateSnapshot(manager as any, []);
    await service.updateSnapshot(manager as any, [first]);
    expect(events).toHaveLength(0);

    const second = stream('second');
    const simulcast = await service.updateSnapshot(manager as any, [
      second,
      { ...second, platform: LiveStreamPlatformEnum.TWITCH, videoId: 'twitch' },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].message.path).toBe('creator');
    expect(simulcast[0].data.notificationSessionId).toBe(events[0].id);
    expect(simulcast[1].data.notificationSessionId).toBe(events[0].id);
    expect(events[0].id).not.toBe(baseline[0].data.notificationSessionId);

    page.isPublic = false;
    await service.updateSnapshot(manager as any, [stream('private')]);
    expect(events).toHaveLength(1);
  });

  it('leaves a failed fanout pending and retries with the same delivery identifier', async () => {
    const event = {
      id: 'event-id',
      message: { type: 'live', path: 'creator' },
      expiresAt: new Date(Date.now() + 300_000),
    };
    const pending: any = {};
    for (const method of [
      'where',
      'andWhere',
      'setLock',
      'setOnLocked',
      'take',
    ])
      pending[method] = jest.fn().mockReturnValue(pending);
    pending.getMany = jest.fn().mockResolvedValue([event]);
    const cleanup: any = {};
    for (const method of ['delete', 'where'])
      cleanup[method] = jest.fn().mockReturnValue(cleanup);
    cleanup.execute = jest.fn();
    const manager = {
      getRepository: () => ({ createQueryBuilder: () => pending }),
      update: jest.fn(),
    };
    const subscriptions = {
      find: jest
        .fn()
        .mockResolvedValue([
          { id: 'installation', endpoint: 'https://example.com/push' },
        ]),
      createQueryBuilder: () => cleanup,
    };
    const queue = {
      add: jest.fn().mockRejectedValueOnce(new Error('Redis unavailable')),
    };
    const service = new LivePushService(
      { get: () => 'configured' } as any,
      subscriptions as any,
      {
        manager: { transaction: (callback) => callback(manager) },
        createQueryBuilder: () => cleanup,
      } as any,
      queue as any,
    );
    await expect(service.dispatch()).rejects.toThrow('Redis unavailable');
    expect(manager.update).not.toHaveBeenCalled();
    await service.dispatch();
    expect(manager.update).toHaveBeenCalledWith(expect.anything(), event.id, {
      dispatched: true,
    });
    expect(queue.add.mock.calls[0][2].jobId).toBe('event-id-installation');
    expect(queue.add.mock.calls[1][2].jobId).toBe('event-id-installation');
  });
});
