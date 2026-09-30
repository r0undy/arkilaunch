import { eq } from 'drizzle-orm';
import { getTenantTin, publicPhotoUrl, tenants, withTenantTx } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import type { StatementBrand } from '../billing/statement-pdf.js';

// The letterhead every generated PDF prints.
export async function tenantBrand(ctx: RequestContext): Promise<StatementBrand> {
  const [tenant] = await withTenantTx(ctx, (tx) => tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1));
  return {
    name: tenant?.legalName ?? '',
    address: [tenant?.address, tenant?.city, tenant?.province].filter(Boolean).join(', '),
    contact: [tenant?.phone, tenant?.contactEmail].filter(Boolean).join(' | '),
    tin: await getTenantTin(ctx.tenantId).catch(() => null),
    logo: await firstEmbeddable([tenant?.iconKey ?? null, tenant?.logoKey ?? null]),
  };
}

// pdf-lib embeds PNG and JPEG only, so a WebP upload is skipped. A missing or slow image never blocks the PDF.
async function firstEmbeddable(keys: (string | null)[]): Promise<Uint8Array | null> {
  for (const key of keys) {
    const url = publicPhotoUrl(key);
    if (!url) continue;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (isPng(bytes) || isJpeg(bytes)) return bytes;
    } catch {
      // Letterhead falls back to text only.
    }
  }
  return null;
}

export const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
export const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;
