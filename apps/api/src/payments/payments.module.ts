import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { createPaymentsAdapter } from '../ports/payments.port.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsWebhookController } from './webhooks.controller.js';
import { PaymentsService } from './payments.service.js';
import { PAYMENTS_PORT } from './payments.tokens.js';

@Module({
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [PaymentsService, EventsService, { provide: PAYMENTS_PORT, useFactory: createPaymentsAdapter }],
})
export class PaymentsModule {}
