import { createRoute, redirect } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { rootRoute } from './__root.js';
import { getAccessToken } from '../lib/auth-client.js';
import { apiGet, apiPost } from '../lib/api-client.js';

// POC scaffold only (unstyled): exercises POST /kyc/extract, GET /kyc/:id,
// and POST /kyc/:id/confirm (RFC-2). Confirm requires platform_admin
// (kyc:verify); expect a 403 when signed in as the tenant admin seed user.
function KycPage() {
  const [customerId, setCustomerId] = useState('');
  const [documentType, setDocumentType] = useState('sec_certificate');
  const [fileUri, setFileUri] = useState('storage://fixtures/sample.jpg');

  const [registryStatus, setRegistryStatus] = useState<'active' | 'suspended' | 'revoked'>('active');
  const [portalMatchScore, setPortalMatchScore] = useState('0.95');

  const [kycDocumentId, setKycDocumentId] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);

  async function extract(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const res = await apiPost<{ kycDocumentId: string }>('/kyc/extract', { customerId, documentType, fileUri });
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
      <form onSubmit={extract}>
        <h2>Extract</h2>
        <div>
          <label htmlFor="customerId">Customer ID</label>
          <input id="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="documentType">Document type</label>
          <input id="documentType" value={documentType} onChange={(e) => setDocumentType(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="fileUri">File URI</label>
          <input id="fileUri" value={fileUri} onChange={(e) => setFileUri(e.target.value)} required />
        </div>
        <button type="submit">Extract</button>
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
