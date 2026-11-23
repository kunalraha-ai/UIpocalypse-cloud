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
          <strong>Honest scope:</strong> this product is under construction (all phases P1–P7 built, not launched). Nothing here is live, no pricing is active, and all descriptions describe intended behavior — not measured results. The open-source sibling is the local{' '}
          <a href="https://github.com/kunalraha-ai/UIpocalypse">UIpocalypse</a> QA tool —{' '}
          <a href="http://localhost:4310" style={{ color: 'var(--violet)' }}>run it locally →</a>
        </div>
      </section>
      <section className="page">
        <h2 style={{ textAlign: 'center' }}>Two modes, one product</h2>
        <div className="mode-grid">
          <div className="card">
            <div className="card-head"><strong>Local Tool</strong><span className="badge badge-blue">SIBLING</span></div>
            <p className="small">Chaos-test a <strong>disposable copy</strong> of your app on your machine. 30+ bot users click everything, race each other, and paste garbage — you get fix-ready evidence before deploying.</p>
            <a href="http://localhost:4310" className="btn btn-secondary">Open Local Tool →</a>
          </div>
          <div className="card">
            <div className="card-head"><strong>Cloud Monitoring</strong><span className="badge badge-good">THIS APP</span></div>
            <p className="small">Monitor your <strong>live website</strong> for broken links, JS errors, failed requests, slow pages, and SSL problems — with history diff, notifications, and prepaid credits.</p>
            <Link href="/signin" className="btn btn-primary">Start monitoring</Link>
          </div>
        </div>
      </section>
    </>
  );
}
