import { safeFetch } from '../safe-fetch/safe-fetch.ts';

/**
 * robots.txt (master prompt §7): honor it. Pure parser + policy; the fetch of
 * robots.txt itself goes through the SSRF guard (caller responsibility).
 */

export const ROBOTS_USER_AGENT = 'UIpocalypseCloudBot';

export type RobotsGroup = {
  agents: string[];
  allow: string[];
  disallow: string[];
  crawlDelaySeconds?: number;
  /** internal parser state */
  rulesStarted?: boolean;
};

export function parseRobots(raw: string): Robots {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue; // junk line — skip
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      const agent = value.toLowerCase();
      if (!current || current.rulesStarted) {
        current = { agents: [agent], allow: [], disallow: [] };
        groups.push(current);
      } else {
        current.agents.push(agent);
      }
      continue;
    }
    if (!current) continue; // rule before any agent — skip
    current.rulesStarted = true;
    if (field === 'disallow') current.disallow.push(value);
    else if (field === 'allow') current.allow.push(value);
    else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) current.crawlDelaySeconds = n;
    }
  }
  return { groups };
}

export type Robots = { groups: RobotsGroup[] };

/** Which group governs this agent? Exact match wins, then *. */
export function robotsAgentFor(robots: Robots, agent: string): RobotsGroup | null {
  const a = agent.toLowerCase();
  const exact = robots.groups.find((g) => g.agents.includes(a));
  if (exact) return exact;
  return robots.groups.find((g) => g.agents.includes('*')) ?? null;
}

function ruleLength(rule: string): number {
  if (rule.endsWith('$')) return rule.length - 1;
  return rule.length;
}

function ruleMatches(rule: string, path: string): boolean {
  if (rule === '') return false; // empty Disallow = allow all
  if (rule.endsWith('$')) return path === rule.slice(0, -1);
  return path.startsWith(rule);
}

/** May this agent fetch this path? Longest matching Allow/Disallow wins. */
export function robotsAllows(robots: Robots, path: string, agent: string): boolean {
  const group = robotsAgentFor(robots, agent);
  if (!group) return true; // no applicable rules → allowed
  let best: { allow: boolean; len: number } | null = null;
  for (const r of group.disallow) {
    if (ruleMatches(r, path)) {
      const len = ruleLength(r);
      if (!best || len > best.len) best = { allow: false, len };
    }
  }
  for (const r of group.allow) {
    if (ruleMatches(r, path)) {
      const len = ruleLength(r);
      if (!best || len > best.len) best = { allow: true, len };
    }
  }
  if (!best) return true; // no rule matched → allowed
  return best.allow;
}

/** Fetch a site's robots.txt through the SSRF guard. 4xx = no restrictions. */
export async function fetchRobots(origin: string, opts: Parameters<typeof safeFetch>[1] = {}): Promise<Robots> {
  const res = await safeFetch(new URL('/robots.txt', origin).toString(), opts);
  if (res.status >= 400) return { groups: [] }; // unreachable/disallowed robots = no rules for us
  const text = await res.text().catch(() => '');
  return parseRobots(text);
}
