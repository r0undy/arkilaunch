import { queryOptions, useQuery } from '@tanstack/react-query';
import type { CatalogTenant } from '@arkilaunch/shared';
import { apiGet } from './api-client.js';
import { BRAND_VARS, brandVars, onPrimaryFor } from './brand.js';
import { tenantSlug } from './host.js';

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

export function useTenantName(): string {
  return useTenant()?.name ?? '';
}

export function useHeaderColor(): { backgroundColor: string; color: string } | null {
  const hex = useTenant()?.headerColor;
  return hex ? { backgroundColor: hex, color: onPrimaryFor(hex) } : null;
}

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

// Inline style on <html> beats both theme rules.
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
