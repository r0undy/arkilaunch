import { ConflictException } from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import { type Tx, projectSites, siteDocuments } from '@arkilaunch/db';
import { hasSiteProof, type SiteDocument } from '@arkilaunch/shared';


// Rejected ones are listed but never count as proof.
export async function siteDocumentsFor(tx: Tx, siteIds: string[]): Promise<Map<string, SiteDocument[]>> {
  const bySite = new Map<string, SiteDocument[]>(siteIds.map((id) => [id, []]));
  if (siteIds.length === 0) return bySite;
  const rows = await tx
    .select()
    .from(siteDocuments)
    .where(inArray(siteDocuments.projectSiteId, siteIds))
    .orderBy(desc(siteDocuments.createdAt));
  for (const row of rows) {
    bySite.get(row.projectSiteId)?.push({ id: row.id, documentType: row.documentType, status: row.status, createdAt: row.createdAt });
  }
  return bySite;
}

export function siteProofComplete(documents: SiteDocument[]): boolean {
  return hasSiteProof(documents.filter((d) => d.status !== 'rejected'));
}

// The yard's own sites (no customer) need none.
export async function requireSiteProof(tx: Tx, projectSiteId: string): Promise<void> {
  const [site] = await tx.select({ customerId: projectSites.customerId }).from(projectSites).where(eq(projectSites.id, projectSiteId)).limit(1);
  if (!site?.customerId) return;
  const docs = (await siteDocumentsFor(tx, [projectSiteId])).get(projectSiteId) ?? [];
  if (!siteProofComplete(docs)) throw new ConflictException({ error: 'site_proof_required', projectSiteId });
}
