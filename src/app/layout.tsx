import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { currentUser } from '@/lib/runtime';

export const metadata: Metadata = {
  title: 'UIpocalypse Cloud | hosted monitoring that finds what breaks',
  description:
    'Hosted website monitoring: broken links, JavaScript errors, failed requests, missing images, heavy pages, SSL and redirect problems — with honest reports and prepaid credits.',
  robots: 'noindex',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="page">
            <Link href="/" className="logo">
              <span className="logo-mark">
                <span />
                <span />
                <span />
              </span>
              UIpocalypse&nbsp;Cloud
            </Link>
            <nav className="header-actions">
              {user ? (
                <Link href="/projects" className="btn btn-primary btn-sm">
                  Open dashboard
                </Link>
              ) : (
                <>
                  <Link href="/pricing" className="btn btn-ghost btn-sm">
                    Pricing
                  </Link>
                  <Link href="/signin" className="btn btn-primary btn-sm">
                    Sign in
                  </Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
