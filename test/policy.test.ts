import { describe, expect, it } from 'vitest';
import { SsrfGuardError, UrlPolicy, validateUrl } from '../src/index.js';

function policy(overrides: ConstructorParameters<typeof UrlPolicy>[0] = {}): UrlPolicy {
  return new UrlPolicy({
    exactHosts: ['api.example.com'],
    ...overrides,
  });
}

describe('UrlPolicy', () => {
  it('permits whitelisted HTTPS URLs', () => {
    expect(() => policy().validate('https://api.example.com/v1/data')).not.toThrow();
  });

  it('rejects blocked schemes', () => {
    expect(() => policy().validate('file:///etc/passwd')).toThrow(SsrfGuardError);
    try {
      policy().validate('file:///etc/passwd');
    } catch (error) {
      expect(error).toMatchObject({ reason: 'blocked_scheme' });
    }
  });

  it('rejects non-whitelisted hosts', () => {
    expect(() => policy().validate('https://evil.com/')).toThrow(
      expect.objectContaining({ reason: 'blocked_host' }),
    );
  });

  it('rejects blocked ports', () => {
    expect(() => policy().validate('https://api.example.com:8080/')).toThrow(
      expect.objectContaining({ reason: 'blocked_port' }),
    );
  });

  it('treats portless URLs as the scheme default port', () => {
    const httpsOnly = policy({ allowedPorts: [443] });
    expect(() => httpsOnly.validate('https://api.example.com/')).not.toThrow();
    expect(() => httpsOnly.validate('http://api.example.com/')).toThrow(
      expect.objectContaining({ reason: 'blocked_port' }),
    );

    const httpOnly = policy({ allowedPorts: [80] });
    expect(() => httpOnly.validate('http://api.example.com/')).not.toThrow();
  });

  it('preserves the original parse error as cause on invalid URLs', () => {
    try {
      policy().validate('not a url at all');
      expect.unreachable('expected validate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SsrfGuardError);
      expect((error as SsrfGuardError).reason).toBe('blocked_other');
      expect((error as SsrfGuardError).cause).toBeDefined();
    }
  });

  it.each([
    'http://127.0.0.1/',
    'http://0.0.0.0/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://127.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fe80::1]/',
  ])('rejects IP literal form %s', (url) => {
    expect(() => policy().validate(url)).toThrow(
      expect.objectContaining({ reason: expect.stringMatching(/^blocked_(ip_literal|host)$/) }),
    );
  });

  it('rejects userinfo', () => {
    expect(() => policy().validate('https://user:pass@api.example.com/')).toThrow(
      expect.objectContaining({ reason: 'blocked_userinfo' }),
    );
  });

  it('allows userinfo when disabled', () => {
    expect(() => policy({ rejectUserInfo: false }).validate('https://user:pass@api.example.com/')).not.toThrow();
  });

  it('allows whitelisted IP literal when disabled', () => {
    const ipPolicy = new UrlPolicy({
      exactHosts: ['203.0.113.5'],
      rejectIpLiteralHosts: false,
    });
    expect(() => ipPolicy.validate('http://203.0.113.5/')).not.toThrow();
  });

  it('exports validateUrl convenience helper', () => {
    expect(validateUrl('https://api.example.com/', { exactHosts: ['api.example.com'] })).toBeInstanceOf(URL);
  });
});
