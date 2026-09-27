import type { CatalogTenant } from '@arkilaunch/shared';

// A tenant's brand, as pure functions of its catalog row. No DOM and no
// Vite here: the SPA (lib/tenant.ts) and the edge Worker (worker/index.ts)
// both import this, so a page is painted the same way before and after
// hydration (CR: tenant-brand-kit).

// WCAG relative luminance of a #rrggbb color.
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

// Text color on a tenant color: black or white, whichever contrasts more
// (DSD §2.1 tenant override). Black is --steel-900's family.
export function onPrimaryFor(hex: string): '#000000' | '#ffffff' {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}

// DSD §2.3 tenant font. Prose and display only: mono keeps every number
// (Rule 2), so --font-mono is never swapped.
const INTER_STACK = "'Inter', Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif";

export type TenantBrand = Pick<CatalogTenant, 'primaryColor' | 'font'>;

// Every custom property brandVars() can set, so a changed brand can clear
// the ones it no longer uses.
export const BRAND_VARS = [
  '--yb-color-primary',
  '--yb-color-primary-hover',
  '--yb-color-on-primary',
  '--font-sans',
  '--font-display',
] as const;

// The properties a tenant's brand sets on <html>, over index.css's --yb-*
// theme tokens and the @theme fonts. Empty for the ArkiLaunch defaults.
export function brandVars(t: TenantBrand | null | undefined): Partial<Record<(typeof BRAND_VARS)[number], string>> {
  const vars: Partial<Record<(typeof BRAND_VARS)[number], string>> = {};
  if (t?.primaryColor) {
    vars['--yb-color-primary'] = t.primaryColor;
    vars['--yb-color-primary-hover'] = `color-mix(in srgb, ${t.primaryColor} 85%, black)`;
    vars['--yb-color-on-primary'] = onPrimaryFor(t.primaryColor);
  }
  if (t?.font === 'inter') {
    vars['--font-sans'] = INTER_STACK;
    vars['--font-display'] = INTER_STACK;
  }
  return vars;
}

// Titles follow each page's own heading.
const PAGE_TITLES: Record<string, string> = {
  '/equipment': 'Equipment for hire',
  '/contact': 'Contact',
  '/help': 'Help center',
  '/terms': 'Terms of service',
  '/privacy': 'Privacy policy',
};

// Document title for a path on a tenant's host. An equipment page is titled
// with its model (`detail`); without one this returns null, so the caller
// leaves the title to that page rather than overwriting it.
export function pageTitle(pathname: string, name: string, detail?: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (/^\/equipment\/[^/]+$/.test(path)) return detail ? `${detail} | ${name}` : null;
  const page = PAGE_TITLES[path];
  return page ? `${page} | ${name}` : name;
}

// Public storefront pages: the only paths a crawler is asked to index. The
// account, staff and sign-in routes keep the shell's noindex.
const INDEXABLE = ['/', '/equipment', '/contact', '/help', '/terms', '/privacy'];

export function isIndexable(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return INDEXABLE.includes(path) || /^\/equipment\/[^/]+$/.test(path);
}

// Tenant-written strings go into attributes and a <script>: escape both.
function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// A detail page's own facts, when the edge could fetch them.
export interface PageDetail {
  title: string;
  description: string;
  imageUrl: string | null;
}

// The <head> tags a tenant's page gets at the edge (CR: tenant-brand-kit):
// description, canonical, Open Graph/Twitter, favicon, theme color, and the
// Organization JSON-LD on the home page. Only the tenant's own row feeds it.
export function headTags(t: CatalogTenant, url: URL, detail?: PageDetail | null): string {
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
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

// The shared robots.txt, with its Sitemap line pointed at this host.
export function robotsFor(robots: string, origin: string): string {
  return robots.replace(/^Sitemap:.*$/m, `Sitemap: ${origin}/sitemap.xml`);
}

// Public pages plus each listed equipment page.
export function sitemapXml(origin: string, equipmentIds: string[]): string {
  const paths = [...INDEXABLE, ...equipmentIds.map((id) => `/equipment/${encodeURIComponent(id)}`)];
  const urls = paths.map((p) => `  <url><loc>${attr(`${origin}${p}`)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}