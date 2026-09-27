import { queryOptions, useQuery } from '@tanstack/react-query';
import type { CatalogTenant } from '@arkilaunch/shared';
import { apiGet } from './api-client.js';
import { BRAND_VARS, brandVars, onPrimaryFor } from './brand.js';
import { tenantSlug } from './host.js';

// The host tenant's public branding (GET /catalog/tenant). Fetched once per
// page load; a 404 means the subdomain is not an active rental company,
// which __root.tsx turns into the "not found" page.
export const tenantQuery = () =>
  queryOptions({
    queryKey: ['catalog', 'tenant'] as const,
    queryFn: () => apiGet<CatalogTenant>('/catalog/tenant'),
    staleTime: Infinity,
    enabled: tenantSlug() !== null,
  });

export function useTenant(): CatalogTenant | undefined {
  return useQuery(tenantQuery()).data;
}

// '' while loading (and on the platform host), so a brand slot renders
// empty for a beat rather than flashing another company's name.
export function useTenantName(): string {
  return useTenant()?.name ?? '';
}

// The top-bar paint for a tenant that set a header color (DSD §2.1): the
// color and the black or white text on it. Null keeps the bar's own look.
export function useHeaderColor(): { backgroundColor: string; color: string } | null {
  const hex = useTenant()?.headerColor;
  return hex ? { backgroundColor: hex, color: onPrimaryFor(hex) } : null;
}

// Upserts one <head> tag's attribute, or removes the tag for no value.
function setHeadTag(selector: string, create: () => HTMLElement, attr: string, value: string | null | undefined) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!value) {
    el?.remove();
    return;
  }
  if (!el) {
    el = create();
    document.head.append(el);
  }
  el.setAttribute(attr, value);
}

// Paint the tenant's brand over the theme tokens (index.css --yb-*, the
// @theme fonts): inline style on <html> wins over both theme rules. Also
// points the favicon and the browser's theme color at the tenant. The edge
// Worker writes the same values into the HTML, so this repaints nothing on
// a deployed host; it keeps local dev and a changed brand in step.
export function applyTenantBrand(t: CatalogTenant): void {
  const style = document.documentElement.style;
  const vars = brandVars(t);
  for (const name of BRAND_VARS) {
    const value = vars[name];
    if (value) style.setProperty(name, value);
    else style.removeProperty(name);
  }
  setHeadTag('link[rel="icon"]', () => Object.assign(document.createElement('link'), { rel: 'icon' }), 'href', t.iconUrl ?? t.logoUrl);
  setHeadTag(
    'meta[name="theme-color"]',
    () => Object.assign(document.createElement('meta'), { name: 'theme-color' }),
    'content',
    t.headerColor ?? t.primaryColor,
  );
}
