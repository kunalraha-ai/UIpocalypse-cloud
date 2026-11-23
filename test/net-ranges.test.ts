import { describe, expect, it } from 'vitest';
import { isBlockedIp, isBlockedHost, describeBlockedRange } from '../src/lib/safe-fetch/net-ranges.ts';

/**
 * The SSRF denylist (master prompt §7): a hosted crawler must never reach
 * loopback, private, link-local (cloud metadata!), or unroutable space —
 * IPv4 AND IPv6. Every blocked range gets a test; every test names the range
 * it protects. These are pure functions: no network, no mercy.
 */

describe('IPv4: blocked ranges', () => {
  const blocked: Array<[string, string]> = [
    ['0.0.0.0', 'this-network'],
    ['0.1.2.3', 'this-network'],
    ['10.0.0.1', 'private 10/8'],
    ['10.255.255.255', 'private 10/8'],
    ['100.64.0.1', 'CGNAT 100.64/10'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['169.254.169.254', 'cloud metadata (link-local)'],
    ['169.254.0.1', 'link-local'],
    ['172.16.0.1', 'private 172.16/12'],
    ['172.31.255.255', 'private 172.16/12'],
    ['192.168.1.1', 'private 192.168/16'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['192.0.2.1', 'TEST-NET-1'],
    ['198.18.0.1', 'benchmarking 198.18/15'],
    ['198.51.100.1', 'TEST-NET-2'],
    ['203.0.113.1', 'TEST-NET-3'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.255', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
  ];
  for (const [ip, why] of blocked) {
    it(`${ip} is BLOCKED (${why})`, () => {
      expect(isBlockedIp(ip), describeBlockedRange(ip)).toBe(true);
    });
  }

  const allowed: Array<[string, string]> = [
    ['1.1.1.1', 'public DNS'],
    ['8.8.8.8', 'public DNS'],
    ['104.16.132.229', 'public web'],
    ['172.32.0.1', 'just outside 172.16/12'],
    ['172.15.255.255', 'just below 172.16/12'],
    ['192.169.0.1', 'just outside 192.168/16'],
    ['198.19.255.255', 'edge of benchmarking... actually inside — see below'],
  ];
  it('198.18/15 blocks BOTH 198.18.x and 198.19.x', () => {
    expect(isBlockedIp('198.18.0.1')).toBe(true);
    expect(isBlockedIp('198.19.0.1')).toBe(true);
    expect(isBlockedIp('198.17.255.255')).toBe(false);
    expect(isBlockedIp('198.20.0.1')).toBe(false);
  });
  for (const [ip, why] of allowed.slice(0, 6)) {
    it(`${ip} is allowed (${why})`, () => {
      expect(isBlockedIp(ip)).toBe(false);
    });
  }
});

describe('IPv6: blocked ranges', () => {
  const blocked: Array<[string, string]> = [
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::ffff:169.254.169.254', 'IPv4-mapped cloud metadata'],
    ['fc00::1', 'unique local'],
    ['fd00::1', 'unique local'],
    ['fd00:ec2::254', 'AWS IMDS IPv6'],
    ['fe80::1', 'link-local'],
    ['fe80::ffff:ffff:ffff:ffff', 'link-local'],
    ['ff02::1', 'multicast'],
    ['64:ff9b::127.0.0.1', 'NAT64 of loopback'],
    ['2002:7f00:1::', '6to4 of 127.0.0.1'],
    ['2001:db8::1', 'documentation'],
  ];
  for (const [ip, why] of blocked) {
    it(`${ip} is BLOCKED (${why})`, () => {
      expect(isBlockedIp(ip), `${ip} (${why})`).toBe(true);
    });
  }

  it('public IPv6 is allowed', () => {
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedIp('2a00:1450:4001::1')).toBe(false);
  });
});

describe('host classification (v4 literals only at this layer)', () => {
  it('v4 literals classify directly', () => {
    expect(isBlockedHost('127.0.0.1')).toBe(true);
    expect(isBlockedHost('93.184.216.34')).toBe(false);
  });
  it('IPv6 literals classify', () => {
    expect(isBlockedHost('::1')).toBe(true);
    expect(isBlockedHost('[::1]')).toBe(true);
  });
  it('names are not decided here (DNS resolution decides)', () => {
    expect(isBlockedHost('example.com')).toBe(false); // caller must resolve first
  });
  it('garbage does not throw', () => {
    expect(isBlockedHost('not an ip')).toBe(false);
  });
});
