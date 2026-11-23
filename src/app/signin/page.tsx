import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { appConfig, currentUser } from '@/lib/runtime';
import { SESSION_COOKIE, newSessionId, sessionExpiry, signSessionId } from '@/lib/auth/session';
import { createSession } from '@/lib/auth/users';
import { db } from '@/lib/runtime';

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (await currentUser().catch(() => null)) redirect('/projects');
  const cfg = appConfig();

  async function demoSignIn() {
    'use server';
    // create or find the demo user and issue a real session
    const pool = db();
    const res = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ('demo@uipocalypse.dev', 'Demo User')
       ON CONFLICT (email) DO UPDATE SET display_name = 'Demo User'
       RETURNING id`,
    );
    const userId = res.rows[0]!.id;
    const sessionId = newSessionId();
    await createSession(pool, userId, sessionId, sessionExpiry());
    const jar = await cookies();
    jar.set(SESSION_COOKIE, signSessionId(sessionId, appConfig().sessionSecret), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 3600,
    });
    redirect('/projects');
  }

  return (
    <div className="center-page page">
      <div className="auth-card">
        <div className="logo">
          <span className="logo-mark">
            <span />
            <span />
            <span />
          </span>
          UIpocalypse Cloud
        </div>
        <p className="muted small">
          Sign in to monitor your sites. We request your identity and email only — never
          repository access.
        </p>
        {error && (
          <div className="callout callout-warn">
            Sign-in failed (<code>{error}</code>). Check the provider configuration and try again.
          </div>
        )}
        {cfg.auth.github.enabled ? (
          <a className="btn provider-btn" href="/api/auth/github">
            Continue with GitHub
          </a>
        ) : (
          <div className="callout">GitHub sign-in is not configured on this deployment yet.</div>
        )}
        {cfg.auth.google.enabled ? (
          <a className="btn provider-btn" href="/api/auth/google">
            Continue with Google
          </a>
        ) : (
          <div className="callout">Google sign-in is not configured on this deployment yet.</div>
        )}
        <div style={{ borderTop: '1px solid var(--line)', margin: '14px 0', width: '100%' }} />
        <form action={demoSignIn}>
          <button
            type="submit"
            className="btn provider-btn"
            style={{ width: '100%', justifyContent: 'center', background: 'var(--surface-2)', border: '1px dashed var(--muted)', color: 'var(--muted)' }}
          >
            Enter without signing in (demo)
          </button>
        </form>
        <p className="muted small" style={{ fontSize: 11 }}>
          Creates a local demo account. For development only — remove before launch.
        </p>
        <p className="muted small">
          By signing in you agree to the terms (placeholder) —{' '}
          <Link href="/terms">read them</Link> if you like.
        </p>
      </div>
    </div>
  );
}
