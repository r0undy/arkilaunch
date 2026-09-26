import { afterEach, describe, expect, it } from 'vitest';
import { checkoutReturnOrigin } from './return-origin.js';

describe('checkoutReturnOrigin', () => {
  const saved = { web: process.env.WEB_ORIGIN, platform: process.env.PLATFORM_DOMAIN };
  afterEach(() => {
    process.env.WEB_ORIGIN = saved.web;
    process.env.PLATFORM_DOMAIN = saved.platform;
  });

  it('returns a tenant subdomain the API serves, else the web origin', () => {
    process.env.WEB_ORIGIN = 'http://localhost:5173';
    process.env.PLATFORM_DOMAIN = 'arkilaunch.com';

    expect(checkoutReturnOrigin(undefined)).toBe('http://localhost:5173');
    expect(checkoutReturnOrigin('http://almara.localhost:5173')).toBe('http://almara.localhost:5173');
    expect(checkoutReturnOrigin('https://almara.arkilaunch.com')).toBe('https://almara.arkilaunch.com');

    // Never an origin we don't serve.
    for (const bad of [
      'https://evil.com',
      'https://almara.arkilaunch.com.evil.com',
      'https://a.b.arkilaunch.com',
      'http://almara.arkilaunch.com',
      'https://almara.arkilaunch.com:8443',
      'http://almara.localhost:6666',
      'https://almara.localhost:5173',
      'not a url',
    ]) {
      expect(checkoutReturnOrigin(bad)).toBe('http://localhost:5173');
    }
  });
});
