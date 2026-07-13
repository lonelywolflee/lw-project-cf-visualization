import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CrawlError } from '../errors.js';
import { parseHtml } from './html.js';
import { parseSolutionsOverview } from './solutions-overview.js';
import type { PageMeta } from './types.js';

const URL_UNDER_TEST = 'https://www.cloudflare.com/solutions/';
const RETRIEVED_AT = '2026-07-01T00:00:00.000Z';

const META: PageMeta = {
  sourceId: 'www-solutions-overview',
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

describe('parseSolutionsOverview', () => {
  it('parses the valid fixture into the full expected page', () => {
    const page = parseHtml(fixture('marketing-overview-solutions.html'));
    expect(parseSolutionsOverview(page, META)).toEqual({
      sourceId: 'www-solutions-overview',
      canonicalUrl: 'https://www.cloudflare.com/solutions/',
      title: 'Solutions | Cloudflare',
      description:
        'Discover Cloudflare solutions for AI, frontends, workflows, platforms, security, and network performance.',
      retrievedAt: RETRIEVED_AT,
      kind: 'solutions-overview',
      solutions: [
        {
          name: 'AI',
          summary: 'Build intelligent applications with AI at the edge',
          href: 'https://www.cloudflare.com/solutions/ai/',
        },
        {
          name: 'Frontends',
          summary: 'Deploy frontend applications globally in seconds',
          href: 'https://www.cloudflare.com/solutions/frontends/',
        },
      ],
    });
  });

  it('errors at stage parse naming the card title selector when no card titles exist', () => {
    const page = parseHtml(fixture('marketing-overview-solutions-missing-title.html'));
    const caught = captureError(() => parseSolutionsOverview(page, META));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('parse');
      expect(caught.url).toBe(URL_UNDER_TEST);
      expect(caught.message).toContain('pages.solutions-page.benefits.');
      expect(caught.message).toContain('.title');
    }
  });
});
