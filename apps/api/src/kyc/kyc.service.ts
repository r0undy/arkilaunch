import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { kycDocuments, withTenantTx } from '@arkilaunch/db';
import {
  SEC_REGEX,
  TIN_REGEX,
  matchBand,
  ExtractionUnavailableError,
  type DocumentExtractionResult,
  type DocumentIntelligencePort,
  type KycConfirmRequest,
  type KycDetailResponse,
  type KycExtractRequest,
  type KycExtractResponse,
  type MatchBand,
  type RequestContext,
} from '@arkilaunch/shared';
import { KYC_MODEL_ID } from '@arkilaunch/document-intelligence';
import { EventsService } from '../events/events.service.js';
import { StorageService, kycBucket } from '../storage/storage.service.js';
import { DOCUMENT_INTELLIGENCE_PORT } from './kyc.tokens.js';

interface KycOcrPayload {
  sec_number?: string;
  tin?: string;
  sec_confidence?: number;
  tin_confidence?: number;
}


@Injectable()
export class KycService {
  // Token-injected: an interface has no runtime type for Nest's reflection.
  constructor(
    private readonly events: EventsService,
    private readonly storage: StorageService,
    @Inject(DOCUMENT_INTELLIGENCE_PORT) private readonly port: DocumentIntelligencePort,
  ) {}

  async extract(ctx: RequestContext, body: KycExtractRequest): Promise<KycExtractResponse> {
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

      // The port throws rather than return an empty result, which would be indistinguishable from a blank document;
      // the document still queues for a human, and nothing is invented.
      let result: DocumentExtractionResult | null = null;
      try {
        const signedUrl = await this.storage.createSignedDownloadUrl(
          kycBucket(),
          body.fileUri,
        );
        const res = await fetch(signedUrl);
        if (!res.ok) throw new Error(`kyc_storage_download_failed:${res.status}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        result = await this.port.analyze(KYC_MODEL_ID, bytes);
      } catch (error) {
        if (!(error instanceof ExtractionUnavailableError)) throw error;
        await this.events.emit(ctx, 'ocr_extraction_unavailable', {
          doc_type: 'kyc',
          reason: error.reason,
        });
      }

      const secField = result?.fields.sec_number;
      const tinField = result?.fields.tin;

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
          // null, not {}: an empty payload would falsely read as "the model found nothing".
          ocrPayload: result ? ocrPayload : null,
          formatValid,
          confidence: confidence !== null ? String(confidence) : null,
          // RFC-2 gate: every extraction lands at needs_review; there is no auto-verify edge.
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

  // requiresHumanConfirmation is always true: confidence alone never flips a tenant to production.
  async get(ctx: RequestContext, id: string): Promise<KycDetailResponse> {
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

  // Records only what a human read off the SEC/BIR portals; nothing scripts around the portal CAPTCHA.
  async confirm(ctx: RequestContext, id: string, body: KycConfirmRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [doc] = await tx.select().from(kycDocuments).where(eq(kycDocuments.id, id)).limit(1);
      if (!doc) throw new NotFoundException({ error: 'kyc_document_not_found' });

      // Verified only when the human reports registry_status = active; portalMatchScore is recorded, not gated on.
      const status = body.registryStatus === 'active' ? 'verified' : 'rejected';

      await tx
        .update(kycDocuments)
        .set({ registryStatus: body.registryStatus, portalMatchScore: String(body.portalMatchScore), status })
        .where(eq(kycDocuments.id, id));

      return { kycDocumentId: id, status, registryStatus: body.registryStatus };
    });
  }
}
