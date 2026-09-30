// Self-signed dev cert so a phone on the LAN gets a secure context (getUserMedia needs one).
// Every LAN address goes in the SAN list: browsers ignore CN.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { URL, fileURLToPath } from 'node:url';

const certDir = fileURLToPath(new URL('../apps/web/certs/', import.meta.url));
const keyPath = `${certDir}dev-key.pem`;
const certPath = `${certDir}dev-cert.pem`;

const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);

// Browsers reject a *.localhost wildcard, so each tenant host is listed (DEV_CERT_TENANTS=a,b).
const tenants = ['almara', 'test-tenant-a', 'test-tenant-b', ...(process.env.DEV_CERT_TENANTS?.split(',') ?? [])];
const sans = [
  'DNS:localhost',
  ...tenants.filter(Boolean).map((t) => `DNS:${t.trim()}.localhost`),
  'IP:127.0.0.1',
  ...addresses.map((a) => `IP:${a}`),
];

mkdirSync(certDir, { recursive: true });

// -nodes: unencrypted so Vite reads it unattended; throwaway and gitignored.
try {
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
      '-keyout', keyPath,
      '-out', certPath,
      '-subj', '/CN=arkilaunch-dev',
      '-addext', `subjectAltName=${sans.join(',')}`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
} catch (err) {
  console.error('Could not run openssl. It ships with Git for Windows (Git Bash) and with macOS.');
  console.error(String(err.stderr ?? err.message).trim());
  process.exit(1);
}

if (!existsSync(keyPath) || !existsSync(certPath)) {
  console.error('openssl reported success but wrote no certificate.');
  process.exit(1);
}

writeFileSync(`${certDir}README.txt`, `Dev certificate for: ${sans.join(', ')}\n`);

console.log('Wrote apps/web/certs/dev-{key,cert}.pem, valid for:');
for (const san of sans) console.log(`  ${san}`);
console.log('\nRun `pnpm dev` and open one of these over https from the phone.');
console.log('The certificate is self-signed, so accept the browser warning once');
console.log('(Advanced -> Proceed). That still counts as a secure context, which');
console.log('is what the camera needs.');
