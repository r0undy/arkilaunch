import { createRoute, redirect } from '@tanstack/react-router';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { rootRoute } from './__root.js';
import { getAccessToken } from '../lib/auth-client.js';
import { apiGet, apiPost } from '../lib/api-client.js';
import { readFileAsDataUrl } from '../lib/file-utils.js';
import { getCustomers, type CustomerRef } from '../lib/reference-client.js';

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
    <div>
      <h1>KYC (RFC-2)</h1>
      {refError != null && <p>Could not load customers -- is the API running? See error below.</p>}
      <form onSubmit={extract}>
        <h2>Extract</h2>
        <div>
          <label htmlFor="customerId">Customer</label>
          <select id="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            {customers.length === 0 && <option value="">(no customers seeded for this tenant)</option>}
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.companyName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="documentType">Document type</label>
          <input id="documentType" value={documentType} onChange={(e) => setDocumentType(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="scanFile">Scan / upload the corporate document</label>
          <input id="scanFile" type="file" accept="image/*,application/pdf" capture="environment" onChange={onScanFile} />
          {scanning && <p>Reading file…</p>}
          {scanPreview && (
            <div>
              <p>Preview:</p>
              <img src={scanPreview} alt="Scanned document preview" width={240} />
            </div>
          )}
        </div>
        <button type="submit" disabled={!scanDataUrl || !customerId}>
          Extract
        </button>
      </form>

      <button type="button" onClick={poll} disabled={!kycDocumentId}>
        Poll status
      </button>

      <form onSubmit={confirm}>
        <h2>Human portal confirmation (platform_admin only)</h2>
        <div>
          <label htmlFor="registryStatus">Registry status</label>
          <select
            id="registryStatus"
            value={registryStatus}
            onChange={(e) => setRegistryStatus(e.target.value as typeof registryStatus)}
          >
            <option value="active">active</option>
            <option value="suspended">suspended</option>
            <option value="revoked">revoked</option>
          </select>
        </div>
        <div>
          <label htmlFor="portalMatchScore">Portal match score (0-1)</label>
          <input
            id="portalMatchScore"
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={portalMatchScore}
            onChange={(e) => setPortalMatchScore(e.target.value)}
          />
        </div>
        <button type="submit" disabled={!kycDocumentId}>
          Confirm
        </button>
      </form>

      {error != null && (
        <div>
          <h2>Error</h2>
          <pre>{JSON.stringify(error, null, 2)}</pre>
        </div>
      )}
      {result != null && (
        <div>
          <h2>Result</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export const kycRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/kyc',
  beforeLoad: () => {
    if (!getAccessToken()) throw redirect({ to: '/login' });
  },
  component: KycPage,
});
