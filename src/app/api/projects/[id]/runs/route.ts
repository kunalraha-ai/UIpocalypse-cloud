import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { appConfig, db, currentUser } from '@/lib/runtime';
import { enqueueScan, SCAN_QUEUE } from '@/lib/queue';

/**
 * POST /api/projects/{id}/runs — enqueue a manual scan for a project.
 * P1: creates the run row (queued) and pushes the job; the worker no-ops it
 * to completion. Real charging lands in P6; scheduling in P5.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const { id } = await ctx.params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) return NextResponse.json({ error: 'bad project id' }, { status: 400 });

  const pool = db();
  const cfg = appConfig();
  const owned = await pool.query<{ id: string }>('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [projectId, user.id]);
  if (owned.rows.length === 0) return NextResponse.json({ error: 'no such project' }, { status: 404 });

  const project = (await pool.query<{ url: string }>('SELECT url FROM projects WHERE id = $1', [projectId])).rows[0]!;
  const run = await pool.query<{ id: string }>(
    'INSERT INTO runs (project_id, status, trigger) VALUES ($1, $2, $3) RETURNING id',
    [projectId, 'queued', 'manual'],
  );
  const runId = Number(run.rows[0]!.id);
  await enqueueScan(cfg, {
    runId,
    projectId,
    url: project.url,
    maxPages: cfg.scan.defaultMaxPages,
    maxDepth: cfg.scan.defaultMaxDepth,
    trigger: 'manual',
  });
  return NextResponse.json({ runId, queue: SCAN_QUEUE }, { status: 202 });
}
