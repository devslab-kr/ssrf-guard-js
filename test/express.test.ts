import { describe, expect, it, vi } from 'vitest';
import { createExpressUrlGuard } from '../src/index.js';

describe('createExpressUrlGuard', () => {
  it('calls next when request URLs are allowed', () => {
    const middleware = createExpressUrlGuard({ exactHosts: ['api.example.com'] });
    const next = vi.fn();
    const res = { status: vi.fn(() => ({ json: vi.fn() })) };

    middleware({ body: { url: 'https://api.example.com/data' } }, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns a structured 400 when a blocked URL uses an uppercase scheme', () => {
    const middleware = createExpressUrlGuard({ exactHosts: ['api.example.com'] });
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };
    const next = vi.fn();

    middleware({ body: { url: 'HTTP://169.254.169.254/latest/meta-data/' } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'ssrf_blocked',
        reason: 'blocked_ip_literal',
      }),
    );
  });

  it('returns a structured 400 when request body contains a blocked URL', () => {
    const middleware = createExpressUrlGuard({ exactHosts: ['api.example.com'] });
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };
    const next = vi.fn();

    middleware({ body: { url: 'http://169.254.169.254/latest/meta-data/' } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'ssrf_blocked',
        reason: 'blocked_ip_literal',
      }),
    );
  });
});
