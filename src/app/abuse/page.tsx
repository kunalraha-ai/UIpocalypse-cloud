export const metadata = { title: 'Abuse Report | UIpocalypse Cloud' };

export default function AbuseReport() {
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1>Abuse Report</h1>
      <p>If you believe a UIpocalypse Cloud scan is abusing your website, tell us and we will act immediately.</p>
      <h2>What we do to prevent abuse</h2>
      <ul>
        <li>Scans run only against domains the account owner has verified (meta tag, DNS TXT, or `/.well-known` file)</li>
        <li>Unverified domains get exactly one page, no scheduling</li>
        <li>Rate limits per user, per domain, and globally</li>
        <li>robots.txt is always respected</li>
        <li>An identifiable User-Agent with this abuse URL</li>
        <li>An admin kill switch per domain and per user</li>
      </ul>
      <h2>To report abuse</h2>
      <ol>
        <li>Email: <code>abuse@uipocalypse.example</code> (placeholder)</li>
        <li>Include: the URL that was scanned, the approximate time, and any relevant logs</li>
      </ol>
      <h2>What we will do</h2>
      <ul>
        <li>Kill-switch the domain and/or user immediately</li>
        <li>Investigate and respond within 48 hours</li>
        <li>Suspend accounts that scan domains they do not own</li>
      </ul>
      <div className="callout" style={{ marginTop: 24 }}>
        <strong>Placeholder notice:</strong> The hosted service is not yet launched. The abuse email address will be real at launch.
      </div>
    </div>
  );
}
