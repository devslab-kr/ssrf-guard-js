import { SsrfGuardError } from './error.js';
import { UrlPolicy } from './policy.js';
import type { GuardErrorPayload, UrlPolicyOptions } from './types.js';

const GUIDANCE =
  'Refuse the request or ask the user for a different URL. Do not try alternate encodings, redirects, or private-network targets.';

export interface GuardToolInputOptions {
  /** Throw the `SsrfGuardError` instead of returning a JSON error payload. */
  throwOnViolation?: boolean;
  /**
   * Also scan for URLs embedded anywhere inside argument strings — a
   * `scheme://` URL or protocol-relative `//host` reference buried
   * mid-sentence ("summarize http://169.254.169.254/ please") is
   * extracted and validated like a whole-string URL. Off by default:
   * the base scanner only flags strings whose whole (trimmed) value is
   * a URL. Embedded scanning is strictly additive — everything the
   * base scanner flags stays flagged — and deliberately aggressive:
   * URL-shaped text inside prose or code snippets is validated against
   * the policy, so non-allowlisted hosts there count as violations.
   */
  scanEmbedded?: boolean;
}

export function guardToolInputJson(
  input: string | null | undefined,
  policy: UrlPolicyOptions | UrlPolicy,
  options: GuardToolInputOptions = {},
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
  options: GuardToolInputOptions = {},
): string | null {
  const urlPolicy = policy instanceof UrlPolicy ? policy : new UrlPolicy(policy);
  for (const candidate of collectUrlLikeStrings(input, options.scanEmbedded === true)) {
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
  options: GuardToolInputOptions = {},
): (input: Input) => Promise<Output | string> {
  return async (input: Input) => {
    const violation = guardToolInput(input, policy, options);
    if (violation) return violation;
    return handler(input);
  };
}

function collectUrlLikeStrings(value: unknown, scanEmbedded: boolean): string[] {
  const out: string[] = [];
  walk(value, out, scanEmbedded);
  return out;
}

// Any scheme followed by an authority (`scheme://`). Schemes without an
// authority (mailto:, urn:, data:) are not URL-fetch surfaces and stay ignored.
const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
// Protocol-relative `//authority` — only when the authority looks like a host
// (contains a dot or port, or is localhost), so `// plain comments` stay ignored.
const PROTOCOL_RELATIVE = /^\/\/(?:\[[^\]]+\]|[^\s/?#]*(?:\.|:)[^\s/?#]*|localhost)(?:[/?#]|$)/i;

// Embedded (`scanEmbedded`) counterparts. A `scheme://` URL can start
// anywhere in the string — even glued to preceding text, which fails
// closed as an unknown scheme rather than slipping past. The candidate
// runs to the first whitespace/quote/angle-bracket; prose punctuation
// stuck to the tail (`.com/docs.`, `(...)`) is trimmed afterwards.
const EMBEDDED_SCHEME_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>]+/gi;
// Embedded protocol-relative `//authority` — only at the start of the
// string or after whitespace/quote/bracket, so the `//` inside
// `scheme://` or a URL path never matches, and with the same
// host-looking authority requirement as the whole-string variant.
const EMBEDDED_PROTOCOL_RELATIVE =
  /(?<=^|[\s"'`<([{])\/\/(?:\[[^\s\]]+\]|[^\s/?#"'`<>]*(?:\.|:)[^\s/?#"'`<>]*|localhost)(?:[/?#][^\s"'`<>]*)?/gi;

function walk(value: unknown, out: string[], scanEmbedded: boolean): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (SCHEME_URL.test(trimmed)) {
      out.push(trimmed);
    } else if (PROTOCOL_RELATIVE.test(trimmed)) {
      // Validate the authority as if the URL resolves to https.
      out.push(`https:${trimmed}`);
    }
    if (scanEmbedded) collectEmbedded(value, out);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) walk(item, out, scanEmbedded);
    return;
  }

  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) walk(child, out, scanEmbedded);
  }
}

function collectEmbedded(value: string, out: string[]): void {
  for (const match of value.matchAll(EMBEDDED_SCHEME_URL)) {
    out.push(trimEmbeddedTail(match[0]));
  }
  for (const match of value.matchAll(EMBEDDED_PROTOCOL_RELATIVE)) {
    out.push(`https:${trimEmbeddedTail(match[0])}`);
  }
}

const CLOSING_BRACKETS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

// "see https://evil.example/x)." — the sentence's punctuation is not part
// of the URL. Closing brackets are only trimmed when unbalanced, so
// `https://en.example.org/wiki/Foo_(bar)` survives intact. Host-level
// policy decisions are unaffected either way — only the path can lose
// characters here.
function trimEmbeddedTail(candidate: string): string {
  let out = candidate;
  for (;;) {
    const last = out[out.length - 1];
    if (!last) return out;
    if ('.,;:!?\'"`'.includes(last)) {
      out = out.slice(0, -1);
      continue;
    }
    const opener = CLOSING_BRACKETS[last];
    if (opener && countChar(out, opener) < countChar(out, last)) {
      out = out.slice(0, -1);
      continue;
    }
    return out;
  }
}

function countChar(value: string, char: string): number {
  return value.split(char).length - 1;
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
