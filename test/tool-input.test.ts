import { describe, expect, it } from 'vitest';
import { createGuardedToolHandler, guardToolInput, guardToolInputJson, SsrfGuardError } from '../src/index.js';

const policy = { exactHosts: ['api.example.com'] };

describe('guardToolInputJson', () => {
  it('returns null for blank or non-JSON input', () => {
    expect(guardToolInputJson(null, policy)).toBeNull();
    expect(guardToolInputJson('', policy)).toBeNull();
    expect(guardToolInputJson('   ', policy)).toBeNull();
    expect(guardToolInputJson('not json at all', policy)).toBeNull();
  });

  it('allows input without URLs', () => {
    expect(guardToolInputJson('{"query":"weather today","limit":5}', policy)).toBeNull();
  });

  it('allows whitelisted top-level URLs', () => {
    expect(guardToolInputJson('{"url":"https://api.example.com/v1"}', policy)).toBeNull();
  });

  it('blocks metadata URLs with a structured error payload', () => {
    const error = guardToolInputJson('{"url":"http://169.254.169.254/latest/meta-data/"}', policy);
    expect(error).toContain('"error":"ssrf_blocked"');
    expect(error).toContain('"reason":"blocked_ip_literal"');
    expect(error).toContain('"url":"http://169.254.169.254/latest/meta-data/"');
    expect(error).toContain('"guidance":');
  });

  it('blocks nested URL fields', () => {
    const error = guardToolInputJson('{"request":{"target":"https://evil.com/"},"timeout":5}', policy);
    expect(error).toContain('"error":"ssrf_blocked"');
  });

  it('blocks URLs inside arrays', () => {
    const error = guardToolInputJson('{"urls":["https://api.example.com/ok","https://evil.com/bad"]}', policy);
    expect(error).toContain('"error":"ssrf_blocked"');
  });

  it('blocks obfuscated IP literals', () => {
    const error = guardToolInputJson('{"url":"http://2130706433/"}', policy);
    expect(error).toContain('"reason":"blocked_ip_literal"');
  });

  it('throws when configured to throw on violations', () => {
    expect(() => guardToolInputJson('{"url":"http://10.0.0.5/"}', policy, { throwOnViolation: true })).toThrow(
      SsrfGuardError,
    );
  });

  it('ignores non-http schemes', () => {
    expect(guardToolInputJson('{"to":"mailto:user@example.com"}', policy)).toBeNull();
    expect(guardToolInputJson('{"id":"urn:uuid:abc"}', policy)).toBeNull();
  });

  it('blocks uppercase and mixed-case scheme URLs', () => {
    const upper = guardToolInputJson('{"url":"HTTP://169.254.169.254/latest/meta-data/"}', policy);
    expect(upper).toContain('"error":"ssrf_blocked"');
    expect(upper).toContain('"reason":"blocked_ip_literal"');

    const mixed = guardToolInput({ url: 'Https://evil.com/' }, policy);
    expect(mixed).toContain('"error":"ssrf_blocked"');
  });

  it('still allows whitelisted URLs with uppercase schemes', () => {
    expect(guardToolInput({ url: 'HTTPS://api.example.com/v1' }, policy)).toBeNull();
  });

  it('guards plain object tool input', () => {
    const error = guardToolInput({ request: { target: 'https://evil.com/' } }, policy);
    expect(error).toContain('"error":"ssrf_blocked"');
  });

  it('wraps agent tool handlers', async () => {
    const handler = createGuardedToolHandler(policy, async (input: { url: string }) => `fetched ${input.url}`);

    await expect(handler({ url: 'https://api.example.com/data' })).resolves.toBe(
      'fetched https://api.example.com/data',
    );
    await expect(handler({ url: 'https://evil.com/data' })).resolves.toContain('"error":"ssrf_blocked"');
  });
});
