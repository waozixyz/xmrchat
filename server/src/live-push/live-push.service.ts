import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { request } from 'node:https';
import { EntityManager, In, MoreThan, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { Page } from '../pages/page.entity';
import { CreateLiveStreamDto } from '../live-streams/dtos/create-live-stream.dto';
import { PushSubscription } from './push-subscription.entity';
import { LivePushState } from './live-push-state.entity';
import { LivePushEvent, LivePushMessage } from './live-push-event.entity';
import { PushRegistrationDto } from './push-registration.dto';
import { resolvePushEndpoint } from './push-endpoint';
import { isNewSession, streamIdentities } from './live-session';

@Injectable()
export class LivePushService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PushSubscription)
    private readonly subscriptions: Repository<PushSubscription>,
    @InjectRepository(LivePushEvent)
    private readonly events: Repository<LivePushEvent>,
    @InjectQueue('xmrpod-push') private readonly queue: Queue,
  ) {}

  publicKey() {
    const publicKey = this.config.get<string>('XMRPOD_PUSH_VAPID_PUBLIC_KEY');
    if (!publicKey || !this.config.get('XMRPOD_PUSH_VAPID_PRIVATE_KEY')) {
      throw new ServiceUnavailableException('Live push is not configured');
    }
    return { publicKey };
  }

  private tokenHash(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) throw new UnauthorizedException();
    return createHash('sha256').update(token).digest('hex');
  }

  async authorize(id: string, token: string) {
    const hash = this.tokenHash(token);
    const subscription = await this.subscriptions.findOneBy({ id });
    if (
      !subscription ||
      !timingSafeEqual(Buffer.from(hash), Buffer.from(subscription.tokenHash))
    ) {
      throw new UnauthorizedException();
    }
    return subscription;
  }

  async register(id: string, token: string, dto: PushRegistrationDto) {
    this.publicKey();
    const tokenHash = this.tokenHash(token);
    await resolvePushEndpoint(dto.endpoint);
    if (
      Buffer.from(dto.p256dh, 'base64url').length !== 65 ||
      Buffer.from(dto.auth, 'base64url').length !== 16
    ) {
      throw new BadRequestException('Invalid push keys');
    }
    const existing = await this.subscriptions.findOneBy({ id });
    if (existing) await this.authorize(id, token);
    const unchanged =
      existing?.endpoint === dto.endpoint &&
      existing.p256dh === dto.p256dh &&
      existing.auth === dto.auth;
    const challenge = unchanged && existing.verifiedAt ? null : randomUUID();
    const subscription = await this.subscriptions.save({
      id,
      tokenHash,
      ...dto,
      challenge,
      verifiedAt: unchanged ? existing.verifiedAt : null,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    });
    if (challenge)
      await this.enqueue(
        subscription,
        { type: 'verify', nonce: challenge },
        challenge,
        Date.now() + 5 * 60_000,
      );
    return { registered: true, verified: Boolean(subscription.verifiedAt) };
  }

  async acknowledge(id: string, token: string, nonce: string) {
    const subscription = await this.authorize(id, token);
    if (!subscription.challenge && subscription.verifiedAt)
      return { verified: true };
    if (!subscription.challenge || subscription.challenge !== nonce)
      throw new ConflictException('Challenge was superseded');
    await this.subscriptions.update(id, {
      challenge: null,
      verifiedAt: new Date(),
    });
    return { verified: true };
  }

  async test(id: string, token: string) {
    const subscription = await this.authorize(id, token);
    const nonce = randomUUID();
    await this.subscriptions.update(id, { challenge: nonce });
    await this.enqueue(
      subscription,
      { type: 'test', nonce },
      nonce,
      Date.now() + 5 * 60_000,
    );
    return { queued: true };
  }

  async unregister(id: string, token: string) {
    await this.authorize(id, token);
    await this.subscriptions.delete(id);
    return { removed: true };
  }

  private async enqueue(
    subscription: PushSubscription,
    message: LivePushMessage,
    eventId: string,
    expiresAt: number,
  ) {
    await this.queue.add(
      'send',
      {
        id: subscription.id,
        endpoint: subscription.endpoint,
        message,
        expiresAt,
      },
      {
        jobId: `${eventId}-${subscription.id}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 24 * 60 * 60 },
      },
    );
  }

  async updateSnapshot(manager: EntityManager, streams: CreateLiveStreamDto[]) {
    if (!this.config.get('XMRPOD_PUSH_VAPID_PRIVATE_KEY')) return streams;
    await manager.query('SELECT pg_advisory_xact_lock(17920346)');
    const states = manager.getRepository(LivePushState);
    const now = new Date();
    const initialized = await states.existsBy({ pageId: 0 });
    if (!initialized)
      await states.save({
        pageId: 0,
        sessionId: randomUUID(),
        identities: {},
        startedAt: now,
        lastSeenAt: now,
      });
    const pageIds = [...new Set(streams.map((stream) => stream.pageId))];
    const pages = pageIds.length
      ? await manager.findBy(Page, { id: In(pageIds) })
      : [];
    const result: CreateLiveStreamDto[] = [];
    for (const page of pages) {
      const current = streams.filter((stream) => stream.pageId === page.id);
      const identities = streamIdentities(current);
      let state = await states.findOneBy({ pageId: page.id });
      const fresh = isNewSession(state, identities, now);
      if (fresh) {
        const starts = current
          .map((stream) => new Date(stream.startedAt || now).getTime())
          .filter((time) => Number.isFinite(time) && time <= now.getTime());
        state = states.create({
          pageId: page.id,
          sessionId: randomUUID(),
          startedAt: new Date(Math.min(now.getTime(), ...starts)),
          identities,
          lastSeenAt: now,
        });
        if (initialized && page.isPublic) {
          await manager.save(LivePushEvent, {
            id: state.sessionId,
            dispatched: false,
            expiresAt: new Date(now.getTime() + 5 * 60_000),
            message: {
              type: 'live',
              sessionId: state.sessionId,
              path: page.path,
              startedAt: state.startedAt.toISOString(),
              detectedAt: now.toISOString(),
            },
          });
        }
      } else {
        state.identities = { ...state.identities, ...identities };
        state.lastSeenAt = now;
      }
      await states.save(state);
      result.push(
        ...current.map((stream) => ({
          ...stream,
          data: {
            ...stream.data,
            notificationSessionId: state.sessionId,
            notificationStartedAt: state.startedAt.toISOString(),
          },
        })),
      );
    }
    return result;
  }

  @Interval(30_000)
  async dispatch() {
    if (!this.config.get('XMRPOD_PUSH_VAPID_PRIVATE_KEY')) return;
    await this.events.manager.transaction(async (manager) => {
      const pending = await manager
        .getRepository(LivePushEvent)
        .createQueryBuilder('event')
        .where('event.dispatched = false')
        .andWhere('event.expiresAt > :now', { now: new Date() })
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .take(20)
        .getMany();
      for (const event of pending) {
        let offset = 0;
        while (true) {
          const subscriptions = await this.subscriptions.find({
            where: {
              verifiedAt: MoreThan(new Date(0)),
              expiresAt: MoreThan(new Date()),
            },
            order: { id: 'ASC' },
            skip: offset,
            take: 250,
          });
          for (const subscription of subscriptions)
            await this.enqueue(
              subscription,
              event.message,
              event.id,
              event.expiresAt.getTime(),
            );
          if (subscriptions.length < 250) break;
          offset += subscriptions.length;
        }
        await manager.update(LivePushEvent, event.id, { dispatched: true });
      }
    });
    await this.events
      .createQueryBuilder()
      .delete()
      .where('expires_at < :cutoff', {
        cutoff: new Date(Date.now() - 24 * 60 * 60_000),
      })
      .execute();
    await this.subscriptions
      .createQueryBuilder()
      .delete()
      .where('expires_at < :now', { now: new Date() })
      .execute();
  }

  async send(job: {
    id: string;
    endpoint: string;
    message: LivePushMessage;
    expiresAt: number;
  }) {
    if (job.expiresAt < Date.now()) return;
    const subscription = await this.subscriptions.findOneBy({
      id: job.id,
      endpoint: job.endpoint,
      expiresAt: MoreThan(new Date()),
    });
    if (
      !subscription ||
      (job.message.type === 'live' && !subscription.verifiedAt)
    )
      return;
    const { url, address, family } = await resolvePushEndpoint(
      subscription.endpoint,
    );
    const details = webpush.generateRequestDetails(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(job.message),
      {
        TTL: Math.max(0, Math.floor((job.expiresAt - Date.now()) / 1000)),
        contentEncoding: 'aes128gcm',
        vapidDetails: {
          subject:
            this.config.get('XMRPOD_PUSH_VAPID_SUBJECT') ||
            'https://xmrchat.com',
          publicKey: this.publicKey().publicKey,
          privateKey: this.config.get('XMRPOD_PUSH_VAPID_PRIVATE_KEY'),
        },
      },
    );
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        url,
        {
          method: details.method,
          headers: details.headers,
          family,
          lookup: (_host, _options, callback) =>
            callback(null, address, family),
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode || 500));
          response.on('error', reject);
        },
      );
      req.setTimeout(10_000, () =>
        req.destroy(new Error('Push request timed out')),
      );
      req.on('error', reject);
      req.end(details.body);
    });
    if ([401, 403, 404, 410].includes(status)) {
      await this.subscriptions.delete(subscription.id);
    } else if (status < 200 || status >= 300) {
      throw new Error(`Push delivery returned ${status}`);
    }
  }
}
