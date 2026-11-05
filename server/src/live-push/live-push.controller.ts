import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsPublic } from '../shared/decorators/is-public.decorator';
import { LivePushService } from './live-push.service';
import {
  PushAcknowledgementDto,
  PushRegistrationDto,
} from './push-registration.dto';

@Controller('live-streams/push')
@IsPublic()
@Throttle({ default: { limit: 12, ttl: 60_000 } })
export class LivePushController {
  constructor(private readonly service: LivePushService) {}

  @Get('key')
  key() {
    return this.service.publicKey();
  }

  @Put('subscriptions/:id')
  register(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') token: string,
    @Body() dto: PushRegistrationDto,
  ) {
    return this.service.register(id, token?.replace(/^Bearer /, ''), dto);
  }

  @Delete('subscriptions/:id')
  unregister(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') token: string,
  ) {
    return this.service.unregister(id, token?.replace(/^Bearer /, ''));
  }

  @Post('subscriptions/:id/ack')
  acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') token: string,
    @Body() dto: PushAcknowledgementDto,
  ) {
    return this.service.acknowledge(
      id,
      token?.replace(/^Bearer /, ''),
      dto.nonce,
    );
  }

  @Post('subscriptions/:id/test')
  test(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') token: string,
  ) {
    return this.service.test(id, token?.replace(/^Bearer /, ''));
  }
}
