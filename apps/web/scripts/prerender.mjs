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

// Public site origin for canonical/OG URLs -- defaults to local dev; set to
// the deployed Vercel domain in CI (see apps/web/.env.example).
const SITE_URL = (process.env.VITE_PUBLIC_SITE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const API_BASE_URL = process.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

const STATIC_ROUTES = [
  { route: '/', title: 'Almara | Industrial Fleet Management & Rentals' },
  { route: '/equipment', title: 'Equipments | Almara' },
  { route: '/contact', title: 'Contact | Almara' },
  { route: '/help', title: 'Help Center | Almara' },
  { route: '/terms', title: 'Terms of Service | Almara' },
  { route: '/privacy', title: 'Privacy Policy | Almara' },
];

// Per-equipment detail routes are fetched from the live, @Public,
// anchor-tenant-only catalog endpoint rather than hardcoded -- a hardcoded
// fixture list (eq-1..eq-6) would drift from the real catalog rows and
// prerender wrong ids/titles. If the fetch fails, equipment detail routes
// are skipped rather than emitting incorrect pages.
async function fetchEquipmentRoutes() {
  try {
    const res = await fetch(`${API_BASE_URL}/catalog/equipment`);
    if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
    const body = await res.json();
    const items = Array.isArray(body) ? body : body.items ?? [];
    return items.map((item) => ({
      route: `/equipment/${item.id}`,
      title: `${item.equipmentTypeName ?? item.model} | Almara`,
    }));
  } catch (err) {
    console.warn(`prerender: skipping equipment detail routes -- ${err.message}`);
    return [];
  }
}

const ORG_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Almara Construction',
  url: SITE_URL,
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
  const canonical = `${SITE_URL}${route === '/' ? '' : route}`;
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

  const equipmentRoutes = await fetchEquipmentRoutes();
  const PUBLIC_ROUTES = [...STATIC_ROUTES, ...equipmentRoutes];

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
