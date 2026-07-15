import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CrawlError } from '../errors.js';
import { parseDeveloperDocs } from './developer-docs.js';
import { parseHtml } from './html.js';
import type { PageMeta } from './types.js';

const URL_UNDER_TEST = 'https://developers.cloudflare.com/directory/';
const RETRIEVED_AT = '2026-07-01T00:00:00.000Z';

const META: PageMeta = {
  sourceId: 'developers-docs-directory',
  url: URL_UNDER_TEST,
  retrievedAt: RETRIEVED_AT,
};

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('parseDeveloperDocs', () => {
  it('parses the valid fixture into the full expected page (hrefs resolved absolute)', () => {
    // The fixture carries three nav-chrome decoy anchors inside main (no
    // span, no p; one external github.com href) mirroring the live
    // site-header links — they must be skipped, so the entry set below stays
    // exactly the three genuine cards.
    const page = parseHtml(fixture('developer-docs-directory.html'));
    expect(parseDeveloperDocs(page, META)).toEqual({
      sourceId: 'developers-docs-directory',
      canonicalUrl: 'https://developers.cloudflare.com/directory/',
      title: 'Docs directory | Cloudflare Docs',
      description: 'Explore the different areas of our documentation site.',
      retrievedAt: RETRIEVED_AT,
      kind: 'developer-docs',
      entries: [
        {
          name: 'Workers',
          summary:
            'Build, deploy, and scale serverless applications globally with low latency and minimal configuration',
          href: 'https://developers.cloudflare.com/workers/',
        },
        {
          name: 'Cache',
          summary: 'Make websites faster by caching content across our global server network',
          href: 'https://developers.cloudflare.com/cache/',
        },
        {
          name: 'Email Security',
          summary: 'Stop phishing and business email compromise',
          href: 'https://developers.cloudflare.com/cloudflare-one/email-security/',
        },
      ],
    });
  });

  it('skips nav-chrome anchors silently: the decoys mint no entries', () => {
    const page = parseHtml(fixture('developer-docs-directory.html'));
    const parsed = parseDeveloperDocs(page, META);
    expect(parsed.entries).toHaveLength(3);
    expect(parsed.entries.map((entry) => entry.href)).not.toContain(
      'https://github.com/cloudflare',
    );
  });

  it('errors at stage parse naming the name span when an entry has no name', () => {
    const page = parseHtml(fixture('developer-docs-directory-missing-name.html'));
    const caught = captureError(() => parseDeveloperDocs(page, META));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('parse');
      expect(caught.url).toBe(URL_UNDER_TEST);
      expect(caught.message).toContain('span (entry name)');
    }
  });
});
