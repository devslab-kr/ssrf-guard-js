import { SsrfGuardError } from './error.js';
import { UrlPolicy } from './policy.js';
import type { GuardErrorPayload, UrlPolicyOptions } from './types.js';

const GUIDANCE =
  'Refuse the request or ask the user for a different URL. Do not try alternate encodings, redirects, or private-network targets.';

export function guardToolInputJson(
  input: string | null | undefined,
  policy: UrlPolicyOptions | UrlPolicy,
  options: { throwOnViolation?: boolean } = {},
): string | null {
  if (input == null || input.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }

  return guardToolInput(parsed, policy, options);
}

export function guardToolInput(
  input: unknown,
  policy: UrlPolicyOptions | UrlPolicy,
  options: { throwOnViolation?: boolean } = {},
): string | null {
  const urlPolicy = policy instanceof UrlPolicy ? policy : new UrlPolicy(policy);
  for (const candidate of collectUrlLikeStrings(input)) {
    try {
      urlPolicy.validate(candidate);
    } catch (error) {
      if (error instanceof SsrfGuardError) {
        if (options.throwOnViolation) throw error;
        return JSON.stringify(formatErrorPayload(error, candidate));
      }
      throw error;
    }
  }

  return null;
}

export function createGuardedToolHandler<Input, Output>(
  policy: UrlPolicyOptions | UrlPolicy,
  handler: (input: Input) => Output | Promise<Output>,
  options: { throwOnViolation?: boolean } = {},
): (input: Input) => Promise<Output | string> {
  return async (input: Input) => {
    const violation = guardToolInput(input, policy, options);
    if (violation) return violation;
    return handler(input);
  };
}

function collectUrlLikeStrings(value: unknown): string[] {
  const out: string[] = [];
  walk(value, out);
  return out;
}

function walk(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) out.push(trimmed);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) walk(item, out);
    return;
  }

  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) walk(child, out);
  }
}

function formatErrorPayload(error: SsrfGuardError, url: string): GuardErrorPayload {
  return {
    error: 'ssrf_blocked',
    reason: error.reason,
    url,
    message: error.message,
    guidance: GUIDANCE,
  };
}
