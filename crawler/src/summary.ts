/**
 * Pure formatting of a validated source configuration for the CLI. No
 * network, no filesystem — the crawl command's no-network guarantee is
 * structural: main.ts only loads the config and prints this summary.
 */
import type { SourceConfig } from './config.js';
import { CRAWLER_USER_AGENT } from './http-client.js';

/** Renders `Map` entries as indented `key: count` lines, insertion order. */
function countLines(counts: ReadonlyMap<string, number>): readonly string[] {
  return [...counts.entries()].map(([key, count]) => `  ${key}: ${String(count)}`);
}

/**
 * Formats a multi-line human-readable summary of a validated config: source
 * totals, per-host and per-pageKind counts (first-appearance order), the
 * fetch policy, the crawler User-Agent, and an explicit no-network closer.
 */
export function formatConfigSummary(config: SourceConfig): string {
  const hostCounts = new Map<string, number>();
  const pageKindCounts = new Map<string, number>();
  for (const source of config.sources) {
    const host = new URL(source.url).hostname;
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
    pageKindCounts.set(source.pageKind, (pageKindCounts.get(source.pageKind) ?? 0) + 1);
  }
  const { timeoutMs, maxRetries, concurrency, minRequestIntervalMs } = config.fetch;
  return [
    `Sources: ${String(config.sources.length)}`,
    'Per host:',
    ...countLines(hostCounts),
    'Per page kind:',
    ...countLines(pageKindCounts),
    `Fetch policy: timeoutMs=${String(timeoutMs)} maxRetries=${String(maxRetries)} concurrency=${String(concurrency)} minRequestIntervalMs=${String(minRequestIntervalMs)}`,
    `User-Agent: ${CRAWLER_USER_AGENT}`,
    'Config validated. Live fetching is wired into pnpm crawl in issue #5 — no network requests were made.',
  ].join('\n');
}
