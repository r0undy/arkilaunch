const SIGNED_URL_TTL_SECONDS = 300;

export async function fetchStorageObject(bucket: string, key: string): Promise<Buffer> {
  const baseUrl = requireEnv('SUPABASE_URL').replace(/\/$/, '');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const signRes = await fetch(`${baseUrl}/storage/v1/object/sign/${bucket}/${key}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
  });
  if (!signRes.ok) {
    throw new Error(`storage_sign_failed:${signRes.status}`);
  }
  const { signedURL } = (await signRes.json()) as { signedURL: string };

  const objectRes = await fetch(`${baseUrl}/storage/v1${signedURL}`);
  if (!objectRes.ok) {
    throw new Error(`storage_download_failed:${objectRes.status}`);
  }
  return Buffer.from(await objectRes.arrayBuffer());
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
