import { hostMatches, normalizeHost } from './net.js';

export class HostPolicy {
  readonly exactHosts: readonly string[];
  readonly suffixes: readonly string[];

  constructor(exactHosts: readonly (string | null | undefined)[] = [], suffixes: readonly (string | null | undefined)[] = []) {
    this.exactHosts = normalizeList(exactHosts);
    this.suffixes = normalizeList(suffixes);
  }

  static empty(): HostPolicy {
    return new HostPolicy();
  }

  allows(host: string | null | undefined): boolean {
    return hostMatches(host, this.exactHosts, this.suffixes);
  }
}

function normalizeList(values: readonly (string | null | undefined)[]): readonly string[] {
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeHost(value);
    if (normalized) out.push(normalized);
  }
  return Object.freeze(out);
}
