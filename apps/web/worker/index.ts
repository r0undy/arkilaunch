import type { CatalogEquipment, CatalogTenant } from '@arkilaunch/shared';
import { brandVars, headTags, isIndexable, pageTitle, robotsFor, sitemapXml, type PageDetail } from '../src/lib/brand.js';

// Edge head for tenant storefronts (CR: tenant-brand-kit). The SPA shell is
// one file for every host, so a crawler or a Facebook link preview reading
// the HTML saw "ArkiLaunch" and noindex on every tenant. On a tenant host
// this writes that tenant's own title, description, Open Graph, favicon,
// JSON-LD and first-paint colors into the shell, and serves its robots.txt
// and sitemap. Anything that fails falls back to the untouched shell.

interface Env {
  ASSETS: Fetcher;
  API_BASE_URL: string;
  PLATFORM_DOMAIN: string;
}

const TIMEOUT_MS = 1500;
const CACHE_SECONDS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same label rule as the API's slug check; anything else is not a tenant.
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function tenantSlug(hostname: string, platformDomain: string): string | null {
  for (const root of ['localhost', platformDomain]) {
    if (!hostname.endsWith(`.${root}`)) continue;
    const label = hostname.slice(0, -root.length - 1);
    return SLUG.test(label) ? label : null;
  }
  return null;
}

// One catalog read, cached per tenant. The key carries the slug, so one
// tenant's branding can never be served for another.
async function catalog<T>(env: Env, ctx: ExecutionContext, slug: string, path: string): Promise<T | null> {
  const key = new Request(`https://edge-cache.invalid/${slug}${path}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return (await hit.json()) as T;
  try {
    const res = await fetch(`${env.API_BASE_URL}${path}`, {
      headers: { 'X-Tenant-Slug': slug, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.text();
    ctx.waitUntil(
      cache.put(key, new Response(body, { headers: { 'Cache-Control': `max-age=${CACHE_SECONDS}`, 'Content-Type': 'application/json' } })),
    );
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function equipmentDetail(eq: CatalogEquipment, tenant: CatalogTenant): PageDetail {
  return {
    title: eq.model,
    description: `${eq.model} (${eq.equipmentTypeName}) for rent from ${tenant.name}.`,
    imageUrl: eq.photoUri ?? null,
  };
}

async function tenantPage(request: Request, env: Env, ctx: ExecutionContext, slug: string): Promise<Response> {
  const url = new URL(request.url);
  const shell = () => env.ASSETS.fetch(new Request(new URL('/', url), request));
  const tenant = await catalog<CatalogTenant>(env, ctx, slug, '/catalog/tenant');
  if (!tenant) return shell();

  const id = /^\/equipment\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  const eq = id && UUID.test(id) ? await catalog<CatalogEquipment>(env, ctx, slug, `/catalog/equipment/${id}`) : null;
  const detail = eq ? equipmentDetail(eq, tenant) : null;
  const style = Object.entries(brandVars(tenant))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

  let rewriter = new HTMLRewriter()
    .on('title', { element: (e) => void e.setInnerContent(pageTitle(url.pathname, tenant.name, detail?.title) ?? tenant.name) })
    .on('head', { element: (e) => void e.append(headTags(tenant, url, detail), { html: true }) });
  if (style) rewriter = rewriter.on('html', { element: (e) => void e.setAttribute('style', style) });
  if (isIndexable(url.pathname)) {
    rewriter = rewriter.on('meta[name="robots"]', { element: (e) => void e.setAttribute('content', 'index, follow') });
  }
  if (tenant.font === 'inter') {
    rewriter = rewriter.on('link[rel="preload"][href="/fonts/ibm-plex-sans-variable.woff2"]', {
      element: (e) => void e.setAttribute('href', '/fonts/inter-variable-latin.woff2'),
    });
  }
  return rewriter.transform(await shell());
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const slug = tenantSlug(url.hostname, env.PLATFORM_DOMAIN);
    if (!slug) return env.ASSETS.fetch(request);

    if (url.pathname === '/robots.txt') {
      const res = await env.ASSETS.fetch(request);
      return new Response(robotsFor(await res.text(), url.origin), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (url.pathname === '/sitemap.xml') {
      // ponytail: first 100 units (the API's page cap); page through if a tenant lists more.
      const list = await catalog<{ items: { id: string }[] }>(env, ctx, slug, '/catalog/equipment?limit=100');
      if (!(await catalog<CatalogTenant>(env, ctx, slug, '/catalog/tenant'))) return env.ASSETS.fetch(request);
      return new Response(sitemapXml(url.origin, list?.items.map((i) => i.id) ?? []), {
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      });
    }
    if (url.pathname === '/favicon.ico') {
      const tenant = await catalog<CatalogTenant>(env, ctx, slug, '/catalog/tenant');
      const icon = tenant?.iconUrl ?? tenant?.logoUrl;
      return icon ? Response.redirect(icon, 302) : env.ASSETS.fetch(request);
    }
    // A file (has an extension) is served as is; every other path is a page.
    if (/\.[a-z0-9]+$/i.test(url.pathname)) return env.ASSETS.fetch(request);
    return tenantPage(request, env, ctx, slug);
  },
} satisfies ExportedHandler<Env>;
