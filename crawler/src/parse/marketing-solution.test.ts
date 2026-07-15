import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CrawlError } from '../errors.js';
import { parseHtml } from './html.js';
import { parseMarketingSolution } from './marketing-solution.js';
import type { PageMeta } from './types.js';

const URL_UNDER_TEST = 'https://www.cloudflare.com/sase/';
const RETRIEVED_AT = '2026-07-01T00:00:00.000Z';

const META: PageMeta = {
  sourceId: 'www-solution-sase',
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

describe('parseMarketingSolution', () => {
  it('parses the valid fixture into the full expected page (item CTA hrefs ignored)', () => {
    const page = parseHtml(fixture('marketing-solution-sase.html'));
    expect(parseMarketingSolution(page, META)).toEqual({
      sourceId: 'www-solution-sase',
      canonicalUrl: 'https://www.cloudflare.com/sase/',
      title: 'Cloudflare One | The agile SASE platform | Cloudflare',
      description:
        'Connect and protect your workforce, AI agents, and infrastructure with Cloudflare One — the unified SASE platform built for safe AI adoption and zero trust access.',
      retrievedAt: RETRIEVED_AT,
      kind: 'marketing-solution',
      solutionName: 'Cloudflare One',
      useCases: [
        {
          name: 'Safely adopt AI',
          summary: 'Move beyond AI blocking to securing AI adoption at scale.',
          href: null,
        },
        {
          name: 'Modernize remote access',
          summary: 'Stop relying on clunky, insecure VPNs.',
          href: null,
        },
      ],
    });
  });

  it('errors at stage parse naming the eyebrow selector when the eyebrow is missing', () => {
    const page = parseHtml(fixture('marketing-solution-sase-missing-eyebrow.html'));
    const caught = captureError(() => parseMarketingSolution(page, META));
    expect(caught).toBeInstanceOf(CrawlError);
    if (caught instanceof CrawlError) {
      expect(caught.stage).toBe('parse');
      expect(caught.url).toBe(URL_UNDER_TEST);
      expect(caught.message).toContain('.hero.eyebrow');
    }
  });
});
