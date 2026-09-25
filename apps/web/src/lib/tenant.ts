import { queryOptions, useQuery } from '@tanstack/react-query';
import type { CatalogTenant } from '@arkilaunch/shared';
import { apiGet } from './api-client.js';
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

// WCAG relative luminance of a #rrggbb color.
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

// Text color on a tenant's primary: black or white, whichever contrasts
// more (DSD §2.1 tenant override). Black is --steel-900's family.
export function onPrimaryFor(hex: string): '#000000' | '#ffffff' {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}

// Paint the tenant's primary over the theme tokens (index.css --yb-*).
// Inline style on <html> wins over both the light and dark theme rules.
export function applyTenantPrimary(hex: string | null | undefined): void {
  const style = document.documentElement.style;
  if (!hex) {
    style.removeProperty('--yb-color-primary');
    style.removeProperty('--yb-color-primary-hover');
    style.removeProperty('--yb-color-on-primary');
    return;
  }
  style.setProperty('--yb-color-primary', hex);
  style.setProperty('--yb-color-primary-hover', `color-mix(in srgb, ${hex} 85%, black)`);
  style.setProperty('--yb-color-on-primary', onPrimaryFor(hex));
}
