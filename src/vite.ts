import { UrlPolicy } from './policy.js';
import { guardToolInput } from './tool-input.js';
import type { UrlPolicyOptions } from './types.js';

export interface ViteSsrfGuardOptions {
  policy: UrlPolicyOptions | UrlPolicy;
  routes?: readonly string[];
  queryParams?: readonly string[];
  statusCode?: number;
}

export interface ViteConnectRequest {
  url?: string;
}

export interface ViteConnectResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

export type ViteConnectNext = () => void;

export interface ViteDevServerLike {
  middlewares: {
    use(handler: (req: ViteConnectRequest, res: ViteConnectResponse, next: ViteConnectNext) => void): void;
  };
}

export interface VitePluginLike {
  name: string;
  configureServer(server: ViteDevServerLike): void;
}

export function ssrfGuardVitePlugin(options: ViteSsrfGuardOptions): VitePluginLike {
  const routes = options.routes ?? ['/'];
  const queryParams = options.queryParams ?? ['url', 'target', 'uri', 'href'];
  const statusCode = options.statusCode ?? 400;

  return {
    name: 'ssrf-guard-js',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestUrl = req.url ?? '/';
        if (!matchesRoute(requestUrl, routes)) {
          next();
          return;
        }

        const params = new URL(requestUrl, 'http://vite.local').searchParams;
        const input: Record<string, string[]> = {};
        for (const key of queryParams) {
          const values = params.getAll(key).filter(Boolean);
          if (values.length > 0) input[key] = values;
        }

        const violation = guardToolInput(input, options.policy);
        if (!violation) {
          next();
          return;
        }

        res.statusCode = statusCode;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(violation);
      });
    },
  };
}

function matchesRoute(requestUrl: string, routes: readonly string[]): boolean {
  const pathname = new URL(requestUrl, 'http://vite.local').pathname;
  return routes.some((route) => route === '/' || pathname === route || pathname.startsWith(`${route}/`));
}
