import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl, exchangeCodeForIdentity, newState, stateFingerprint, ENDPOINTS, type OAuthEndpoints } from '../src/lib/auth/oauth.ts';

/**
 * OAuth contract: identity+email scopes ONLY (never repo access), the exact
 * minimum params per provider, and the code exchange against a stub OIDC.
 */

const STUB: Record<'github' | 'google', OAuthEndpoints> = {
  github: { authorizeUrl: 'https://stub/auth', tokenUrl: 'https://stub/token', userInfoUrl: 'https://stub/user', scope: 'read:user user:email' },
  google: { authorizeUrl: 'https://stub/auth', tokenUrl: 'https://stub/token', userInfoUrl: 'https://stub/user', scope: 'openid email profile' },
};

/** a local stub OIDC provider: token endpoint + userinfo + github emails */
function stubFetch(url: string | URL | RequestInfo, init?: RequestInit): Promise<Response> {
  const u = String(url instanceof URL ? url.href : typeof url === 'string' ? url : (url as Request).url);
  const body = init?.body ? String(init.body) : '';
  if (u === 'https://stub/token') {
    if (!body.includes('code=ok-code')) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'bad code' }), { status: 400 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ access_token: 'tok-123' }), { status: 200 }));
  }
  if (u === 'https://stub/user') {
    return Promise.resolve(
      new Response(JSON.stringify({ id: 42, login: 'alice', name: 'Alice', avatar_url: 'https://a.png', created_at: '2020-01-01T00:00:00Z', sub: 'g-77', email: 'alice@gmail.com', picture: 'https://p.png' }), { status: 200 }),
    );
  }
  if (u === 'https://api.github.com/user/emails') {
    return Promise.resolve(new Response(JSON.stringify([{ email: 'alice@users.noreply.github.com', primary: true, verified: true }]), { status: 200 }));
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
}

describe('oauth', () => {
  it('github authorize URL requests identity+email scope ONLY — never repo scope', () => {
    const url = buildAuthorizeUrl({ provider: 'github', clientId: 'cid', redirectUri: 'http://app/cb', state: 's' });
    const scope = new URL(url).searchParams.get('scope') ?? '';
    expect(scope).toBe('read:user user:email');
    expect(scope).not.toMatch(/repo|write|admin|delete/i);
  });

  it('google authorize URL uses response_type=code and online access', () => {
    const url = buildAuthorizeUrl({ provider: 'google', clientId: 'cid', redirectUri: 'http://app/cb', state: 's' });
    expect(new URL(url).searchParams.get('response_type')).toBe('code');
    expect(new URL(url).searchParams.get('access_type')).toBe('online');
    expect(new URL(url).searchParams.get('scope')).toBe('openid email profile');
  });

  it('github exchange resolves the identity with primary verified email and account age', async () => {
    const id = await exchangeCodeForIdentity({ provider: 'github', clientId: 'cid', clientSecret: 'sec', code: 'ok-code', redirectUri: 'http://app/cb', endpoints: STUB.github, fetchImpl: stubFetch });
    expect(id.providerAccountId).toBe('42');
    expect(id.email).toBe('alice@users.noreply.github.com');
    expect(id.accountCreatedAt).toBe(1577836800);
  });

  it('google exchange resolves sub as the provider account id', async () => {
    const id = await exchangeCodeForIdentity({ provider: 'google', clientId: 'cid', clientSecret: 'sec', code: 'ok-code', redirectUri: 'http://app/cb', endpoints: STUB.google, fetchImpl: stubFetch });
    expect(id.providerAccountId).toBe('g-77');
    expect(id.email).toBe('alice@gmail.com');
  });

  it('a bad code fails the exchange loudly', async () => {
    await expect(
      exchangeCodeForIdentity({ provider: 'github', clientId: 'cid', clientSecret: 'sec', code: 'bad', redirectUri: 'http://app/cb', endpoints: STUB.github, fetchImpl: stubFetch }),
    ).rejects.toThrow(/token exchange failed/);
  });

  it('state is random and fingerprintable', () => {
    const s = newState();
    expect(s).toHaveLength(48);
    expect(stateFingerprint(s, 'secret')).toBe(stateFingerprint(s, 'secret'));
    expect(stateFingerprint(s, 'secret')).not.toBe(stateFingerprint('other', 'secret'));
  });

  it('the shipped endpoint table never grows beyond identity scopes', () => {
    for (const ep of Object.values(ENDPOINTS)) {
      expect(ep.scope).not.toMatch(/repo|admin|write|delete/i);
    }
  });
});
