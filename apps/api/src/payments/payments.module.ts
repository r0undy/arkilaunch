import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { createPaymentsAdapter } from '../ports/payments.port.js';
import { PaymentsController, TruckPaymentsController } from './payments.controller.js';
import { CouponsController } from './coupons.controller.js';
import { CouponsService } from './coupons.service.js';
import { PaymentsWebhookController } from './webhooks.controller.js';
import { PaymentsService } from './payments.service.js';
import { PAYMENTS_PORT } from './payments.tokens.js';

@Module({
  controllers: [PaymentsController, TruckPaymentsController, PaymentsWebhookController, CouponsController],
  providers: [PaymentsService, CouponsService, EventsService, { provide: PAYMENTS_PORT, useFactory: createPaymentsAdapter }],
})
export class PaymentsModule {}
