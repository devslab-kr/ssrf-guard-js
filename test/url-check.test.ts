import { describe, expect, it } from 'vitest';
import {
  checkUrl,
  isUrlAllowed,
  sameSitePolicy,
  SsrfGuardError,
  UrlPolicy,
  validateUrl,
} from '../src/index.js';

const policy = { exactHosts: ['api.example.com'], allowedSchemes: ['https'] };

describe('checkUrl', () => {
  it('returns the parsed URL when the policy allows it', () => {
    const result = checkUrl('https://api.example.com/v1', policy);
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.url.href).toBe('https://api.example.com/v1');
  });

  it('reports a blocked host without throwing', () => {
    const result = checkUrl('https://evil.example/steal', policy);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.error).toBeInstanceOf(SsrfGuardError);
      expect(result.error.reason).toBe('blocked_host');
    }
  });

  it('reports an unparseable URL as a result, not an exception', () => {
    const result = checkUrl('not a url', policy);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.error.reason).toBe('blocked_other');
  });

  it('fails closed on an empty policy, like every other entry point', () => {
    expect(isUrlAllowed('https://anywhere.example/')).toBe(false);
  });

  it('accepts a prebuilt UrlPolicy', () => {
    const built = new UrlPolicy(policy);
    expect(checkUrl('https://api.example.com/', built).allowed).toBe(true);
    expect(built.check('https://evil.example/').allowed).toBe(false);
  });

  // The reason this API exists: callers were hand-rolling host comparisons
  // that drifted from the guard. Whatever validateUrl decides, checkUrl must
  // decide identically — including for the cases nobody thinks to mirror.
  it.each([
    ['https://api.example.com/v1', true],
    ['https://API.EXAMPLE.COM/v1', true],
    ['https://api.example.com:443/v1', true],
    ['https://api.example.com:8443/v1', false],
    ['http://api.example.com/v1', false],
    ['HTTPS://api.example.com/v1', true],
    ['https://user:pass@api.example.com/v1', false],
    ['https://sub.api.example.com/v1', false],
    ['https://169.254.169.254/latest/meta-data/', false],
    ['file:///etc/passwd', false],
    ['//api.example.com/v1', false],
    ['', false],
  ])('agrees with validateUrl on %s', (input, expected) => {
    let threw: SsrfGuardError | null = null;
    try {
      validateUrl(input, policy);
    } catch (error) {
      threw = error as SsrfGuardError;
    }

    const result = checkUrl(input, policy);
    expect(result.allowed).toBe(expected);
    expect(result.allowed).toBe(threw === null);
    if (!result.allowed && threw) expect(result.error.reason).toBe(threw.reason);
  });

  // The concrete case from the AskLinq crawler: a hand-written
  // `target.hostname !== base.hostname` drops the apex <-> www links that
  // sameSitePolicy — and therefore the fetch guard — would have allowed.
  it('accepts the apex <-> www links a hostname comparison would drop', () => {
    const entry = 'https://www.customer-site.example/about';
    const site = sameSitePolicy(entry, { allowedSchemes: ['https'] });

    expect(isUrlAllowed('https://customer-site.example/pricing', site)).toBe(true);
    expect(isUrlAllowed('https://www.customer-site.example/pricing', site)).toBe(true);
    expect(isUrlAllowed('https://blog.customer-site.example/post', site)).toBe(true);
    expect(isUrlAllowed('https://other-site.example/', site)).toBe(false);

    // ...which is exactly what the naive check gets wrong.
    const base = new URL(entry);
    expect(new URL('https://customer-site.example/pricing').hostname !== base.hostname).toBe(true);
  });
});
