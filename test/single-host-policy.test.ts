import { describe, expect, it, vi } from 'vitest';
import {
  guardedFetch,
  isUrlAllowed,
  sameSitePolicy,
  singleHostPolicy,
  SsrfGuardError,
} from '../src/index.js';
import type { FetchImpl } from '../src/index.js';

describe('singleHostPolicy', () => {
  it('allows the base URL it was derived from', () => {
    const base = 'https://api.example.com/v1/things';
    expect(isUrlAllowed(base, singleHostPolicy(base))).toBe(true);
  });

  it('locks the host — no subdomains, no www peer', () => {
    const policy = singleHostPolicy('https://api.example.com/v1');
    expect(isUrlAllowed('https://api.example.com/other', policy)).toBe(true);
    expect(isUrlAllowed('https://www.api.example.com/v1', policy)).toBe(false);
    expect(isUrlAllowed('https://evil.api.example.com/v1', policy)).toBe(false);
    expect(isUrlAllowed('https://example.com/v1', policy)).toBe(false);
  });

  it('locks the scheme', () => {
    const policy = singleHostPolicy('https://api.example.com/v1');
    expect(isUrlAllowed('http://api.example.com/v1', policy)).toBe(false);
  });

  // The reason the port is part of this and not left to the defaults: a
  // hand-written { exactHosts: [u.hostname] } rejects its own base URL on
  // a non-standard port, because the default allowedPorts is [-1, 80, 443].
  it('allows a non-standard port when the base URL has one', () => {
    const base = 'https://api.example.com:8443/v1';
    const policy = singleHostPolicy(base);
    expect(isUrlAllowed(base, policy)).toBe(true);
    expect(isUrlAllowed('https://api.example.com/v1', policy)).toBe(false);
    expect(isUrlAllowed('https://api.example.com:9000/v1', policy)).toBe(false);
  });

  it('treats a portless base as the scheme default, both ways round', () => {
    const policy = singleHostPolicy('https://api.example.com/v1');
    expect(isUrlAllowed('https://api.example.com:443/v1', policy)).toBe(true);
    expect(isUrlAllowed('https://api.example.com:8443/v1', policy)).toBe(false);

    const plain = singleHostPolicy('http://api.example.com/v1');
    expect(isUrlAllowed('http://api.example.com:80/v1', plain)).toBe(true);
  });

  it('keeps the package defaults — private hosts and userinfo still rejected', () => {
    expect(isUrlAllowed('http://127.0.0.1:8080/', singleHostPolicy('http://127.0.0.1:8080/'))).toBe(
      false,
    );
    const policy = singleHostPolicy('https://api.example.com/v1');
    expect(isUrlAllowed('https://user:pass@api.example.com/v1', policy)).toBe(false);
  });

  it('merges overrides, and host lists widen rather than replace', () => {
    const policy = singleHostPolicy('https://api.example.com/v1', {
      exactHosts: ['cdn.example.com'],
    });
    expect(isUrlAllowed('https://api.example.com/v1', policy)).toBe(true);
    expect(isUrlAllowed('https://cdn.example.com/asset', policy)).toBe(true);
  });

  it('rejects an unparseable or hostless input', () => {
    expect(() => singleHostPolicy('not a url')).toThrow(SsrfGuardError);
    expect(() => singleHostPolicy('mailto:hi@example.com')).toThrow(SsrfGuardError);
  });

  // The distinction between the two helpers, stated as a test so it
  // cannot quietly erode: one is for a submitted site, one for a known
  // endpoint.
  it('is strictly tighter than sameSitePolicy for the same URL', () => {
    const url = 'https://api.example.com/v1';
    const site = sameSitePolicy(url);
    const single = singleHostPolicy(url);

    // sameSitePolicy matches by suffix, so subdomains of the submitted
    // host come along; singleHostPolicy is the exact origin and nothing else.
    expect(isUrlAllowed('https://sub.api.example.com/x', site)).toBe(true);
    expect(isUrlAllowed('https://sub.api.example.com/x', single)).toBe(false);

    // Neither opens an unrelated host.
    expect(isUrlAllowed('https://other.example.com/x', site)).toBe(false);
    expect(isUrlAllowed('https://other.example.com/x', single)).toBe(false);
  });

  it('holds across redirects, not just the first request', async () => {
    const fetchImpl: FetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }),
    );

    await expect(
      guardedFetch('https://api.example.com/v1', singleHostPolicy('https://api.example.com/v1'), {
        fetchImpl,
      }),
    ).rejects.toMatchObject({ reason: 'blocked_redirect' });
  });
});
