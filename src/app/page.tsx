import Link from 'next/link';

export default function Home() {
  return (
    <>
      <section className="hero">
        <h1>
          Find what breaks for your visitors.
          <br />
          Before they tell you.
        </h1>
        <p>
          UIpocalypse Cloud watches your website for broken links, JavaScript errors, failed requests, missing images,
          slow pages, SSL and redirect problems, and missing meta tags — then tells you what&apos;s new, what&apos;s
          fixed, and what&apos;s still failing.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Link href="/signin" className="btn btn-primary">
            Start monitoring
          </Link>
          <Link href="/pricing" className="btn btn-secondary">
            Pricing &amp; credits
          </Link>
        </div>
        <p className="muted small" style={{ marginTop: 22 }}>
          It finds things that break or degrade. It does not judge design or UX.
        </p>
      </section>
      <section className="page">
        <div className="callout callout-warn">
          <strong>Honest scope:</strong> this product is under construction (Phase 1). Nothing here is launched, no
          pricing is live, and all descriptions describe intended behavior — not measured results. The open-source
          sibling is the local{' '}
          <Link href="https://github.com/kunalraha-ai/UIpocalypse">UIpocalypse</Link> QA tool.
        </div>
      </section>
    </>
  );
}
