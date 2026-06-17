import { describe, expect, it, vi } from 'vitest';
import { ssrfGuardVitePlugin } from '../src/vite.js';

type ViteHandler = Parameters<
  Parameters<ReturnType<typeof ssrfGuardVitePlugin>['configureServer']>[0]['middlewares']['use']
>[0];

describe('ssrfGuardVitePlugin', () => {
  it('passes through requests without guarded query params', () => {
    let handler!: ViteHandler;
    const plugin = ssrfGuardVitePlugin({ policy: { exactHosts: ['api.example.com'] } });
    plugin.configureServer({
      middlewares: {
        use: (fn) => {
          handler = fn;
        },
      },
    });

    const next = vi.fn();
    const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
    handler({ url: '/src/main.ts?import' }, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.end).not.toHaveBeenCalled();
  });

  it('blocks guarded query param URLs', () => {
    let handler!: ViteHandler;
    const plugin = ssrfGuardVitePlugin({
      policy: { exactHosts: ['api.example.com'] },
      routes: ['/api/crawl'],
    });
    plugin.configureServer({
      middlewares: {
        use: (fn) => {
          handler = fn;
        },
      },
    });

    const next = vi.fn();
    const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
    handler({ url: '/api/crawl?url=http://169.254.169.254/latest/meta-data/' }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.setHeader).toHaveBeenCalledWith('content-type', 'application/json; charset=utf-8');
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('"error":"ssrf_blocked"'));
  });
});
