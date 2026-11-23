import { NextResponse, type NextRequest } from 'next/server';
import { appConfig, db } from '@/lib/runtime';
import { exchangeCodeForIdentity, stateFingerprint, type OAuthProvider } from '@/lib/auth/oauth';
import { SESSION_COOKIE, newSessionId, sessionExpiry, signSessionId } from '@/lib/auth/session';
import { createSession, upsertOAuthUser } from '@/lib/auth/users';

/**
 * GET /api/auth/{provider}/callback — verify state, exchange the code,
 * find-or-create the user, issue a server-side session cookie.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (provider !== 'github' && provider !== 'google') {
    return NextResponse.json({ error: 'unknown provider' }, { status: 404 });
  }
  const cfg = appConfig();
  const providerCfg = provider === 'github' ? cfg.auth.github : cfg.auth.google;
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const stateCookie = req.cookies.get(`uipoc_oauth_state_${provider}`)?.value ?? '';

  // 1. CSRF: state must match the cookie AND its own fingerprint
  if (!code || !state || !stateCookie) {
    return NextResponse.redirect(`${cfg.appUrl}/signin?error=missing_params`);
  }
  const dot = stateCookie.lastIndexOf('.');
  const cookieState = stateCookie.slice(0, dot);
  const cookieFp = stateCookie.slice(dot + 1);
  if (cookieState !== state || cookieFp !== stateFingerprint(state, cfg.sessionSecret)) {
    return NextResponse.redirect(`${cfg.appUrl}/signin?error=state_mismatch`);
  }

  // 2. exchange + identity
  let identity;
  try {
    identity = await exchangeCodeForIdentity({
      provider,
      clientId: providerCfg.clientId,
      clientSecret: providerCfg.clientSecret,
      code,
      redirectUri: `${cfg.appUrl}/api/auth/${provider}/callback`,
    });
  } catch (e) {
    console.error(`oauth ${provider} exchange failed:`, e);
    return NextResponse.redirect(`${cfg.appUrl}/signin?error=exchange_failed`);
  }

  // 3. user + server-side session
  const pool = db();
  const { user } = await upsertOAuthUser(pool, { provider, identity });
  const sessionId = newSessionId();
  await createSession(pool, user.id, sessionId, sessionExpiry());

  const res = NextResponse.redirect(`${cfg.appUrl}/projects`);
  res.cookies.set(SESSION_COOKIE, signSessionId(sessionId, cfg.sessionSecret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(cfg.appUrl).protocol === 'https:',
    path: '/',
    maxAge: 30 * 24 * 3600,
  });
  res.cookies.delete(`uipoc_oauth_state_${provider}`);
  return res;
}
