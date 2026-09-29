// Only an origin this API already serves, never an arbitrary one: PayMongo would redirect a paying customer
// anywhere a forged Origin header said.
const ONE_LABEL = /^[a-z0-9-]+$/;

export function checkoutReturnOrigin(requestOrigin: string | undefined): string {
  const webOrigin = (process.env.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '');
  if (!requestOrigin || requestOrigin === webOrigin) return webOrigin;
  let request: URL;
  let web: URL;
  try {
    request = new URL(requestOrigin);
    web = new URL(webOrigin);
  } catch {
    return webOrigin;
  }
  if (request.origin !== requestOrigin) return webOrigin; // a path, credentials, etc.
  const isSubdomainOf = (root: string) =>
    request.hostname.endsWith(`.${root}`) && ONE_LABEL.test(request.hostname.slice(0, -root.length - 1));
  // A tenant subdomain of the web origin itself (dev: almara.localhost:5173).
  if (request.protocol === web.protocol && request.port === web.port && isSubdomainOf(web.hostname)) {
    return request.origin;
  }
  const platformDomain = process.env.PLATFORM_DOMAIN;
  if (platformDomain && request.protocol === 'https:' && request.port === '' && isSubdomainOf(platformDomain)) {
    return request.origin;
  }
  return webOrigin;
}
