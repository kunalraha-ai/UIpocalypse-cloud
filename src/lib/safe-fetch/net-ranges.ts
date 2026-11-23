import { isIP } from 'node:net';

/**
 * SSRF denylist (master prompt §7): a hosted crawler must never reach
 * loopback, private, link-local (cloud metadata!), CGNAT, multicast, or
 * unroutable space — in IPv4 AND IPv6, including every mapped/translation
 * form (IPv4-mapped, NAT64, 6to4). Pure functions; no I/O.
 */

type Range = { start: bigint; end: bigint; name: string };

function ipToBigInt(ip: string): bigint | null {
  if (isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    return (BigInt(parts[0]!) << 24n) | (BigInt(parts[1]!) << 16n) | (BigInt(parts[2]!) << 8n) | BigInt(parts[3]!);
  }
  if (isIP(ip) === 6) {
    // expand :: and parse groups. An embedded IPv4 tail (e.g. ::ffff:127.0.0.1)
    // occupies the LAST 32 bits — TWO group slots — and the :: expansion must
    // account for that or the value overflows 128 bits.
    let head = ip, tail = '';
    const dc = ip.indexOf('::');
    if (dc >= 0) {
      head = ip.slice(0, dc);
      tail = ip.slice(dc + 2);
    }
    const split = (s: string) => (s ? s.split(':').filter(Boolean) : []);
    const hGroups = split(head);
    const tGroups = split(tail);
    const slots = hGroups.length + tGroups.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);
    const words: Array<string | bigint> = [...hGroups];
    const missing = 8 - slots;
    for (let i = 0; i < Math.max(0, missing); i++) words.push('0');
    let v = 0n;
    for (const g of [...words, ...tGroups]) {
      if (typeof g === 'string' && g.includes('.')) {
        const v4 = ipToBigInt(g);
        if (v4 === null) return null;
        v = (v << 32n) | v4;
        continue;
      }
      const n = typeof g === 'bigint' ? g : BigInt(parseInt(g, 16));
      if (Number.isNaN(Number(n))) return null;
      v = (v << 16n) | n;
    }
    return v;
  }
  return null;
}

function v4Range(start: string, end: string, name: string): Range {
  return { start: ipToBigInt(start)!, end: ipToBigInt(end)!, name };
}

function v6Range(cidr: string, name: string): Range {
  const [addr, bitsRaw] = cidr.split('/');
  const bits = BigInt(bitsRaw ?? '128');
  const base = ipToBigInt(addr!);
  if (base === null) throw new Error(`bad cidr ${cidr}`);
  const hostBits = 128n - bits;
  const start = (base >> hostBits) << hostBits;
  const end = start | ((1n << hostBits) - 1n);
  return { start, end, name };
}

/** the IPv6 universe as two 64-bit halves stitched into one 128-bit space */
const V6_ALL: Range = { start: 0n, end: (1n << 128n) - 1n, name: 'ipv6' };
void V6_ALL;

const V4 = {
  thisNetwork: v4Range('0.0.0.0', '0.255.255.255', 'this-network 0/8'),
  private10: v4Range('10.0.0.0', '10.255.255.255', 'private 10/8'),
  cgnat: v4Range('100.64.0.0', '100.127.255.255', 'CGNAT 100.64/10'),
  loopback: v4Range('127.0.0.0', '127.255.255.255', 'loopback 127/8'),
  linkLocal: v4Range('169.254.0.0', '169.254.255.255', 'link-local (cloud metadata) 169.254/16'),
  private172: v4Range('172.16.0.0', '172.31.255.255', 'private 172.16/12'),
  ietf: v4Range('192.0.0.0', '192.0.0.255', 'IETF protocol 192.0.0/24'),
  testNet1: v4Range('192.0.2.0', '192.0.2.255', 'TEST-NET-1'),
  private192: v4Range('192.168.0.0', '192.168.255.255', 'private 192.168/16'),
  benchmarking: v4Range('198.18.0.0', '198.19.255.255', 'benchmarking 198.18/15'),
  testNet2: v4Range('198.51.100.0', '198.51.100.255', 'TEST-NET-2'),
  testNet3: v4Range('203.0.113.0', '203.0.113.255', 'TEST-NET-3'),
  multicast: v4Range('224.0.0.0', '239.255.255.255', 'multicast 224/4'),
  reserved: v4Range('240.0.0.0', '255.255.255.255', 'reserved 240/4 + broadcast'),
};

const V6 = {
  unspecified: v6Range('::/128', 'unspecified ::'),
  loopback: v6Range('::1/128', 'IPv6 loopback ::1'),
  v4mapped: v6Range('::ffff:0:0/96', 'IPv4-mapped'),
  discard: v6Range('100::/64', 'discard-only'),
  teredo: v6Range('2001::/32', 'Teredo'),
  benchmarking6: v6Range('2001:2::/48', 'benchmarking 2001:2/48'),
  documentation: v6Range('2001:db8::/32', 'documentation 2001:db8/32'),
  orchid: v6Range('2001:20::/28', 'ORCHID'),
  nat64: v6Range('64:ff9b::/96', 'NAT64 (translated IPv4)'),
  sixToFour: v6Range('2002::/16', '6to4 (embedded IPv4)'),
  uniqueLocal: v6Range('fc00::/7', 'unique-local fc00/7'),
  linkLocal: v6Range('fe80::/10', 'IPv6 link-local fe80/10'),
  multicast: v6Range('ff00::/8', 'IPv6 multicast ff00/8'),
};

function inRange(v: bigint, r: Range): boolean {
  return v >= r.start && v <= r.end;
}

const RANGES: Array<{ v4?: Array<Range>; v6?: Array<Range> }> = [
  { v4: Object.values(V4), v6: Object.values(V6) },
];

/** Which named range does this IP fall into? (For honest error messages.) */
export function describeBlockedRange(ip: string): string {
  const v = ipToBigInt(ip);
  if (v === null) return 'not an IP';
  const isV4 = isIP(ip) === 4;
  for (const group of RANGES) {
    for (const r of isV4 ? group.v4 ?? [] : group.v6 ?? []) {
      if (inRange(v, r)) return r.name;
    }
  }
  return 'public';
}

export function isBlockedIp(ip: string): boolean {
  const v = ipToBigInt(ip);
  if (v === null) return true; // unparseable = blocked, fail closed
  const isV4 = isIP(ip) === 4;
  for (const group of RANGES) {
    for (const r of isV4 ? group.v4 ?? [] : group.v6 ?? []) {
      if (inRange(v, r)) return true;
    }
  }
  return false;
}

/** Literal-address host check (strip [] around v6). HostNAMES are resolved
 *  by the caller first — DNS decides for names. */
export function isBlockedHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '');
  if (isIP(h) === 0) return false; // not a literal — caller must resolve
  return isBlockedIp(h);
}
