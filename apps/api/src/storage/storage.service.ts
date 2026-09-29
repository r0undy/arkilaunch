import { Injectable, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

// SUPABASE_SERVICE_ROLE_KEY is a Storage credential, not the banned BYPASSRLS DB connection; isolation here is
// the tenant-prefixed object key (from the verified JWT) plus the DB row that references it.
@Injectable()
export class StorageService {
  private readonly baseUrl = requireEnv('SUPABASE_URL').replace(/\/$/, '');
  private readonly serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  // tenantId MUST be the verified ctx.tenantId, never request input; reads re-derive it from the owning row.
  buildObjectKey(tenantId: string, extension: string): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${tenantId}/${yyyy}/${mm}/${randomUUID()}.${extension}`;
  }

  async uploadObject(bucket: string, key: string, buffer: Buffer, contentType: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${bucket}/${key}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.serviceRoleKey}`,
        apikey: this.serviceRoleKey,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
      body: buffer,
    });
    if (!res.ok) {
      // Supabase's message is the only clue to a misconfigured bucket or key.
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new InternalServerErrorException({ error: 'storage_upload_failed', status: res.status, detail });
    }
  }

  // Short-TTL signed URL: never a public URL.
  async createSignedDownloadUrl(bucket: string, key: string, expiresInSeconds = 300): Promise<string> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/sign/${bucket}/${key}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.serviceRoleKey}`,
        apikey: this.serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (!res.ok) {
      throw new InternalServerErrorException({ error: 'storage_sign_failed', status: res.status });
    }
    const payload = (await res.json()) as { signedURL: string };
    return `${this.baseUrl}/storage/v1${payload.signedURL}`;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// KYC documents and avatars share the RA 10173 bucket; equipment and branding images are public.
export const kycBucket = () => process.env.SUPABASE_STORAGE_BUCKET_KYC ?? 'kyc-documents';
export const equipmentBucket = () => process.env.SUPABASE_STORAGE_BUCKET_EQUIPMENT ?? 'equipment-photos';

// No default: a missing EDTR bucket is operator misconfiguration, answered as a 503 that names the setting.
export function edtrBucket(): string {
  const name = 'SUPABASE_STORAGE_BUCKET_EDTR';
  const value = process.env[name];
  if (!value) {
    throw new ServiceUnavailableException({
      error: 'storage_not_configured',
      missing: name,
      detail: 'Document storage is not configured in this environment, so the scan was not saved.',
    });
  }
  return value;
}
