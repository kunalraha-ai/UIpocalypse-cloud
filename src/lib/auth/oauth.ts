import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * OAuth 2.0 authorization-code flow, provider-agnostic. Identity + email
 * scopes only — never request repo access or anything beyond identity.
 * All provider endpoints are injectable so tests run against a local stub.
 */

export type OAuthProvider = 'github' | 'google';

export type OAuthEndpoints = {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
};

export const ENDPOINTS: Record<OAuthProvider, OAuthEndpoints> = {
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scope: 'read:user user:email', // identity + email, nothing more
  },
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile', // identity + email, nothing more
  },
};

export type OAuthIdentity = {
  providerAccountId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** unix seconds of account creation, when the provider exposes it */
  accountCreatedAt: number | null;
};

/** CSRF-safe state: random token, verified at callback. */
export function newState(): string {
  return randomBytes(24).toString('hex');
}

export function stateFingerprint(state: string, secret: string): string {
  return createHmac('sha256', secret).update(state).digest('hex').slice(0, 32);
}

export function buildAuthorizeUrl(input: {
  provider: OAuthProvider;
  clientId: string;
  redirectUri: string;
  state: string;
  endpoints?: OAuthEndpoints;
}): string {
  const ep = input.endpoints ?? ENDPOINTS[input.provider];
  const url = new URL(ep.authorizeUrl);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', ep.scope);
  url.searchParams.set('state', input.state);
  if (input.provider === 'google') {
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'online'); // no offline refresh — we don't need it
  }
  return url.toString();
}

/** Exchange the code and fetch the identity. Injectable fetch for tests. */
export async function exchangeCodeForIdentity(input: {
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  endpoints?: OAuthEndpoints;
  fetchImpl?: (url: string | URL | RequestInfo, init?: RequestInit) => Promise<Response>;
}): Promise<OAuthIdentity> {
  const ep = input.endpoints ?? ENDPOINTS[input.provider];
  const doFetch: (url: string | URL | RequestInfo, init?: RequestInit) => Promise<Response> = input.fetchImpl ?? ((u, i) => fetch(u, i));

  const tokenRes = await doFetch(ep.tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`oauth token exchange failed: HTTP ${tokenRes.status}`);
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) throw new Error('oauth token exchange returned no access_token');

  const userRes = await doFetch(ep.userInfoUrl, {
    headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/json' },
  });
  if (!userRes.ok) throw new Error(`oauth user info failed: HTTP ${userRes.status}`);
  const raw = (await userRes.json()) as Record<string, unknown>;

  if (input.provider === 'github') {
    const emailsRes = await doFetch('https://api.github.com/user/emails', {
      headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/json' },
    }).catch(() => null);
    const emails = emailsRes && emailsRes.ok ? ((await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>) : [];
    const primary = emails.find((e) => e.primary && e.verified)?.email ?? null;
    return {
      providerAccountId: String(raw.id ?? ''),
      email: primary ?? (typeof raw.email === 'string' ? raw.email : null),
      displayName: typeof raw.name === 'string' ? raw.name : typeof raw.login === 'string' ? raw.login : null,
      avatarUrl: typeof raw.avatar_url === 'string' ? raw.avatar_url : null,
      accountCreatedAt: typeof raw.created_at === 'string' ? Math.floor(new Date(raw.created_at).getTime() / 1000) : null,
    };
  }

  // google
  if (typeof raw.sub !== 'string') throw new Error('google userinfo missing sub');
  return {
    providerAccountId: raw.sub,
    email: typeof raw.email === 'string' ? raw.email : null,
    displayName: typeof raw.name === 'string' ? raw.name : null,
    avatarUrl: typeof raw.picture === 'string' ? raw.picture : null,
    accountCreatedAt: null,
  };
}
