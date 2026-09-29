import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { createDocumentIntelligenceAdapter } from '../ports/document-intelligence.port.js';
import { KycController } from './kyc.controller.js';
import { KycService } from './kyc.service.js';
import { DOCUMENT_INTELLIGENCE_PORT } from './kyc.tokens.js';

// The adapter comes from a factory that fails closed; never bind a fixture adapter here.
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
