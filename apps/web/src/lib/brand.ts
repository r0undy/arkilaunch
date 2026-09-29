import type { CatalogTenant } from '@arkilaunch/shared';

// Pure (no DOM, no Vite): the edge Worker imports this too, so pages paint the same before and after hydration.

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function onPrimaryFor(hex: string): '#000000' | '#ffffff' {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}

// --font-mono is never swapped: numbers stay mono.
const PLEX_STACK = "'IBM Plex Sans', Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif";

export type TenantBrand = Pick<CatalogTenant, 'primaryColor' | 'font'>;

export const BRAND_VARS = [
  '--yb-color-primary',
  '--yb-color-primary-hover',
  '--yb-color-on-primary',
  '--font-sans',
] as const;

export function brandVars(t: TenantBrand | null | undefined): Partial<Record<(typeof BRAND_VARS)[number], string>> {
  const vars: Partial<Record<(typeof BRAND_VARS)[number], string>> = {};
  if (t?.primaryColor) {
    vars['--yb-color-primary'] = t.primaryColor;
    vars['--yb-color-primary-hover'] = `color-mix(in srgb, ${t.primaryColor} 85%, black)`;
    vars['--yb-color-on-primary'] = onPrimaryFor(t.primaryColor);
  }
  if (t?.font === 'plex') vars['--font-sans'] = PLEX_STACK;
  return vars;
}

const PAGE_TITLES: Record<string, string> = {
  '/equipment': 'Equipment for hire',
  '/contact': 'Contact',
  '/help': 'Help center',
  '/terms': 'Terms of service',
  '/privacy': 'Privacy policy',
};

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/$/, '') : path);

export function pageTitle(pathname: string, name: string, detail?: string): string | null {
  const path = trimSlash(pathname);
  if (/^\/equipment\/[^/]+$/.test(path)) return detail ? `${detail} | ${name}` : null;
  const page = PAGE_TITLES[path];
  return page ? `${page} | ${name}` : name;
}

const INDEXABLE = ['/', '/equipment', '/contact', '/help', '/terms', '/privacy'];

export function isIndexable(pathname: string): boolean {
  const path = trimSlash(pathname);
  return INDEXABLE.includes(path) || /^\/equipment\/[^/]+$/.test(path);
}

// Tenant-written strings go into attributes and a <script>: escape both.
function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface PageDetail {
  title: string;
  description: string;
  imageUrl: string | null;
}

// Only the tenant's own row feeds these tags.
export function headTags(t: CatalogTenant, url: URL, detail?: PageDetail | null): string {
  const path = trimSlash(url.pathname);
  const canonical = `${url.origin}${path === '/' ? '/' : path}`;
  const title = pageTitle(path, t.name, detail?.title) ?? t.name;
  const description =
    detail?.description ?? t.tagline ?? t.about?.slice(0, 160) ?? `Heavy equipment rentals from ${t.name}.`;
  const image = detail?.imageUrl ?? t.heroUrl ?? t.iconUrl ?? t.logoUrl;
  const icon = t.iconUrl ?? t.logoUrl;
  const theme = t.headerColor ?? t.primaryColor;
  const meta = (key: 'name' | 'property', name: string, content: string) =>
    `<meta ${key}="${name}" content="${attr(content)}" />`;
  const tags = [
    meta('name', 'description', description),
    `<link rel="canonical" href="${attr(canonical)}" />`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', t.name),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', canonical),
    meta('name', 'twitter:card', t.heroUrl && !detail?.imageUrl ? 'summary_large_image' : 'summary'),
  ];
  if (image) tags.push(meta('property', 'og:image', image));
  if (icon) tags.push(`<link rel="icon" href="${attr(icon)}" />`, `<link rel="apple-touch-icon" href="${attr(icon)}" />`);
  if (theme) tags.push(meta('name', 'theme-color', theme));
  if (path === '/') {
    const org: Record<string, unknown> = { '@context': 'https://schema.org', '@type': 'Organization', name: t.name, url: canonical };
    if (t.logoUrl ?? t.iconUrl) org.logo = t.logoUrl ?? t.iconUrl;
    if (description) org.description = description;
    if (t.phone) org.telephone = t.phone;
    if (t.contactEmail) org.email = t.contactEmail;
    if (t.address || t.city || t.province) {
      org.address = {
        '@type': 'PostalAddress',
        ...(t.address ? { streetAddress: t.address } : {}),
        ...(t.city ? { addressLocality: t.city } : {}),
        ...(t.province ? { addressRegion: t.province } : {}),
        addressCountry: 'PH',
      };
    }
    if (t.facebookUrl) org.sameAs = [t.facebookUrl];
    // `<` escaped so no tenant string can close the script element.
    tags.push(`<script type="application/ld+json">${JSON.stringify(org).replace(/</g, '\\u003c')}</script>`);
  }
  return tags.join('\n    ');
}

export function robotsFor(robots: string, origin: string): string {
  return robots.replace(/^Sitemap:.*$/m, `Sitemap: ${origin}/sitemap.xml`);
}

export function sitemapXml(origin: string, equipmentIds: string[]): string {
  const paths = [...INDEXABLE, ...equipmentIds.map((id) => `/equipment/${encodeURIComponent(id)}`)];
  const urls = paths.map((p) => `  <url><loc>${attr(`${origin}${p}`)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}