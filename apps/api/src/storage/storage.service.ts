import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

// Calls the Supabase Storage REST API directly with native fetch rather
// than adding @supabase/supabase-js -- only upload/sign/download are
// needed here (AGENTS.md §5 restraint ladder; same "native fetch over a
// client SDK" precedent as apps/web's own transport layer).
//
// Server-side auth uses SUPABASE_SERVICE_ROLE_KEY. This is NOT the
// service_role Postgres connection AGENTS.md bans on a request path --
// that ban is specifically about a BYPASSRLS *database connection*
// defeating RLS (build-arkilaunch.md §3, RFC-1). The Storage API key is a
// credential on a different service entirely; tenant isolation here is
// enforced by the object key (tenant-prefixed, derived from the verified
// JWT, never from client input) plus the DB row that references it, not by
// Postgres RLS. See the Change Record for this workstream.
@Injectable()
export class StorageService {
  private readonly baseUrl = requireEnv('SUPABASE_URL').replace(/\/$/, '');
  private readonly serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  // {tenantId}/{yyyy}/{mm}/{uuid}.{ext}. tenantId MUST come from the
  // caller's verified ctx.tenantId, never from request input -- every read
  // path re-derives the same prefix from the owning row's own tenant_id, so
  // a client-supplied key can never address another tenant's object.
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
      throw new InternalServerErrorException({ error: 'storage_upload_failed', status: res.status });
    }
  }

  // Short-TTL, single-purpose signed download URL (RFC-2 §6: "never a
  // public URL"). Used by the Evidence Split View and, once the Azure DI
  // adapter is wired to read real bytes, by jobs/src/edtr-ocr-worker.ts.
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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
