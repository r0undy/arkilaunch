import { Module } from '@nestjs/common';
import { StubDocumentIntelligenceAdapter } from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { KycController } from './kyc.controller.js';
import { KycService } from './kyc.service.js';
import { DOCUMENT_INTELLIGENCE_PORT } from './kyc.tokens.js';

@Module({
  imports: [StorageModule],
  controllers: [KycController],
  providers: [
    KycService,
    EventsService,
    { provide: DOCUMENT_INTELLIGENCE_PORT, useValue: new StubDocumentIntelligenceAdapter() },
  ],
})
export class KycModule {}
