import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db, currentUser } from '@/lib/runtime';

export default async function Projects() {
  const user = await currentUser().catch(() => null);
  if (!user) redirect('/signin');
  const pool = db();
  const projects = await pool.query<{ id: string; name: string; url: string; verification_state: string }>(
    'SELECT id, name, url, verification_state FROM projects WHERE user_id = $1 ORDER BY id',
    [user.id],
  );
  return (
    <div className="page">
      <h1>Projects</h1>
      <p className="muted small">
        Signed in as {user.email}. Add-a-project arrives with the scan engine (P3) — this page lists what exists.
      </p>
      {projects.rows.length === 0 ? (
        <div className="card">
          <p>No projects yet. The add-project flow ships in Phase 3 with the first real scan.</p>
        </div>
      ) : (
        <div>
          {projects.rows.map((p) => (
            <div className="card" key={p.id} style={{ marginBottom: 12 }}>
              <strong>{p.name}</strong> <span className="muted">· {p.url}</span>
              <span className="muted small mono"> · {p.verification_state}</span>
            </div>
          ))}
        </div>
      )}
      <p className="muted small">
        <Link href="/">Back to home</Link>
      </p>
    </div>
  );
}
