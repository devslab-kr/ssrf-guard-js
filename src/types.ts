export type BlockReason =
  | 'blocked_scheme'
  | 'blocked_host'
  | 'blocked_port'
  | 'blocked_ip_literal'
  | 'blocked_userinfo'
  | 'blocked_private_ip'
  | 'blocked_redirect'
  | 'blocked_response_size'
  | 'blocked_other';

export interface UrlPolicyOptions {
  exactHosts?: readonly string[];
  suffixes?: readonly string[];
  allowedSchemes?: readonly string[];
  allowedPorts?: readonly number[];
  rejectIpLiteralHosts?: boolean;
  rejectUserInfo?: boolean;
  blockPrivateNetworks?: boolean;
}

export interface NormalizedUrlPolicy {
  exactHosts: readonly string[];
  suffixes: readonly string[];
  allowedSchemes: ReadonlySet<string>;
  allowedPorts: ReadonlySet<number>;
  rejectIpLiteralHosts: boolean;
  rejectUserInfo: boolean;
  blockPrivateNetworks: boolean;
}

export interface GuardErrorPayload {
  error: 'ssrf_blocked';
  reason: BlockReason;
  url: string;
  message: string;
  guidance: string;
}
