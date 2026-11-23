export const metadata = { title: 'Terms of Service | UIpocalypse Cloud' };

export default function Terms() {
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1>Terms of Service</h1>
      <p className="muted">Last updated: 2026-11-23. Placeholder until launch.</p>
      <div className="callout">
        <strong>This document is a placeholder.</strong> The hosted service is not launched. The final terms will be
        written with the operating entity&apos;s legal counsel before any user can sign up.
      </div>
      <h2>1. The service</h2>
      <p>UIpocalypse Cloud (&quot;the Service&quot;) is a website monitoring and testing tool that crawls and checks websites for issues that affect visitors. It is provided by [ENTITY] (&quot;we&quot;).</p>
      <h2>2. Your obligations</h2>
      <ul>
        <li>You may only scan websites you own or have explicit written permission to test.</li>
        <li>You must not use the Service to attack, disrupt, or overload any website.</li>
        <li>You must comply with robots.txt and our crawl limits.</li>
      </ul>
      <h2>3. Ownership verification</h2>
      <p>Scans of unverified domains are limited to a single page at low frequency. Full crawling requires proof of ownership.</p>
      <h2>4. Credits and billing</h2>
      <p>The Service uses prepaid credits. Free credits expire after 30 days. Purchased credits do not expire. Failed runs are auto-refunded. We never charge without a positive credit balance.</p>
      <h2>5. Acceptable use</h2>
      <p>We may suspend or terminate accounts that: scan domains they do not own, attempt to bypass rate limits or safety controls, or use the Service to violate any law.</p>
      <h2>6. No warranty</h2>
      <p>The Service is provided &quot;as is&quot; without warranty of any kind. A clean report does not mean your website is bug-free, secure, or accessible.</p>
      <h2>7. Limitation of liability</h2>
      <p>[Standard limitation to be drafted at launch.]</p>
    </div>
  );
}
