import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as webPush from 'web-push';

import { CONFIG_NAMESPACE } from '../../common/constants';
import { RemindersConfig } from '../../config/configuration';
import { PushSubscription } from '../../database/entities';

const SEND_TIMEOUT_MS = 10_000;
/** A reminder an hour late is no use. */
const TIME_TO_LIVE_SECONDS = 60 * 60;
/** The push service says this device is gone for good. */
const GONE = new Set([404, 410]);

export interface PushMessage {
  title: string;
  body?: string | null;
  link?: string | null;
}

/**
 * Sends reminders to people's phones over web push. Never throws: a phone that can't be reached
 * mustn't stop the next person's reminder, and the same reminder is in the app regardless.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly config: RemindersConfig;

  constructor(
    configService: ConfigService,
    @InjectRepository(PushSubscription)
    private readonly subscriptions: Repository<PushSubscription>,
  ) {
    this.config = configService.getOrThrow<RemindersConfig>(CONFIG_NAMESPACE.REMINDERS);
  }

  get enabled(): boolean {
    return !!(
      this.config.vapidPublicKey &&
      this.config.vapidPrivateKey &&
      this.config.vapidSubject
    );
  }

  /** What a phone needs to subscribe. Null when push isn't set up. */
  get publicKey(): string | null {
    return this.enabled ? this.config.vapidPublicKey : null;
  }

  async send(userIds: string[], message: PushMessage): Promise<void> {
    if (!this.enabled || userIds.length === 0) return;
    const devices = await this.subscriptions.find({ where: { userId: In(userIds) } });
    await Promise.all(devices.map((device) => this.sendOne(device, message)));
  }

  private async sendOne(device: PushSubscription, message: PushMessage): Promise<void> {
    try {
      // Sent with fetch, not web-push's own request, so the timeout is ours.
      const request = webPush.generateRequestDetails(
        {
          endpoint: device.endpoint,
          keys: { p256dh: device.p256dh, auth: device.auth },
        },
        JSON.stringify({ title: message.title, body: message.body, link: message.link }),
        {
          TTL: TIME_TO_LIVE_SECONDS,
          urgency: 'high',
          vapidDetails: {
            subject: this.config.vapidSubject,
            publicKey: this.config.vapidPublicKey,
            privateKey: this.config.vapidPrivateKey,
          },
        },
      );
      const response = await fetch(request.endpoint, {
        method: request.method,
        headers: request.headers as Record<string, string>,
        body: request.body ? new Uint8Array(request.body as unknown as Buffer) : undefined,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (GONE.has(response.status)) {
        await this.subscriptions.delete({ id: device.id });
      } else if (!response.ok) {
        this.logger.warn(`Push to a device of ${device.userId} -> ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`Push to a device of ${device.userId} failed: ${(error as Error).message}`);
    }
  }
}
