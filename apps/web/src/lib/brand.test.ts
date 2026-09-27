import { describe, expect, it } from 'vitest';
import type { CatalogTenant } from '@arkilaunch/shared';
import { brandVars, headTags, isIndexable, onPrimaryFor, pageTitle, robotsFor, sitemapXml } from './brand.js';

describe('onPrimaryFor', () => {
  it('picks the higher-contrast text color', () => {
    expect(onPrimaryFor('#f2a100')).toBe('#000000'); // amber: dark text (DSD §2.1)
    expect(onPrimaryFor('#1e5f8c')).toBe('#ffffff'); // dispatch blue: white text
    expect(onPrimaryFor('#5ec2c2')).toBe('#000000'); // Almara teal: white would be 2.1:1
    expect(onPrimaryFor('#a23e01')).toBe('#ffffff'); // Almara rust bar
    expect(onPrimaryFor('#ffffff')).toBe('#000000');
    expect(onPrimaryFor('#000000')).toBe('#ffffff');
  });
});

describe('brandVars', () => {
  it('sets nothing for the ArkiLaunch defaults', () => {
    expect(brandVars({ primaryColor: null, font: null })).toEqual({});
    expect(brandVars(undefined)).toEqual({});
  });

  it('paints the primary with its hover and text color', () => {
    expect(brandVars({ primaryColor: '#5ec2c2', font: null })).toEqual({
      '--yb-color-primary': '#5ec2c2',
      '--yb-color-primary-hover': 'color-mix(in srgb, #5ec2c2 85%, black)',
      '--yb-color-on-primary': '#000000',
    });
  });

  it('swaps prose to IBM Plex for a Plex tenant, never mono; Inter is the default', () => {
    const vars = brandVars({ primaryColor: null, font: 'plex' });
    expect(vars['--font-sans']).toMatch(/^'IBM Plex Sans'/);
    expect(Object.keys(vars)).not.toContain('--font-mono');
    expect(brandVars({ primaryColor: null, font: 'inter' })).toEqual({});
  });
});

describe('pageTitle', () => {
  it('titles storefront pages after their heading', () => {
    expect(pageTitle('/', 'Almara Construction')).toBe('Almara Construction');
    expect(pageTitle('/equipment', 'Almara Construction')).toBe('Equipment for hire | Almara Construction');
    expect(pageTitle('/contact/', 'Almara Construction')).toBe('Contact | Almara Construction');
    expect(pageTitle('/app/branding', 'Almara Construction')).toBe('Almara Construction');
  });

  it('leaves an equipment page to title itself with its model', () => {
    expect(pageTitle('/equipment/abc', 'Almara Construction')).toBeNull();
    expect(pageTitle('/equipment/abc', 'Almara Construction', 'CAT D6R')).toBe('CAT D6R | Almara Construction');
  });
});

const almara: CatalogTenant = {
  name: 'Almara Construction',
  logoUrl: 'https://cdn.test/logo.png',
  heroUrl: null,
  iconUrl: 'https://cdn.test/icon.png',
  primaryColor: '#5ec2c2',
  headerColor: '#a23e01',
  font: 'inter',
  facebookUrl: 'https://www.facebook.com/almara',
  tagline: 'Precision industrial equipment for every project.',
  about: null,
  phone: '0917 000 0000',
  contactEmail: null,
  address: null,
  city: 'Pasig',
  province: 'Metro Manila',
};

describe('headTags', () => {
  it('writes the tenant head for its home page', () => {
    const html = headTags(almara, new URL('https://almara.arkilaunch.app/'));
    expect(html).toContain('<meta name="description" content="Precision industrial equipment for every project." />');
    expect(html).toContain('<link rel="canonical" href="https://almara.arkilaunch.app/" />');
    expect(html).toContain('<meta property="og:image" content="https://cdn.test/icon.png" />');
    expect(html).toContain('<link rel="icon" href="https://cdn.test/icon.png" />');
    expect(html).toContain('<meta name="theme-color" content="#a23e01" />');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*)<\/script>/.exec(html)![1]!);
    expect(ld).toMatchObject({ '@type': 'Organization', name: 'Almara Construction', sameAs: ['https://www.facebook.com/almara'] });
    expect(ld.address).toMatchObject({ addressLocality: 'Pasig', addressCountry: 'PH' });
  });

  it('keeps JSON-LD to the home page and uses the detail on an equipment page', () => {
    const html = headTags(almara, new URL('https://almara.arkilaunch.app/equipment/x/'), {
      title: 'CAT D6R',
      description: 'CAT D6R (Bulldozer) for rent from Almara Construction.',
      imageUrl: 'https://cdn.test/d6r.jpg',
    });
    expect(html).not.toContain('ld+json');
    expect(html).toContain('content="CAT D6R | Almara Construction"');
    expect(html).toContain('<link rel="canonical" href="https://almara.arkilaunch.app/equipment/x" />');
    expect(html).toContain('content="https://cdn.test/d6r.jpg"');
  });

  it('cannot be broken out of by a hostile tenant string', () => {
    const evil = { ...almara, name: '"><script>alert(1)</script>', tagline: '</script><img src=x onerror=alert(1)>' };
    const html = headTags(evil, new URL('https://evil.arkilaunch.app/'));
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img');
    // One real script element only, and its body can't close it.
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});

describe('isIndexable', () => {
  it('opens the public storefront pages only', () => {
    for (const p of ['/', '/equipment', '/equipment/abc', '/contact/', '/help', '/terms', '/privacy']) expect(isIndexable(p), p).toBe(true);
    for (const p of ['/login', '/signup', '/app', '/app/branding', '/account/cart', '/field', '/equipment/a/b']) expect(isIndexable(p), p).toBe(false);
  });
});

describe('robots and sitemap', () => {
  it('points the sitemap at the tenant host', () => {
    expect(robotsFor('User-agent: *\nDisallow: /app/\n\nSitemap: https://arkilaunch.app/sitemap.xml\n', 'https://almara.arkilaunch.app')).toContain(
      'Sitemap: https://almara.arkilaunch.app/sitemap.xml',
    );
    const xml = sitemapXml('https://almara.arkilaunch.app', ['e1']);
    expect(xml).toContain('<loc>https://almara.arkilaunch.app/</loc>');
    expect(xml).toContain('<loc>https://almara.arkilaunch.app/equipment/e1</loc>');
    expect(xml).not.toContain('/app');
  });
});