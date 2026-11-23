import { NextResponse, type NextRequest } from 'next/server';
import { appConfig } from '@/lib/runtime';
import { ENDPOINTS, buildAuthorizeUrl, newState, stateFingerprint, type OAuthProvider } from '@/lib/auth/oauth';
import { SESSION_COOKIE } from '@/lib/auth/session';

/**
 * GET /api/auth/{provider} — start the OAuth flow. CSRF state is stored as an
 * HMAC-fingerprinted short-lived cookie, verified at the callback.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (provider !== 'github' && provider !== 'google') {
    return NextResponse.json({ error: 'unknown provider' }, { status: 404 });
  }
  const cfg = appConfig();
  const providerCfg = provider === 'github' ? cfg.auth.github : cfg.auth.google;
  if (!providerCfg.enabled) {
    return NextResponse.json(
      { error: `${provider} sign-in is not configured — set ${provider.toUpperCase()}_CLIENT_ID/SECRET` },
      { status: 503 },
    );
  }
  const state = newState();
  const redirectUri = `${cfg.appUrl}/api/auth/${provider}/callback`;
  const url = buildAuthorizeUrl({ provider, clientId: providerCfg.clientId, redirectUri, state });
  void ENDPOINTS;
  const res = NextResponse.redirect(url);
  // short-lived state cookie: the value is state + its fingerprint under the
  // session secret, so the callback can verify without server-side storage
  res.cookies.set(`uipoc_oauth_state_${provider}`, `${state}.${stateFingerprint(state, cfg.sessionSecret)}`, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  void SESSION_COOKIE;
  return res;
}
