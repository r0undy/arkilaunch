import { createRoute } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import type { KycDetailResponse, KycExtractResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiGet, apiPost, apiPostForm, apiErrorText } from '../lib/api-client.js';
import { getCustomers, type CustomerRef } from '../lib/reference-client.js';
import { Button } from '../components/button.js';
import { CaptureField } from '../components/capture-field.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Surface } from '../components/surface.js';
import { PageHeader } from '../components/page-header.js';
import { Modal } from '../components/modal.js';
import { ConfidenceChip } from '../components/confidence-chip.js';
import { useToast } from '../components/toast.js';

// Exercises the real flow: POST /kyc/extract (multipart, RFC-2 §6 -- the API
// validates and uploads to Supabase Storage before this call returns),
// GET /kyc/:id, and POST /kyc/:id/confirm (RFC-2). Confirm requires
// platform_admin (kyc:verify); expect a 403 when signed in as the tenant
// admin seed user. Customer comes from GET /reference/customers rather than
// a hand-typed UUID.
function KycPage() {
  const toast = useToast();
  const [customers, setCustomers] = useState<CustomerRef[]>([]);
  const [refFailed, setRefFailed] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [documentType, setDocumentType] = useState('sec_certificate');

  useEffect(() => {
    getCustomers()
      .then((c) => {
        setCustomers(c);
        if (c[0]) setCustomerId(c[0].id);
      })
      .catch(() => setRefFailed(true));
  }, []);

  const [scanFile, setScanFile] = useState<File | null>(null);

  const [registryStatus, setRegistryStatus] = useState<'active' | 'suspended' | 'revoked'>(
    'active',
  );
  const [portalMatchScore, setPortalMatchScore] = useState('0.95');

  const [kycDocumentId, setKycDocumentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KycDetailResponse | null>(null);
  // What was extracted, and the registry answer that clears it, used to live
  // on the page under two `JSON.stringify` dumps -- so the operator confirmed
  // an identity against output they had to read as raw JSON. The extraction
  // now opens over the page with Confirm in its own footer: this is the gate
  // a human is supposed to be looking at (RFC-2).
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState<'extract' | 'poll' | 'confirm' | null>(null);

  // Posts multipart/form-data -- the API validates (content-type
  // allowlist, magic-byte sniff, decompression-bomb guard) and uploads to
  // Supabase Storage before this call returns (RFC-2 §6).
  async function extract(event: FormEvent) {
    event.preventDefault();
    setDetail(null);
    setBusy('extract');
    try {
      const res = await apiPostForm<KycExtractResponse>(
        '/kyc/extract',
        { customerId, documentType },
        scanFile ?? undefined,
      );
      setKycDocumentId(res.kycDocumentId);
      // Extraction runs synchronously (kyc.service.ts has no async worker,
      // unlike EDTR's paper_ocr) -- a single GET right after extract already
      // reflects the final extracted values, so no polling loop is needed.
      const detailRes = await apiGet<KycDetailResponse>(`/kyc/${res.kycDocumentId}`);
      setDetail(detailRes);
      setReviewOpen(true);
      toast.success('Document extracted', 'Check the fields before confirming.');
    } catch (err) {
      toast.error('Could not extract that document', apiErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function poll() {
    if (!kycDocumentId) return;
    setBusy('poll');
    try {
      const res = await apiGet<KycDetailResponse>(`/kyc/${kycDocumentId}`);
      setDetail(res);
      setReviewOpen(true);
    } catch (err) {
      toast.error('Could not read that document', apiErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!kycDocumentId) return;
    setBusy('confirm');
    try {
      await apiPost(`/kyc/${kycDocumentId}/confirm`, {
        registryStatus,
        portalMatchScore: Number(portalMatchScore),
      });
      const res = await apiGet<KycDetailResponse>(`/kyc/${kycDocumentId}`);
      setDetail(res);
      setReviewOpen(false);
      toast.success('Verification recorded', `Registry status: ${registryStatus}.`);
    } catch (err) {
      toast.error('Could not confirm that document', apiErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  const hasExtraction =
    detail != null && (detail.confidence.secNumber !== null || detail.confidence.tin !== null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Registration"
        title="Business verification"
        description="Read a corporate document, then confirm it against the official registry."
      />
      {refFailed && (
        <p className="text-error" role="alert">
          Your customer list could not be loaded, so a document cannot be checked right now.
        </p>
      )}
      <Surface radius="md" elevation="sm" className="max-w-2xl p-6">
        <form onSubmit={extract} className="flex flex-col gap-4">
          <Select
            id="customerId"
            label="Customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            required
          >
            {customers.length === 0 && <option value="">No customers on file yet</option>}
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.companyName}
              </option>
            ))}
          </Select>
          <Input
            id="documentType"
            label="Document type"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            required
          />
          <CaptureField
            id="scanFile"
            label="Scan / upload the corporate document"
            accept="image/*,application/pdf"
            value={scanFile}
            onChange={setScanFile}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!scanFile || !customerId} loading={busy === 'extract'}>
              Extract
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={poll}
              disabled={!kycDocumentId}
              loading={busy === 'poll'}
            >
              Re-read status
            </Button>
          </div>
        </form>
      </Surface>

      {hasExtraction && !reviewOpen && (
        <Surface radius="md" elevation="sm" className="flex max-w-2xl flex-col gap-3 p-4">
          <p className="text-sm text-text-muted">
            A document has been read for this customer but not yet confirmed.
          </p>
          <div>
            <Button type="button" variant="secondary" onClick={() => setReviewOpen(true)}>
              Review extraction
            </Button>
          </div>
        </Surface>
      )}

      <Modal
        open={reviewOpen && hasExtraction}
        onClose={() => setReviewOpen(false)}
        title="Confirm this document"
        description="Check what was read off the scan, then record what the official registry says."
        size="lg"
        // A verification decision should not be dismissed by a stray click on
        // the scrim.
        dismissOnScrim={false}
      >
        <form id="kyc-confirm" onSubmit={confirm} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h3 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">
              Read off the scan
            </h3>
            <div className="flex flex-wrap gap-2">
              {detail && detail.confidence.secNumber !== null && (
                <ConfidenceChip
                  tone={detail.formatValid.secNumber ? 'match' : 'review'}
                  confidence={detail.confidence.secNumber}
                  fieldLabel={`SEC: ${detail.extracted.secNumber ?? ''}`}
                />
              )}
              {detail && detail.confidence.tin !== null && (
                <ConfidenceChip
                  tone={detail.formatValid.tin ? 'match' : 'review'}
                  confidence={detail.confidence.tin}
                  fieldLabel={`TIN: ${detail.extracted.tin ?? ''}`}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-border pt-5">
            <h3 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">
              What the registry says
            </h3>
            <Select
              id="registryStatus"
              label="Registry status"
              value={registryStatus}
              onChange={(e) => setRegistryStatus(e.target.value as typeof registryStatus)}
            >
              <option value="active">active</option>
              <option value="suspended">suspended</option>
              <option value="revoked">revoked</option>
            </Select>
            <Input
              numeric
              id="portalMatchScore"
              label="Portal match score (0-1)"
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={portalMatchScore}
              onChange={(e) => setPortalMatchScore(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
            <Button type="button" variant="secondary" onClick={() => setReviewOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="approve"
              disabled={!kycDocumentId}
              loading={busy === 'confirm'}
            >
              Confirm
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// Route path is /app/registration (the Figma "Registration" screens); the
// file/component name stays kyc for continuity with RFC-2 and its tests.
// Admin-only: owner and timekeeper are denied /app/kyc-equivalent per the
// PRD §5.2 auth boundary.
export const kycRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/registration',
  beforeLoad: requireRole('admin', 'platform_admin'),
  component: KycPage,
});
