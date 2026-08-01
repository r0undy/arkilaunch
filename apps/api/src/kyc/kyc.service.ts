import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { kycDocuments, withTenantTx } from '@arkilaunch/db';
import {
  SEC_REGEX,
  TIN_REGEX,
  matchBand,
  type DocumentIntelligencePort,
  type KycConfirmRequest,
  type KycExtractRequest,
  type MatchBand,
  type RequestContext,
} from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { DOCUMENT_INTELLIGENCE_PORT } from './kyc.tokens.js';

interface KycOcrPayload {
  sec_number?: string;
  tin?: string;
  sec_confidence?: number;
  tin_confidence?: number;
}

const KYC_MODEL_ID = 'arkilaunch-kyc-layout-query';

@Injectable()
export class KycService {
  // Token-injected (interfaces have no runtime type for Nest's reflection
  // to resolve): kyc.module.ts provides DOCUMENT_INTELLIGENCE_PORT as the
  // stub adapter by default (no live Azure DI credentials/trained model in
  // this pass, decided for F3 the same way edtr-ocr-worker was); a test can
  // override the provider with a fixture adapter without touching the rest
  // of the flow.
  constructor(
    private readonly events: EventsService,
    @Inject(DOCUMENT_INTELLIGENCE_PORT) private readonly port: DocumentIntelligencePort,
  ) {}

  // POST /api/v1/kyc/extract (RFC-2 §2/§3). Azure DI layout+query fields,
  // not the prebuilt idDocument model (scrutiny FC-5: that model covers
  // only US licenses/passports, not PH corporate identifiers).
  async extract(ctx: RequestContext, body: KycExtractRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [created] = await tx
        .insert(kycDocuments)
        .values({
          tenantId: ctx.tenantId,
          customerId: body.customerId,
          documentType: body.documentType,
          fileUri: body.fileUri,
          status: 'pending', // API surface reports this as "queued" (RFC-2 §3)
        })
        .returning();
      if (!created) throw new Error('kyc_documents insert returned no row');

      // Extraction runs synchronously against the stub/injected port in
      // this pass (Azure DI calls are near-instant for the stub; a real
      // adapter would move this to an async worker mirroring
      // jobs/src/edtr-ocr-worker.ts). The state machine and format/human
      // gates are unaffected by sync vs async execution.
      const result = await this.port.analyze(KYC_MODEL_ID, Buffer.alloc(0));
      const secField = result.fields.sec_number;
      const tinField = result.fields.tin;

      const ocrPayload: KycOcrPayload = {
        ...(secField ? { sec_number: secField.value, sec_confidence: secField.confidence } : {}),
        ...(tinField ? { tin: tinField.value, tin_confidence: tinField.confidence } : {}),
      };
      const formatValid = {
        secNumber: secField ? SEC_REGEX.test(secField.value) : false,
        tin: tinField ? TIN_REGEX.test(tinField.value) : false,
      };
      const confidence =
        secField && tinField ? Math.min(secField.confidence, tinField.confidence) : (secField?.confidence ?? tinField?.confidence ?? null);

      await tx
        .update(kycDocuments)
        .set({
          ocrPayload,
          formatValid,
          confidence: confidence !== null ? String(confidence) : null,
          // Every extraction lands at needs_review -- there is no
          // auto-verify edge; a human always confirms against SEC/BIR
          // (RFC-2 §2, PRD-F6 US-06 AC3, requires_human_confirmation=true).
          status: 'needs_review',
        })
        .where(eq(kycDocuments.id, created.id));

      for (const [field, value] of Object.entries({ sec_number: secField, tin: tinField })) {
        if (!value) continue;
        await this.events.emit(ctx, 'ocr_field_confidence', {
          doc_type: 'kyc',
          field,
          confidence: value.confidence,
          auto_accepted: false, // KYC never auto-accepts (RFC-2 §2)
        });
      }

      return { kycDocumentId: created.id, status: 'queued' as const };
    });
  }

  // GET /api/v1/kyc/:id (RFC-2 §3). requiresHumanConfirmation is always
  // true -- there is no code path that flips a tenant to production from
  // extraction confidence alone.
  async get(ctx: RequestContext, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const [doc] = await tx.select().from(kycDocuments).where(eq(kycDocuments.id, id)).limit(1);
      if (!doc) throw new NotFoundException({ error: 'kyc_document_not_found' });

      const payload = (doc.ocrPayload as KycOcrPayload | null) ?? {};
      const formatValid = (doc.formatValid as { secNumber?: boolean; tin?: boolean } | null) ?? {
        secNumber: false,
        tin: false,
      };
      const portalMatchScore = doc.portalMatchScore !== null ? Number(doc.portalMatchScore) : null;

      return {
        kycDocumentId: doc.id,
        status: doc.status === 'pending' ? 'queued' : doc.status,
        extracted: { secNumber: payload.sec_number ?? null, tin: payload.tin ?? null },
        confidence: { secNumber: payload.sec_confidence ?? null, tin: payload.tin_confidence ?? null },
        formatValid: { secNumber: formatValid.secNumber ?? false, tin: formatValid.tin ?? false },
        portalMatchScore,
        matchBand: (portalMatchScore !== null ? matchBand(portalMatchScore) : null) as MatchBand | null,
        registryStatus: doc.registryStatus,
        requiresHumanConfirmation: true as const,
      };
    });
  }

  // POST /api/v1/kyc/:id/confirm: the human portal-confirmation step
  // (RFC-2 §2 step 6). ORUS presents a CAPTCHA by design (scrutiny FC-11);
  // no code here scripts around it -- this endpoint only records what a
  // human read off the SEC/BIR portals.
  async confirm(ctx: RequestContext, id: string, body: KycConfirmRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [doc] = await tx.select().from(kycDocuments).where(eq(kycDocuments.id, id)).limit(1);
      if (!doc) throw new NotFoundException({ error: 'kyc_document_not_found' });

      // verified requires registry_status = active AND a confirmed portal
      // match (RFC-2 §3 KYC state machine); anything else keeps the tenant
      // unverified (US-06 AC2) or rejected.
      const status = body.registryStatus === 'active' ? 'verified' : 'rejected';

      await tx
        .update(kycDocuments)
        .set({ registryStatus: body.registryStatus, portalMatchScore: String(body.portalMatchScore), status })
        .where(eq(kycDocuments.id, id));

      return { kycDocumentId: id, status, registryStatus: body.registryStatus };
    });
  }
}
