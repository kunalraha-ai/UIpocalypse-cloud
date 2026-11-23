<div align="center">

# UIpocalypse Cloud

**Hosted website monitoring that finds what breaks for your visitors.**

Broken links · JavaScript errors · failed requests · missing images · slow pages · SSL and redirect problems · missing meta tags — with honest reports, history diff, and prepaid credits.

**Status: Phase 1 (foundations).** Nothing here is launched. The open-source sibling is the local [UIpocalypse](https://github.com/kunalraha-ai/UIpocalypse) QA tool.

</div>

---

## Dev quickstart (P1)

Requirements: Node 22+, Docker.

```bash
docker compose up -d postgres      # local Postgres on :5435
cp .env.example .env               # defaults work as-is for local dev
npm install
npm run migrate                    # apply SQL migrations
npm run dev                        # app → http://localhost:4311
npm run worker                     # separate terminal: the scan worker
npm test                           # 21 tests (unit + Postgres integration)
```

To actually sign in, create OAuth apps and fill `.env` (the sign-in page
honestly reports "not configured" until you do):

- **GitHub**: <https://github.com/settings/developers> — callback `http://localhost:4311/api/auth/github/callback`
- **Google**: <https://console.cloud.google.com/apis/credentials> — callback `http://localhost:4311/api/auth/google/callback`

Both request identity + email only, never repository access.

## Architecture (P1)

```
Next.js (App Router)  ──enqueue──▶  pg-boss (Postgres)  ──▶  worker process
      │                                    │                        │
      └── app tables (users, oauth_identities, sessions,             │
          projects, runs) ◀─────────────── run row: queued → running → completed
```

- **Web** enqueues; the **worker** (separate process) executes — nothing heavy runs in the web process
- **Postgres** for everything (no Redis); migrations are plain numbered SQL
- **Auth**: GitHub + Google OAuth (identity+email scopes), server-side sessions (HMAC-signed opaque cookies)
- **Config**: every price, tier, limit, and threshold lives in `config/app-config.ts` — validated at boot, bad config refuses to start
- **Credits/billing, scan engine, scheduling**: Phases 3–6 (see the project's phase plan)

## Phases

- **P1 Foundations** ✅ repo, auth (GitHub+Google), DB schema + migrations, pg-boss queue, worker skeleton, config system, CI, landing/sign-in/projects pages
- **P2 Safety core** — SSRF guard, rate limits, robots.txt, ownership verification
- **P3 Scan engine** — crawl + checks + fingerprints + fixture test site
- **P4 History & diff reports UI**
- **P5 Scheduling, API, CI webhook, notifications**
- **P6 Credits ledger & billing (test mode)**
- **P7 Hardening, docs, legal, onboarding**

## License

MIT (pending final owner confirmation) — see the LICENSE file once added.
