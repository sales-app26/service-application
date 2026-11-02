import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ERROR_CODE, REMINDER_ERROR } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PushSubscription } from '../../database/entities';
import { SubscribePushDto } from './dto/push.dto';
import { PushService } from './push.service';

/**
 * The browsers' push services. The API later sends a request to whatever address is stored here,
 * so anything else is refused: otherwise a signed-in person could aim it at an internal address.
 */
const PUSH_SERVICES = [
  /^fcm\.googleapis\.com$/u,
  /^android\.googleapis\.com$/u,
  /(^|\.)push\.services\.mozilla\.com$/u,
  /(^|\.)push\.apple\.com$/u,
  /\.notify\.windows\.com$/u,
];

@Injectable()
export class PushSubscriptionsService {
  constructor(
    @InjectRepository(PushSubscription)
    private readonly subscriptions: Repository<PushSubscription>,
    private readonly push: PushService,
  ) {}

  get publicKey(): string | null {
    return this.push.publicKey;
  }

  async subscribe(actor: AuthenticatedUser, dto: SubscribePushDto): Promise<void> {
    const { hostname } = new URL(dto.endpoint);
    if (!PUSH_SERVICES.some((service) => service.test(hostname))) {
      throw new BusinessException(
        REMINDER_ERROR.UNKNOWN_PUSH_SERVICE,
        ERROR_CODE.VALIDATION_FAILED,
      );
    }
    await this.subscriptions.upsert(
      {
        userId: actor.id,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
      ['endpoint'],
    );
  }

  async unsubscribe(actor: AuthenticatedUser, endpoint: string): Promise<void> {
    await this.subscriptions.delete({ userId: actor.id, endpoint });
  }
}
