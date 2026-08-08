import { describe, expect, it } from 'vitest';
import {
  hostMatches,
  isPrivateOrLocalIp,
  looksLikeIpLiteral,
  normalizeHost,
} from '../src/index.js';

describe('hostMatches', () => {
  it('matches exact hosts case-insensitively', () => {
    expect(hostMatches('API.partner.com', ['api.partner.com'], [])).toBe(true);
    expect(hostMatches('api.partner.com', ['API.partner.com'], [])).toBe(true);
  });

  it('normalizes IDN hosts on both sides', () => {
    expect(hostMatches('café.example.com', ['xn--caf-dma.example.com'], [])).toBe(true);
    expect(hostMatches('CAFÉ.example.com', ['café.example.com'], [])).toBe(true);
  });

  it('matches suffixes only on label boundaries', () => {
    expect(hostMatches('api.partner.example.com', [], ['example.com'])).toBe(true);
    expect(hostMatches('example.com', [], ['example.com'])).toBe(true);
    expect(hostMatches('badexample.com', [], ['example.com'])).toBe(false);
    expect(hostMatches('example.com.evil.tld', [], ['example.com'])).toBe(false);
  });

  it('strips trailing dots', () => {
    expect(hostMatches('example.com.', ['example.com'], [])).toBe(true);
    expect(hostMatches('api.partner.example.com.', [], ['example.com'])).toBe(true);
  });
});

describe('isPrivateOrLocalIp', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.255.255',
    '169.254.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.255',
    '198.18.0.1',
    '198.19.255.255',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
  ])('blocks private/local IPv4 %s', (ip) => {
    expect(isPrivateOrLocalIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '13.107.6.152', '172.217.0.0', '192.0.2.1'])(
    'allows public IPv4 %s',
    (ip) => {
      expect(isPrivateOrLocalIp(ip)).toBe(false);
    },
  );

  it.each(['::1', 'fe80::1', 'fc00::1', 'fd00::1', 'ff00::1'])('blocks private/local IPv6 %s', (ip) => {
    expect(isPrivateOrLocalIp(ip)).toBe(true);
  });

  // Both found by the JVM-sibling parity audit: the Java side catches
  // these through InetAddress.isAnyLocalAddress() / isSiteLocalAddress(),
  // and this side classified them as public.
  it('blocks the unspecified address, like 0.0.0.0', () => {
    expect(isPrivateOrLocalIp('::')).toBe(true);
    expect(isPrivateOrLocalIp('0.0.0.0')).toBe(true);
  });

  it.each(['fec0::1', 'feff:ffff::1'])('blocks deprecated IPv6 site-local %s', (ip) => {
    expect(isPrivateOrLocalIp(ip)).toBe(true);
  });

  // fe80::/10 and fec0::/10 differ only in the two bits this masks, so a
  // wrong mask would swallow the whole fe00::/8 block. 2001:db8:: also
  // starts with 0x20, guarding the 6to4 branch next door.
  it('does not over-reach into neighbouring IPv6 space', () => {
    expect(isPrivateOrLocalIp('fe00::1')).toBe(false);
    expect(isPrivateOrLocalIp('fe40::1')).toBe(false);
    expect(isPrivateOrLocalIp('2001:db8::1')).toBe(false);
  });

  it('blocks IPv4-mapped IPv6 private addresses', () => {
    expect(isPrivateOrLocalIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalIp('::ffff:10.0.0.5')).toBe(true);
    expect(isPrivateOrLocalIp('::ffff:169.254.169.254')).toBe(true);
  });

  it('blocks 6to4 addresses that wrap private IPv4', () => {
    expect(isPrivateOrLocalIp('2002:0a00:0001::')).toBe(true);
  });

  it('allows public IPv6', () => {
    expect(isPrivateOrLocalIp('2606:4700:4700::1111')).toBe(false);
  });
});

describe('looksLikeIpLiteral', () => {
  it.each([
    '127.0.0.1',
    '0.0.0.0',
    '2130706433',
    '0x7f000001',
    '0x7f.0.0.1',
    '0177.0.0.1',
    '127.1',
    '::1',
    '[::1]',
    '[::ffff:127.0.0.1]',
    'fe80::1',
  ])('detects %s as an IP literal', (host) => {
    expect(looksLikeIpLiteral(host)).toBe(true);
  });

  it.each(['example.com', 'api.partner.example.com', 'xn--caf-dma.example.com', 'localhost', 'host-with-dashes.com'])(
    'does not treat %s as an IP literal',
    (host) => {
      expect(looksLikeIpLiteral(host)).toBe(false);
    },
  );
});

describe('normalizeHost', () => {
  it.each([
    ['example.com', 'example.com'],
    ['EXAMPLE.com', 'example.com'],
    ['example.com.', 'example.com'],
    ['[::1]', '::1'],
    ['[2001:db8::1]', '2001:db8::1'],
    ['  example.com  ', 'example.com'],
    ['café.example.com', 'xn--caf-dma.example.com'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });
});
