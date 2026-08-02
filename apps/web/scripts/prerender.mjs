// Build-time prerender for public routes only (build-arkilaunch.md §5.2:
// "Public marketing/booking pages are crawlable HTML ... not empty client
// shells"). Uses Playwright, already a devDependency for e2e -- adding zero
// new dependencies for this (AGENTS.md §5 restraint ladder, rung 5).
//
// Authed routes (/app/*, /account/*, /field/*) are never prerendered and
// keep serving dist/index.html as-is, which still carries the default
// noindex meta tag. Only the files this script writes get index,follow.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const port = 4319;
const origin = `http://localhost:${port}`;

const PUBLIC_ROUTES = [
  { route: '/', title: 'Almara | Industrial Fleet Management & Rentals' },
  { route: '/equipment', title: 'Equipments | Almara' },
  { route: '/equipment/eq-1', title: 'Back Hoe (CAT) | Almara' },
  { route: '/equipment/eq-2', title: 'Bulldozer (Mitsubishi) | Almara' },
  { route: '/equipment/eq-3', title: 'Self-Loading Truck (Isuzu) | Almara' },
  { route: '/equipment/eq-4', title: 'Dump Truck (Komatsu) | Almara' },
  { route: '/equipment/eq-5', title: 'Back Hoe (Sumitomo) | Almara' },
  { route: '/equipment/eq-6', title: 'Bulldozer (CAT) | Almara' },
  { route: '/contact', title: 'Contact | Almara' },
  { route: '/help', title: 'Help Center | Almara' },
  { route: '/terms', title: 'Terms of Service | Almara' },
  { route: '/privacy', title: 'Privacy Policy | Almara' },
];

const ORG_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Almara Construction',
  url: 'https://almara.example',
  description: 'Industrial fleet management and heavy-equipment rentals in Quezon City, Philippines.',
};

const SOFTWARE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'ArkiLaunch',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
};

function serveDist() {
  return createServer(async (req, res) => {
    let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = path.join(distDir, urlPath);
    if (urlPath.endsWith('/') || !path.extname(urlPath)) {
      const indexAtDir = path.join(filePath, 'index.html');
      filePath = existsSync(indexAtDir) ? indexAtDir : path.join(distDir, 'index.html');
    }
    try {
      const body = await readFile(filePath);
      res.end(body);
    } catch {
      const fallback = await readFile(path.join(distDir, 'index.html'));
      res.end(fallback);
    }
  }).listen(port);
}

function injectSeoTags(html, { route, title }) {
  const canonical = `https://almara.example${route === '/' ? '' : route}`;
  let out = html
    .replace(/<meta name="robots" content="noindex, nofollow"\s*\/?>/, '<meta name="robots" content="index, follow" />')
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);

  const headExtras = [
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta name="twitter:card" content="summary" />`,
  ];
  if (route === '/') {
    headExtras.push(`<script type="application/ld+json">${JSON.stringify(ORG_JSON_LD)}</script>`);
    headExtras.push(`<script type="application/ld+json">${JSON.stringify(SOFTWARE_JSON_LD)}</script>`);
  }
  return out.replace('</head>', `${headExtras.join('\n    ')}\n  </head>`);
}

async function main() {
  if (!existsSync(distDir)) {
    console.error('dist/ not found. Run `vite build` before `prerender`.');
    process.exit(1);
  }

  const server = serveDist();
  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const entry of PUBLIC_ROUTES) {
    await page.goto(`${origin}${entry.route}`, { waitUntil: 'networkidle' });
    const html = await page.content();
    const finalHtml = injectSeoTags(html, entry);

    const outDir = entry.route === '/' ? distDir : path.join(distDir, entry.route);
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'index.html'), finalHtml, 'utf8');
    console.log(`prerendered ${entry.route}`);
  }

  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
