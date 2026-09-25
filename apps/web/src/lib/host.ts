import { isTenantSlug } from '@arkilaunch/shared';

// Which app this hostname serves. The bare platform domain (and plain
// localhost in dev) is ArkiLaunch itself; one label in front of it is a
// tenant: `almara.localhost:5173` in dev, `almara.arkilaunch.tech` in prod.
// Reserved or malformed labels fall back to the platform rather than
// resolving to a tenant that cannot exist.
export type HostKind = { kind: 'platform' } | { kind: 'tenant'; slug: string };

const PLATFORM_DOMAIN = import.meta.env.VITE_PLATFORM_DOMAIN ?? 'arkilaunch.tech';
const ROOT_DOMAINS = ['localhost', PLATFORM_DOMAIN];

export function resolveHost(hostname: string): HostKind {
  const host = hostname.toLowerCase();
  for (const root of ROOT_DOMAINS) {
    if (!host.endsWith(`.${root}`)) continue;
    const label = host.slice(0, -root.length - 1);
    if (!label.includes('.') && isTenantSlug(label)) return { kind: 'tenant', slug: label };
  }
  return { kind: 'platform' };
}

export const currentHost: HostKind = resolveHost(window.location.hostname);

export function tenantSlug(): string | null {
  return currentHost.kind === 'tenant' ? currentHost.slug : null;
}

function rootDomain(hostname: string): string {
  return ROOT_DOMAINS.find((root) => hostname === root || hostname.endsWith(`.${root}`)) ?? hostname;
}

function originFor(hostname: string): string {
  const { protocol, port } = window.location;
  return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
}

export function platformOrigin(): string {
  return originFor(rootDomain(window.location.hostname));
}

export function tenantOrigin(slug: string): string {
  return originFor(`${slug}.${rootDomain(window.location.hostname)}`);
}
