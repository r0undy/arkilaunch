// Public URL of an object in the public equipment-photos bucket (equipment
// photos, tenant logo/hero). No SUPABASE_URL configured (unit tests, local
// runs without storage) is not an error: there is simply nothing to render.
export function publicPhotoUrl(key: string | null): string | null {
  if (!key) return null;
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const bucket = process.env.SUPABASE_STORAGE_BUCKET_EQUIPMENT ?? 'equipment-photos';
  if (!base) return null;
  return `${base}/storage/v1/object/public/${bucket}/${key}`;
}
