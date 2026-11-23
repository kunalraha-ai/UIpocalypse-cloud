export const metadata = { title: 'Privacy Policy | UIpocalypse Cloud' };

export default function Privacy() {
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1>Privacy Policy</h1>
      <p className="muted">Last updated: 2026-11-23. Placeholder until launch.</p>
      <div className="callout">
        <strong>This document is a placeholder.</strong> The hosted service is not launched. The final policy will
        be written with the operating entity&apos;s legal counsel before any user can sign up.
      </div>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> your email address and OAuth identity (GitHub or Google). We request identity and email scopes only, never repository access.</li>
        <li><strong>Scan data:</strong> the URLs we crawl, the HTTP responses, console errors, and page metrics from the websites you ask us to scan. This is the product&apos;s core function.</li>
        <li><strong>Operational data:</strong> run logs, timings, and error reports needed to operate the service.</li>
      </ul>
      <h2>What we do NOT collect</h2>
      <ul>
        <li>We do not read your source code (unlike the local UIpocalypse tool, the hosted service only interacts with your public website).</li>
        <li>We do not store cookies from your websites.</li>
        <li>We do not sell or share your data with third parties for advertising.</li>
      </ul>
      <h2>Data retention</h2>
      <p>Scan results are retained while your account is active. You can delete any project or run at any time. Deleting your account deletes all scan data.</p>
      <h2>Data location</h2>
      <p>All data is stored on servers operated by [ENTITY] in [REGION].</p>
    </div>
  );
}
