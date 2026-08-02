import { Controller, Headers, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { PaymentsService } from './payments.service.js';

// PRD-F2, SDD §4 `POST /api/v1/webhooks/paymongo`. @Public(): a webhook has
// no JWT and never will (RFC-1's guard chain does not apply here). Reads
// req.rawBody (see main.ts's `rawBody: true`) so the signature is verified
// against the exact bytes PayMongo signed, before any JSON parsing
// (QAD-T28).
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
