import { Controller, Headers, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { PaymentsService } from './payments.service.js';

// @Public(): a webhook has no JWT. The signature is verified against req.rawBody before any JSON parsing.
@Controller('webhooks')
export class PaymentsWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post('paymongo')
  paymongo(@Req() req: RawBodyRequest<Request>, @Headers('paymongo-signature') signature?: string) {
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
    return this.payments.handleWebhook(rawBody, signature, process.env.PAYMONGO_WEBHOOK_SECRET);
  }
}
