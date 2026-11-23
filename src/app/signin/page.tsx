import Link from 'next/link';
import { redirect } from 'next/navigation';
import { appConfig, currentUser } from '@/lib/runtime';

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (await currentUser().catch(() => null)) redirect('/projects');
  const cfg = appConfig();
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
        <p className="muted small">Sign in to monitor your sites. We request your identity and email only — never
          repository access.</p>
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
        <p className="muted small">
          By signing in you agree to the terms (placeholder) — <Link href="/pricing">see pricing first</Link> if you
          like.
        </p>
      </div>
    </div>
  );
}
