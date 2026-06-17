import { guardToolInput } from './tool-input.js';
import type { UrlPolicyOptions } from './types.js';
import { UrlPolicy } from './policy.js';

export interface MinimalExpressRequest {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

export interface MinimalExpressResponse {
  status(code: number): {
    json(body: unknown): unknown;
  };
}

export type MinimalExpressNext = (error?: unknown) => void;

export interface ExpressGuardOptions {
  body?: boolean;
  query?: boolean;
  params?: boolean;
  statusCode?: number;
}

export function createExpressUrlGuard(
  policy: UrlPolicyOptions | UrlPolicy,
  options: ExpressGuardOptions = {},
): (req: MinimalExpressRequest, res: MinimalExpressResponse, next: MinimalExpressNext) => void {
  const scanBody = options.body ?? true;
  const scanQuery = options.query ?? true;
  const scanParams = options.params ?? false;
  const statusCode = options.statusCode ?? 400;

  return (req, res, next) => {
    const candidates: unknown[] = [];
    if (scanBody) candidates.push(req.body);
    if (scanQuery) candidates.push(req.query);
    if (scanParams) candidates.push(req.params);

    for (const candidate of candidates) {
      const violation = guardToolInput(candidate, policy);
      if (violation) {
        res.status(statusCode).json(JSON.parse(violation));
        return;
      }
    }

    next();
  };
}
