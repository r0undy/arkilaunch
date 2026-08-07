import { Module } from '@nestjs/common';
import { FixtureDocumentIntelligenceAdapter } from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { KycController } from './kyc.controller.js';
import { KycService } from './kyc.service.js';
import { DOCUMENT_INTELLIGENCE_PORT } from './kyc.tokens.js';

// No live Azure DI adapter exists for either state of ENABLE_OCR_KYC yet
// (a real adapter is a follow-up once live credentials + a trained model
// exist) -- so unlike a real flag, ENABLE_OCR_KYC has no effect on which
// adapter binds here today; it only gates apps/web's own UI copy. Bind a
// fixture with plausible SEC/TIN values instead of the always-empty stub,
// so /app/registration renders real-shaped extracted fields in local dev --
// same rationale as edtr.controller.ts's dev/run-worker trigger. The
// always-needs_review state machine (kyc.service.ts) is unaffected either
// way; only the extracted-field values change.
const documentIntelligenceProvider = new FixtureDocumentIntelligenceAdapter({
  fields: {
    sec_number: { value: 'CS202312345', confidence: 0.95 },
    tin: { value: '123-456-789', confidence: 0.93 },
  },
});

@Module({
  imports: [StorageModule],
  controllers: [KycController],
  providers: [
    KycService,
    EventsService,
    { provide: DOCUMENT_INTELLIGENCE_PORT, useValue: documentIntelligenceProvider },
  ],
})
export class KycModule {}
