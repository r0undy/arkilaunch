// Public-read is deliberate: photos and logos are not evidence or KYC data. No SUPABASE_URL = nothing to render.
export function publicPhotoUrl(key: string | null): string | null {
  if (!key) return null;
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const bucket = process.env.SUPABASE_STORAGE_BUCKET_EQUIPMENT ?? 'equipment-photos';
  if (!base) return null;
  return `${base}/storage/v1/object/public/${bucket}/${key}`;
}
