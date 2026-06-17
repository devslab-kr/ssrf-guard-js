import type { BlockReason } from './types.js';

export class SsrfGuardError extends Error {
  readonly reason: BlockReason;
  readonly scheme: string | null;
  readonly host: string | null;
  readonly url: string | null;

  constructor(
    reason: BlockReason,
    message: string,
    options: { scheme?: string | null; host?: string | null; url?: string | null } = {},
  ) {
    super(message);
    this.name = 'SsrfGuardError';
    this.reason = reason;
    this.scheme = options.scheme ?? null;
    this.host = options.host ?? null;
    this.url = options.url ?? null;
  }
}
