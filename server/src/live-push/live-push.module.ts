import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueuesModule } from '../queues/queues.module';
import { LivePushService } from './live-push.service';
import { LivePushController } from './live-push.controller';
import { PushSubscription } from './push-subscription.entity';
import { LivePushState } from './live-push-state.entity';
import { LivePushEvent } from './live-push-event.entity';

@Processor('xmrpod-push')
export class LivePushProcessor extends WorkerHost {
  constructor(private readonly service: LivePushService) {
    super();
  }
  async process(job: Job) {
    await this.service.send(job.data);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([PushSubscription, LivePushState, LivePushEvent]),
    QueuesModule,
  ],
  controllers: [LivePushController],
  providers: [LivePushService, LivePushProcessor],
  exports: [LivePushService],
})
export class LivePushModule {}
