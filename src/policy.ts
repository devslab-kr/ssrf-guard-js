import { SsrfGuardError } from './error.js';
import { HostPolicy } from './host-policy.js';
import { looksLikeIpLiteral, normalizeHost } from './net.js';
import type { NormalizedUrlPolicy, UrlPolicyOptions } from './types.js';

const DEFAULT_ALLOWED_SCHEMES = ['http', 'https'] as const;
const DEFAULT_ALLOWED_PORTS = [-1, 80, 443] as const;

export class UrlPolicy {
  readonly options: NormalizedUrlPolicy;
  readonly hostPolicy: HostPolicy;

  constructor(options: UrlPolicyOptions = {}) {
    this.hostPolicy = new HostPolicy(options.exactHosts ?? [], options.suffixes ?? []);
    this.options = Object.freeze({
      exactHosts: this.hostPolicy.exactHosts,
      suffixes: this.hostPolicy.suffixes,
      allowedSchemes: new Set((options.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES).map((scheme) => scheme.toLowerCase())),
      allowedPorts: new Set(options.allowedPorts ?? DEFAULT_ALLOWED_PORTS),
      rejectIpLiteralHosts: options.rejectIpLiteralHosts ?? true,
      rejectUserInfo: options.rejectUserInfo ?? true,
      blockPrivateNetworks: options.blockPrivateNetworks ?? true,
    });
  }

  validate(input: string | URL): URL {
    const url = toUrl(input);
    const scheme = url.protocol.replace(/:$/, '').toLowerCase();
    const host = normalizeHost(url.hostname);

    if (this.options.rejectUserInfo && (url.username || url.password)) {
      throw new SsrfGuardError('blocked_userinfo', 'URL must not contain userinfo (user:pass@)', {
        scheme,
        host,
        url: url.toString(),
      });
    }

    if (!this.options.allowedSchemes.has(scheme)) {
      throw new SsrfGuardError('blocked_scheme', `Blocked scheme: ${scheme}`, {
        scheme,
        host,
        url: url.toString(),
      });
    }

    if (!host) {
      throw new SsrfGuardError('blocked_host', 'URL is missing a host', {
        scheme,
        host,
        url: url.toString(),
      });
    }

    if (this.options.rejectIpLiteralHosts && looksLikeIpLiteral(host)) {
      throw new SsrfGuardError('blocked_ip_literal', `IP-literal host blocked: ${host}`, {
        scheme,
        host,
        url: url.toString(),
      });
    }

    if (!this.hostPolicy.allows(host)) {
      throw new SsrfGuardError('blocked_host', `Host not allowed: ${host}`, {
        scheme,
        host,
        url: url.toString(),
      });
    }

    const port = url.port === '' ? -1 : Number(url.port);
    if (!this.options.allowedPorts.has(port)) {
      throw new SsrfGuardError('blocked_port', `Blocked port: ${port}`, {
        scheme,
        host,
        url: url.toString(),
      });
    }

    return url;
  }
}

export function validateUrl(input: string | URL, policy: UrlPolicyOptions | UrlPolicy = {}): URL {
  return policy instanceof UrlPolicy ? policy.validate(input) : new UrlPolicy(policy).validate(input);
}

function toUrl(input: string | URL): URL {
  if (input instanceof URL) return input;
  try {
    return new URL(input);
  } catch (error) {
    throw new SsrfGuardError('blocked_other', `Invalid URL: ${input}`, {
      url: input,
    });
  }
}
