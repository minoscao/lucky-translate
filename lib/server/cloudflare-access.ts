import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

type AccessConfig = { issuer: string; audience: string; adminEmails: string[]; superEmails: string[] };
const emails = (value?: string) => (value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
export function accessConfig(): AccessConfig | null {
  const issuer = process.env.CF_ACCESS_TEAM_DOMAIN?.replace(/\/$/, '') || '';
  const audience = process.env.CF_ACCESS_AUD || '';
  const adminEmails = emails(process.env.CF_ACCESS_ADMIN_EMAILS), superEmails = emails(process.env.CF_ACCESS_SUPER_EMAILS);
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !audience || !adminEmails.length) return null;
  return { issuer, audience, adminEmails, superEmails };
}
const keySets = new Map<string, JWTVerifyGetKey>();
export async function verifyAccessToken(token: string, config: AccessConfig, keys?: JWTVerifyGetKey) {
  if (!keys) {
    keys = keySets.get(config.issuer);
    if (!keys) { keys = createRemoteJWKSet(new URL(`${config.issuer}/cdn-cgi/access/certs`)); keySets.set(config.issuer, keys); }
  }
  const { payload } = await jwtVerify(token, keys, {
    issuer: config.issuer, audience: config.audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'],
  });
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  if (!config.adminEmails.includes(email)) return null;
  return { email, superAdmin: config.superEmails.includes(email) };
}
const identities = new WeakMap<Request, Promise<Awaited<ReturnType<typeof verifyAccessToken>>>>();
export function accessIdentity(request: Request) {
  let result = identities.get(request);
  if (!result) {
    const config = accessConfig(), token = request.headers.get('Cf-Access-Jwt-Assertion');
    result = config && token ? verifyAccessToken(token, config).catch(() => null) : Promise.resolve(null);
    identities.set(request, result);
  }
  return result;
}
