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
