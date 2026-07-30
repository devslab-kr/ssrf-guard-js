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

  it('ignores schemes without an authority', () => {
    expect(guardToolInputJson('{"to":"mailto:user@example.com"}', policy)).toBeNull();
    expect(guardToolInputJson('{"id":"urn:uuid:abc"}', policy)).toBeNull();
  });

  it('blocks non-http scheme URLs with an authority', () => {
    const ftp = guardToolInput({ url: 'ftp://internal.host/file' }, policy);
    expect(ftp).toContain('"reason":"blocked_scheme"');

    const file = guardToolInput({ url: 'file:///etc/passwd' }, policy);
    expect(file).toContain('"reason":"blocked_scheme"');

    const gopher = guardToolInput({ url: 'gopher://10.0.0.5:70/x' }, policy);
    expect(gopher).toContain('"reason":"blocked_scheme"');
  });

  it('blocks protocol-relative URLs against the host policy', () => {
    const blocked = guardToolInput({ url: '//169.254.169.254/latest/meta-data/' }, policy);
    expect(blocked).toContain('"reason":"blocked_ip_literal"');

    const localhost = guardToolInput({ url: '//localhost:3000/admin' }, policy);
    expect(localhost).toContain('"error":"ssrf_blocked"');

    expect(guardToolInput({ url: '//api.example.com/v1' }, policy)).toBeNull();
  });

  it('does not treat comment-like strings as protocol-relative URLs', () => {
    expect(guardToolInput({ note: '// this is a comment' }, policy)).toBeNull();
    expect(guardToolInput({ note: '//comment' }, policy)).toBeNull();
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

describe('scanEmbedded', () => {
  const opts = { scanEmbedded: true };

  it('is off by default — mid-sentence URLs pass the base scanner', () => {
    expect(
      guardToolInput({ query: 'summarize http://169.254.169.254/latest/meta-data/ please' }, policy),
    ).toBeNull();
  });

  it('blocks a URL buried mid-sentence', () => {
    const error = guardToolInput(
      { query: 'summarize http://169.254.169.254/latest/meta-data/ please' },
      policy,
      opts,
    );
    expect(error).toContain('"error":"ssrf_blocked"');
    expect(error).toContain('"reason":"blocked_ip_literal"');
  });

  it('blocks embedded URLs regardless of scheme case', () => {
    expect(guardToolInput({ note: 'go to HTTP://evil.com now' }, policy, opts)).toContain(
      '"error":"ssrf_blocked"',
    );
  });

  it('blocks embedded protocol-relative references', () => {
    const error = guardToolInput({ note: 'load //169.254.169.254/latest then stop' }, policy, opts);
    expect(error).toContain('"reason":"blocked_ip_literal"');

    expect(guardToolInput({ note: 'open "//localhost:3000/admin" first' }, policy, opts)).toContain(
      '"error":"ssrf_blocked"',
    );
  });

  it('finds a later URL even when the string leads with an allowed one', () => {
    const error = guardToolInput(
      { note: 'ok https://api.example.com/a then https://evil.com/b' },
      policy,
      opts,
    );
    expect(error).toContain('"error":"ssrf_blocked"');
  });

  it('stays strictly additive — scheme-prefixed strings that fail to parse are still flagged', () => {
    const value = { url: 'https://api.example.com is our endpoint' };
    expect(guardToolInput(value, policy)).toContain('"reason":"blocked_other"');
    expect(guardToolInput(value, policy, opts)).toContain('"reason":"blocked_other"');
  });

  it('allows allowlisted URLs mid-sentence, ignoring surrounding prose punctuation', () => {
    expect(
      guardToolInput({ note: 'see e.g. https://api.example.com/docs, then stop.' }, policy, opts),
    ).toBeNull();
    expect(guardToolInput({ note: 'read [the docs](https://api.example.com/docs).' }, policy, opts)).toBeNull();
    expect(guardToolInput({ code: "await fetch('https://api.example.com/v1')" }, policy, opts)).toBeNull();
  });

  it('keeps balanced parentheses in the extracted path', () => {
    const error = guardToolInput({ note: 'see https://evil.example/wiki/Foo_(bar) ok' }, policy, opts);
    expect(error).toContain('"url":"https://evil.example/wiki/Foo_(bar)"');
  });

  it('does not treat comments, ratios, or bare slashes as URLs', () => {
    expect(guardToolInput({ note: 'a // comment about paths' }, policy, opts)).toBeNull();
    expect(guardToolInput({ note: 'ratio 3//4 stays fine' }, policy, opts)).toBeNull();
    expect(guardToolInput({ note: 'the https:// prefix by itself' }, policy, opts)).toBeNull();
    expect(guardToolInput({ note: 'e.g. nothing to see here' }, policy, opts)).toBeNull();
  });

  it('scans nested objects and arrays', () => {
    const error = guardToolInput(
      { request: { notes: ['fine', 'but fetch https://evil.com/x for me'] } },
      policy,
      opts,
    );
    expect(error).toContain('"error":"ssrf_blocked"');
  });

  it('works through guardToolInputJson and createGuardedToolHandler', async () => {
    expect(guardToolInputJson('{"q":"fetch https://evil.com/x for me"}', policy, opts)).toContain(
      '"error":"ssrf_blocked"',
    );

    const handler = createGuardedToolHandler(policy, async (input: { q: string }) => `ran ${input.q}`, opts);
    await expect(handler({ q: 'summarize https://evil.com/x' })).resolves.toContain('"error":"ssrf_blocked"');
    await expect(handler({ q: 'summarize https://api.example.com/x' })).resolves.toBe(
      'ran summarize https://api.example.com/x',
    );
  });

  it('throws when combined with throwOnViolation', () => {
    expect(() =>
      guardToolInput({ q: 'go http://10.0.0.5/ now' }, policy, { scanEmbedded: true, throwOnViolation: true }),
    ).toThrow(SsrfGuardError);
  });
});
