import { describe, expect, it } from 'vitest';

import shippedSources from '../config/sources.json' with { type: 'json' };
import { parseSourceConfig } from './config.js';
import { CRAWLER_USER_AGENT } from './http-client.js';
import { formatConfigSummary } from './summary.js';

describe('formatConfigSummary', () => {
  const summary = formatConfigSummary(parseSourceConfig(shippedSources));

  it('reports the source total and per-host counts', () => {
    expect(summary).toContain('Sources: 6');
    expect(summary).toContain('  www.cloudflare.com: 5');
    expect(summary).toContain('  developers.cloudflare.com: 1');
  });

  it('reports per-pageKind counts', () => {
    expect(summary).toContain('  marketing-overview: 2');
    expect(summary).toContain('  marketing-product: 2');
    expect(summary).toContain('  marketing-solution: 1');
    expect(summary).toContain('  developer-docs: 1');
  });

  it('echoes the fetch policy knobs', () => {
    expect(summary).toContain(
      'Fetch policy: timeoutMs=10000 maxRetries=2 concurrency=2 minRequestIntervalMs=1000',
    );
  });

  it('echoes the identifiable crawler User-Agent', () => {
    expect(summary).toContain(`User-Agent: ${CRAWLER_USER_AGENT}`);
  });

  it('closes with the explicit no-network guarantee', () => {
    expect(
      summary.endsWith(
        'Config validated. Live fetching is wired into pnpm crawl in issue #5 — no network requests were made.',
      ),
    ).toBe(true);
  });
});
