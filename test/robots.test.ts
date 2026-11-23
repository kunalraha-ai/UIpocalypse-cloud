import { describe, expect, it } from 'vitest';
import { parseRobots, robotsAllows, robotsAgentFor, ROBOTS_USER_AGENT } from '../src/lib/crawl/robots.ts';

/**
 * robots.txt (master prompt §7: honor robots.txt). The parser is pure; the
 * policy decision is: our agent group if present, else *, longest-match on
 * Allow/Disallow per the spec. Never fail OPEN — unparseable = allow only
 * what the spec allows by default (everything), but robots fetch failure at
 * the caller means NO CRAWL (the caller decides, tested there).
 */

const T1 = `User-agent: *
Disallow: /admin
Disallow: /private/

User-agent: UIpocalypseCloudBot
Disallow: /cache/`;

const T2 = `User-agent: *
Allow: /public
Disallow: /
Crawl-delay: 5`;

const T3 = `# only comments and junk
this is not robots.txt
!!!`;

const T4 = `User-agent: *
Disallow: /a$
Disallow: /b
Allow: /b/ok`;

describe('parseRobots', () => {
  it('parses groups by agent', () => {
    const r = parseRobots(T1);
    expect(r.groups.map((g) => g.agents)).toEqual([['*'], ['uipocalypsecloudbot']]);
  });
  it('lowercases agents and collects rules per group', () => {
    const r = parseRobots(T1);
    expect(r.groups[0]!.disallow).toEqual(['/admin', '/private/']);
    expect(r.groups[1]!.disallow).toEqual(['/cache/']);
  });
  it('captures crawl-delay', () => {
    const r = parseRobots(T2);
    expect(r.groups[0]!.crawlDelaySeconds).toBe(5);
  });
  it('junk parses to zero groups (caller decides the no-robots policy)', () => {
    expect(parseRobots(T3).groups).toEqual([]);
    expect(parseRobots('').groups).toEqual([]);
  });
});

describe('robotsAllows — policy', () => {
  it('when our agent group exists, ONLY its rules apply (spec: most specific group wins)', () => {
    const r = parseRobots(T1);
    expect(robotsAllows(r, '/cache/x', ROBOTS_USER_AGENT)).toBe(false); // our group disallows /cache/
    expect(robotsAllows(r, '/admin/x', ROBOTS_USER_AGENT)).toBe(true); // the * group does NOT also apply to us
    expect(robotsAllows(r, '/blog', ROBOTS_USER_AGENT)).toBe(true);
  });
  it('falls back to * when our agent is not mentioned; longest rule wins', () => {
    const r = parseRobots(T2);
    expect(robotsAllows(r, '/public/x', ROBOTS_USER_AGENT)).toBe(true); // Allow /public (7) beats Disallow / (1)
    expect(robotsAllows(r, '/anything-else', ROBOTS_USER_AGENT)).toBe(false); // only Disallow / matches
  });
  it('longest matching rule wins (Allow beats Disallow when longer)', () => {
    const r = parseRobots(T4);
    expect(robotsAllows(r, '/b/ok', ROBOTS_USER_AGENT)).toBe(true); // Allow /b/ok longer than Disallow /b
    expect(robotsAllows(r, '/b/no', ROBOTS_USER_AGENT)).toBe(false);
  });
  it('empty robots allows everything', () => {
    expect(robotsAllows(parseRobots(''), '/anything', ROBOTS_USER_AGENT)).toBe(true);
  });
  it('a robots with only * rules and no match allows', () => {
    const r = parseRobots('User-agent: *\nDisallow: /x');
    expect(robotsAllows(r, '/y', ROBOTS_USER_AGENT)).toBe(true);
    expect(robotsAllows(r, '/x', ROBOTS_USER_AGENT)).toBe(false);
  });
});

describe('robotsAgentFor — which group applies', () => {
  it('prefers the exact-agent group', () => {
    const r = parseRobots(T1);
    expect(robotsAgentFor(r, ROBOTS_USER_AGENT)?.agents).toEqual(['uipocalypsecloudbot']);
  });
  it('falls back to *', () => {
    const r = parseRobots(T2);
    expect(robotsAgentFor(r, ROBOTS_USER_AGENT)?.agents).toEqual(['*']);
  });
  it('null when nothing applies', () => {
    expect(robotsAgentFor(parseRobots(''), ROBOTS_USER_AGENT)).toBeNull();
  });
});
