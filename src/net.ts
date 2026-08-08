import { domainToASCII } from 'node:url';
import ipaddr from 'ipaddr.js';

export function normalizeHost(host: string | null | undefined): string | null {
  if (host == null) return null;
  let value = host.trim();
  if (value.length === 0) return value;

  if (value.startsWith('[') && value.endsWith(']') && value.length > 2) {
    value = value.slice(1, -1);
  }

  if (value.endsWith('.') && value.length > 1) {
    value = value.slice(0, -1);
  }

  if (looksLikeIpLiteral(value)) {
    return value.toLowerCase();
  }

  const ascii = domainToASCII(value);
  return (ascii || value).toLowerCase();
}

export function hostMatches(
  host: string | null | undefined,
  exactHosts: Iterable<string>,
  suffixes: Iterable<string>,
): boolean {
  const normalized = normalizeHost(host);
  if (!normalized) return false;

  for (const exact of exactHosts) {
    if (normalized === normalizeHost(exact)) return true;
  }

  for (const suffix of suffixes) {
    const normalizedSuffix = normalizeHost(suffix);
    if (!normalizedSuffix) continue;
    if (normalized === normalizedSuffix || normalized.endsWith(`.${normalizedSuffix}`)) {
      return true;
    }
  }

  return false;
}

export function looksLikeIpLiteral(host: string | null | undefined): boolean {
  if (!host) return false;
  const value = host.trim();
  if (value.startsWith('[') && value.endsWith(']')) return true;
  if (value.includes(':')) return true;
  if (/^\d+$/.test(value)) return true;
  if (/^0[xX][0-9a-fA-F.]+$/.test(value)) return true;
  if (/^0[0-9.]+$/.test(value)) return true;
  return /^\d{1,3}(\.\d{1,3}){1,3}$/.test(value);
}

export function isPrivateOrLocalIp(input: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(input);
  } catch {
    return false;
  }

  if (parsed.kind() === 'ipv4') {
    return isPrivateIpv4(parsed.toByteArray());
  }

  const ipv6 = parsed as ipaddr.IPv6;
  if (ipv6.isIPv4MappedAddress()) {
    return isPrivateIpv4(ipv6.toIPv4Address().toByteArray());
  }

  const bytes = ipv6.toByteArray();
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isPrivateIpv4(bytes.slice(2, 6));
  }

  // `::1` loopback and `::` unspecified. Connecting to the unspecified
  // address reaches the local host, so it belongs here for the same
  // reason `0.0.0.0` does — the JVM sibling catches it through
  // `isAnyLocalAddress()`, and this side used to let it through.
  if (bytes.every((byte, index) => (index === bytes.length - 1 ? byte <= 0x01 : byte === 0x00))) {
    return true;
  }

  if ((bytes[0]! & 0xfe) === 0xfc) return true;
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true;
  // `fec0::/10` site-local. Deprecated by RFC 3879 and therefore easy to
  // leave out, but still routed on networks that predate the deprecation
  // — which is exactly where an internal address lives. The JVM sibling
  // catches it through `isSiteLocalAddress()`.
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) return true;
  if (bytes[0] === 0xff) return true;

  return false;
}

function isPrivateIpv4(bytes: readonly number[]): boolean {
  if (bytes.length !== 4) return false;
  const ip = (((bytes[0]! << 24) >>> 0) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  if (inRange(ip, 0x00000000, 8)) return true;
  if (inRange(ip, 0x0a000000, 8)) return true;
  if (inRange(ip, 0x64400000, 10)) return true;
  if (inRange(ip, 0x7f000000, 8)) return true;
  if (inRange(ip, 0xa9fe0000, 16)) return true;
  if (inRange(ip, 0xac100000, 12)) return true;
  if (inRange(ip, 0xc0a80000, 16)) return true;
  if (inRange(ip, 0xc6120000, 15)) return true;
  if (inRange(ip, 0xe0000000, 4)) return true;
  return ip === 0xffffffff;
}

function inRange(ip: number, base: number, prefixLength: number): boolean {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (ip & mask) === (base & mask);
}
