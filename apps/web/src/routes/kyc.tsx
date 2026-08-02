import { createRoute } from '@tanstack/react-router';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiGet, apiPost } from '../lib/api-client.js';
import { readFileAsDataUrl } from '../lib/file-utils.js';
import { getCustomers, type CustomerRef } from '../lib/reference-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Surface } from '../components/surface.js';

// POC scaffold only (unstyled): exercises POST /kyc/extract (scans a real
// photo/PDF via <input capture>, encoded as a data: URL since no Supabase
// Storage upload exists yet), GET /kyc/:id, and POST /kyc/:id/confirm
// (RFC-2). Confirm requires platform_admin (kyc:verify); expect a 403 when
// signed in as the tenant admin seed user. Customer comes from GET
// /reference/customers rather than a hand-typed UUID.
function KycPage() {
  const [customers, setCustomers] = useState<CustomerRef[]>([]);
  const [refError, setRefError] = useState<unknown>(null);
  const [customerId, setCustomerId] = useState('');
  const [documentType, setDocumentType] = useState('sec_certificate');

  useEffect(() => {
    getCustomers()
      .then((c) => {
        setCustomers(c);
        if (c[0]) setCustomerId(c[0].id);
      })
      .catch(setRefError);
  }, []);

  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [scanDataUrl, setScanDataUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const [registryStatus, setRegistryStatus] = useState<'active' | 'suspended' | 'revoked'>('active');
  const [portalMatchScore, setPortalMatchScore] = useState('0.95');

  const [kycDocumentId, setKycDocumentId] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);

  async function onScanFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setScanDataUrl(dataUrl);
      setScanPreview(file.type.startsWith('image/') ? dataUrl : null);
    } catch (err) {
      setError(err);
    } finally {
      setScanning(false);
    }
  }

  async function extract(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const res = await apiPost<{ kycDocumentId: string }>('/kyc/extract', {
        customerId,
        documentType,
        fileUri: scanDataUrl ?? '',
      });
      setResult(res);
      setKycDocumentId(res.kycDocumentId);
    } catch (err) {
      setError(err);
    }
  }

  async function poll() {
    if (!kycDocumentId) return;
    setError(null);
    try {
      const res = await apiGet(`/kyc/${kycDocumentId}`);
      setResult(res);
    } catch (err) {
      setError(err);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!kycDocumentId) return;
    setError(null);
    try {
      const res = await apiPost(`/kyc/${kycDocumentId}/confirm`, {
        registryStatus,
        portalMatchScore: Number(portalMatchScore),
      });
      setResult(res);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="min-h-screen bg-bg p-6">
      <h1 className="mb-6 font-display text-[28px] font-semibold leading-[1.15] text-text sm:text-[34px]">
        KYC (RFC-2)
      </h1>
      {refError != null && <p className="mb-4 text-error">Could not load customers -- is the API running? See error below.</p>}
      <Surface radius="md" elevation="sm" className="mb-6 max-w-2xl p-6">
        <form onSubmit={extract} className="flex flex-col gap-4">
          <h2 className="font-display text-[22px] font-semibold leading-[1.2] text-text sm:text-[26px]">Extract</h2>
          <Select
            id="customerId"
            label="Customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            required
          >
            {customers.length === 0 && <option value="">(no customers seeded for this tenant)</option>}
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
          <div className="flex flex-col gap-2">
            <label htmlFor="scanFile" className="text-sm font-medium text-text">
              Scan / upload the corporate document
            </label>
            <input
              id="scanFile"
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              onChange={onScanFile}
              className="text-sm text-text-muted file:mr-3 file:min-h-11 file:rounded-sm file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-text"
            />
            {scanning && <p className="text-sm text-text-muted">Reading file…</p>}
            {scanPreview && (
              <div className="flex flex-col gap-1">
                <p className="text-sm text-text-muted">Preview:</p>
                <img
                  src={scanPreview}
                  alt="Scanned document preview"
                  width={240}
                  className="rounded-md border border-border"
                />
              </div>
            )}
          </div>
          <div>
            <Button type="submit" disabled={!scanDataUrl || !customerId}>
              Extract
            </Button>
          </div>
        </form>
      </Surface>

      <div className="mb-6 max-w-2xl">
        <Button type="button" variant="secondary" onClick={poll} disabled={!kycDocumentId}>
          Poll status
        </Button>
      </div>

      <Surface radius="md" elevation="sm" className="mb-6 max-w-2xl p-6">
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <h2 className="font-display text-[22px] font-semibold leading-[1.2] text-text sm:text-[26px]">
            Human portal confirmation (platform_admin only)
          </h2>
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
          <div>
            <Button type="submit" variant="approve" disabled={!kycDocumentId}>
              Confirm
            </Button>
          </div>
        </form>
      </Surface>

      {error != null && (
        <Surface radius="md" elevation="sm" className="mb-6 max-w-2xl border-error p-4">
          <h2 className="mb-2 font-display text-[18px] font-semibold text-error">Error</h2>
          <pre className="overflow-x-auto font-mono text-sm text-text">{JSON.stringify(error, null, 2)}</pre>
        </Surface>
      )}
      {result != null && (
        <Surface radius="md" elevation="sm" className="max-w-2xl p-4">
          <h2 className="mb-2 font-display text-[18px] font-semibold text-text">Result</h2>
          <pre className="overflow-x-auto font-mono text-sm text-text">{JSON.stringify(result, null, 2)}</pre>
        </Surface>
      )}
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
  beforeLoad: () => requireRole('admin', 'platform_admin'),
  component: KycPage,
});
