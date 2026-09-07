import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { createDocumentIntelligenceAdapter } from '../ports/document-intelligence.port.js';
import { KycController } from './kyc.controller.js';
import { KycService } from './kyc.service.js';
import { DOCUMENT_INTELLIGENCE_PORT } from './kyc.tokens.js';

// This module used to bind a FixtureDocumentIntelligenceAdapter with
// literal `sec_number: 'CS202312345'` / `tin: '123-456-789'` at 0.95
// confidence, unconditionally, at module scope -- in every environment
// including production. The human gate held (KycService lands every
// extraction at needs_review, and verification requires an admin-supplied
// portal match), so it could not auto-verify a tenant. But a reviewer was
// shown invented registration numbers presented as extracted fact at high
// confidence, on a compliance decision, and fabricated
// ocr_field_confidence events entered the audit trail.
//
// The adapter is now resolved by a factory that fails closed
// (cr-arkilaunch-pilot-honesty.md §2).
@Module({
  imports: [StorageModule],
  controllers: [KycController],
  providers: [
    KycService,
    EventsService,
    { provide: DOCUMENT_INTELLIGENCE_PORT, useFactory: createDocumentIntelligenceAdapter },
  ],
})
export class KycModule {}
