import { describe, expect, it } from 'vitest';
import { HostPolicy } from '../src/index.js';

describe('HostPolicy', () => {
  it('normalizes at construction', () => {
    const policy = new HostPolicy(['API.PARTNER.COM', 'café.example.com'], ['EXAMPLE.com.']);
    expect(policy.exactHosts).toEqual(expect.arrayContaining(['api.partner.com', 'xn--caf-dma.example.com']));
    expect(policy.suffixes).toEqual(['example.com']);
  });

  it('ignores null and empty entries', () => {
    const policy = new HostPolicy(['a.com', null, ''], [null, 'b.com']);
    expect(policy.exactHosts).toEqual(['a.com']);
    expect(policy.suffixes).toEqual(['b.com']);
  });

  it('matches exact hosts', () => {
    const policy = new HostPolicy(['api.example.com']);
    expect(policy.allows('api.example.com')).toBe(true);
    expect(policy.allows('v2.api.example.com')).toBe(false);
  });

  it('matches suffix subdomains on label boundaries', () => {
    const policy = new HostPolicy([], ['example.com']);
    expect(policy.allows('example.com')).toBe(true);
    expect(policy.allows('api.example.com')).toBe(true);
    expect(policy.allows('badexample.com')).toBe(false);
  });
});
