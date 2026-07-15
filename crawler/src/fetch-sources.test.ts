import { describe, expect, it } from 'vitest';

import type { SourceConfig, SourceEntry } from './config.js';
import { CrawlError } from './errors.js';
import { CrawlRunError, fetchAllSources, type PageFetcher } from './fetch-sources.js';
import type { FetchPageRequest, FetchResult } from './http-client.js';

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error('expected at least one item');
  }
  return item;
}

const WWW_ROBOTS_URL = 'https://www.cloudflare.com/robots.txt';
const DEVELOPERS_ROBOTS_URL = 'https://developers.cloudflare.com/robots.txt';

const ALLOW_ALL_ROBOTS = 'User-agent: *\nAllow: /';

/** Trimmed derivative of the real developers.cloudflare.com directive set. */
const DEVELOPERS_ROBOTS = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /client-ip-geolocation',
  'Disallow: /plans/',
  'Disallow: /constellation',
  'Disallow: /cdn-cgi/',
  'Disallow: /email-security/',
].join('\n');

const DEFAULT_SOURCES: readonly SourceEntry[] = [
  {
    id: 'www-products',
    url: 'https://www.cloudflare.com/products/',
    pageKind: 'marketing-overview',
  },
  { id: 'www-cdn', url: 'https://www.cloudflare.com/products/cdn/', pageKind: 'marketing-product' },
  {
    id: 'dev-directory',
    url: 'https://developers.cloudflare.com/directory/',
    pageKind: 'developer-docs',
  },
];

function makeConfig(
  overrides: {
    sources?: readonly SourceEntry[];
    concurrency?: number;
    minRequestIntervalMs?: number;
  } = {},
): SourceConfig {
  return {
    allowedHosts: ['www.cloudflare.com', 'developers.cloudflare.com'],
    fetch: {
      timeoutMs: 1000,
      maxRetries: 0,
      concurrency: overrides.concurrency ?? 2,
      minRequestIntervalMs: overrides.minRequestIntervalMs ?? 1000,
    },
    sources: [...(overrides.sources ?? DEFAULT_SOURCES)],
  };
}

/** Builds the FetchResult a well-behaved client would return for a request. */
function stubResult(
  request: FetchPageRequest,
  status = 200,
  bodyText = '<html>ok</html>',
): FetchResult {
  return {
    sourceId: request.sourceId,
    requestedUrl: request.url,
    finalUrl: request.url,
    status,
    contentType: 'text/html',
    retrievedAt: '2026-07-14T00:00:00.000Z',
    redirectCount: 0,
    bodyText,
  };
}

type StubHandler = (request: FetchPageRequest) => FetchResult | Promise<FetchResult>;

/** Structural PageFetcher stub recording every requested URL in call order. */
function makeStubClient(handler: StubHandler): { client: PageFetcher; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    client: {
      fetchPage: (request) => {
        calls.push(request.url);
        return Promise.resolve(handler(request));
      },
    },
  };
}

/** Handler answering robots.txt per host and 200 for everything else. */
function robotsRoutedHandler(
  robotsByHost: Readonly<Record<string, { status: number; body?: string }>>,
): StubHandler {
  return (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/robots.txt') {
      const robots = robotsByHost[url.hostname];
      if (robots === undefined) {
        throw new Error(`unexpected robots.txt fetch for ${url.hostname}`);
      }
      return stubResult(request, robots.status, robots.body ?? '');
    }
    return stubResult(request);
  };
}

const bothAllowAll = {
  'www.cloudflare.com': { status: 200, body: ALLOW_ALL_ROBOTS },
  'developers.cloudflare.com': { status: 200, body: DEVELOPERS_ROBOTS },
} as const;

async function runExpectingFailure(
  config: SourceConfig,
  client: PageFetcher,
): Promise<CrawlRunError> {
  const error = await fetchAllSources(config, client)
    .then(() => null)
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(CrawlRunError);
  if (!(error instanceof CrawlRunError)) {
    throw new Error('expected a CrawlRunError');
  }
  return error;
}

describe('fetchAllSources', () => {
  it('fetches robots.txt exactly once per allowlisted host, before any source', async () => {
    const { client, calls } = makeStubClient(robotsRoutedHandler(bothAllowAll));

    await fetchAllSources(makeConfig(), client);

    expect(calls.slice(0, 2)).toEqual([WWW_ROBOTS_URL, DEVELOPERS_ROBOTS_URL]);
    expect(calls.filter((url) => url.endsWith('/robots.txt'))).toHaveLength(2);
    expect(calls).toHaveLength(2 + DEFAULT_SOURCES.length);
  });

  it('treats a robots 404 as allow-all and fetches every source', async () => {
    const { client, calls } = makeStubClient(
      robotsRoutedHandler({
        'www.cloudflare.com': { status: 404 },
        'developers.cloudflare.com': { status: 404 },
      }),
    );

    const results = await fetchAllSources(makeConfig(), client);

    expect(results).toHaveLength(DEFAULT_SOURCES.length);
    expect(calls.filter((url) => !url.endsWith('/robots.txt'))).toHaveLength(
      DEFAULT_SOURCES.length,
    );
  });

  it('returns results in config order on a fully successful run', async () => {
    const handler = robotsRoutedHandler(bothAllowAll);
    const { client } = makeStubClient(async (request) => {
      // Make the FIRST source the slowest so completion order differs from
      // config order; slots must still come back in config order.
      if (request.sourceId === 'www-products') {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 20);
        });
      }
      return handler(request);
    });

    const results = await fetchAllSources(makeConfig(), client);

    expect(results.map((result) => result.sourceId)).toEqual([
      'www-products',
      'www-cdn',
      'dev-directory',
    ]);
  });

  it('fails every source of a host whose robots.txt returns 500, all-or-nothing', async () => {
    const { client, calls } = makeStubClient(
      robotsRoutedHandler({
        'www.cloudflare.com': { status: 200, body: ALLOW_ALL_ROBOTS },
        'developers.cloudflare.com': { status: 500 },
      }),
    );

    const error = await runExpectingFailure(makeConfig(), client);

    expect(error.failures).toHaveLength(1);
    const failure = first(error.failures);
    expect(failure.stage).toBe('robots');
    expect(failure.url).toBe(DEVELOPERS_ROBOTS_URL);
    expect(failure.message).toContain('HTTP 500');
    // The healthy host's sources were still fetched (run to completion) even
    // though the run as a whole throws.
    expect(calls).toContain('https://www.cloudflare.com/products/');
    expect(calls).toContain('https://www.cloudflare.com/products/cdn/');
    expect(calls).not.toContain('https://developers.cloudflare.com/directory/');
  });

  it('wraps a client transport failure on robots.txt as a stage robots failure', async () => {
    const transportError = new CrawlError(
      `[fetch ${DEVELOPERS_ROBOTS_URL}] network failure (ECONNRESET) (after 0 retries)`,
      { stage: 'fetch', url: DEVELOPERS_ROBOTS_URL },
    );
    const handler = robotsRoutedHandler(bothAllowAll);
    const { client } = makeStubClient((request) => {
      if (request.url === DEVELOPERS_ROBOTS_URL) {
        throw transportError;
      }
      return handler(request);
    });

    const error = await runExpectingFailure(makeConfig(), client);

    expect(error.failures).toHaveLength(1);
    const failure = first(error.failures);
    expect(failure.stage).toBe('robots');
    expect(failure.url).toBe(DEVELOPERS_ROBOTS_URL);
    expect(failure.cause).toBe(transportError);
  });

  it('fails only the robots-disallowed source (real developers directive set)', async () => {
    const sources: readonly SourceEntry[] = [
      ...DEFAULT_SOURCES,
      {
        id: 'dev-email-security',
        url: 'https://developers.cloudflare.com/email-security/',
        pageKind: 'developer-docs',
      },
    ];
    const { client } = makeStubClient(robotsRoutedHandler(bothAllowAll));

    const error = await runExpectingFailure(makeConfig({ sources }), client);

    expect(error.failures).toHaveLength(1);
    const failure = first(error.failures);
    expect(failure.stage).toBe('robots');
    expect(failure.url).toBe('https://developers.cloudflare.com/email-security/');
    expect(failure.message).toContain('disallowed');
  });

  it('refuses to run a host whose crawl-delay exceeds the configured pacing', async () => {
    const { client } = makeStubClient(
      robotsRoutedHandler({
        'www.cloudflare.com': { status: 200, body: ALLOW_ALL_ROBOTS },
        'developers.cloudflare.com': {
          status: 200,
          body: 'User-agent: *\nCrawl-delay: 2\nAllow: /',
        },
      }),
    );

    const error = await runExpectingFailure(makeConfig({ minRequestIntervalMs: 1000 }), client);

    expect(error.failures).toHaveLength(1);
    const failure = first(error.failures);
    expect(failure.stage).toBe('robots');
    expect(failure.message).toContain(
      '[robots developers.cloudflare.com] crawl-delay 2s exceeds configured minRequestIntervalMs — raise it in crawler/config/sources.json',
    );
  });

  it('accepts a crawl-delay that fits inside the configured pacing', async () => {
    const { client } = makeStubClient(
      robotsRoutedHandler({
        'www.cloudflare.com': { status: 200, body: ALLOW_ALL_ROBOTS },
        'developers.cloudflare.com': {
          status: 200,
          body: 'User-agent: *\nCrawl-delay: 1\nAllow: /',
        },
      }),
    );

    const results = await fetchAllSources(makeConfig({ minRequestIntervalMs: 1000 }), client);

    expect(results).toHaveLength(DEFAULT_SOURCES.length);
  });

  it('never runs more source fetches concurrently than config.fetch.concurrency', async () => {
    const sources: readonly SourceEntry[] = [
      { id: 'www-s1', url: 'https://www.cloudflare.com/one/', pageKind: 'marketing-product' },
      { id: 'www-s2', url: 'https://www.cloudflare.com/two/', pageKind: 'marketing-product' },
      { id: 'www-s3', url: 'https://www.cloudflare.com/three/', pageKind: 'marketing-product' },
      { id: 'www-s4', url: 'https://www.cloudflare.com/four/', pageKind: 'marketing-product' },
      { id: 'www-s5', url: 'https://www.cloudflare.com/five/', pageKind: 'marketing-product' },
    ];
    let inFlight = 0;
    let maxInFlight = 0;
    const { client } = makeStubClient(async (request) => {
      if (new URL(request.url).pathname === '/robots.txt') {
        return stubResult(request, 404, '');
      }
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
      inFlight -= 1;
      return stubResult(request);
    });

    const results = await fetchAllSources(makeConfig({ sources, concurrency: 2 }), client);

    expect(results).toHaveLength(sources.length);
    expect(maxInFlight).toBe(2);
  });

  it('turns a non-2xx source status into a stage fetch HTTP failure', async () => {
    const handler = robotsRoutedHandler(bothAllowAll);
    const { client } = makeStubClient((request) => {
      if (request.sourceId === 'www-cdn') {
        return stubResult(request, 404, 'missing');
      }
      return handler(request);
    });

    const error = await runExpectingFailure(makeConfig(), client);

    expect(error.failures).toHaveLength(1);
    const failure = first(error.failures);
    expect(failure.stage).toBe('fetch');
    expect(failure.url).toBe('https://www.cloudflare.com/products/cdn/');
    expect(failure.message).toBe('[fetch https://www.cloudflare.com/products/cdn/] HTTP 404');
  });

  it('aggregates every failure in config order with one message line each', async () => {
    const sources: readonly SourceEntry[] = [
      { id: 'www-bad', url: 'https://www.cloudflare.com/gone/', pageKind: 'marketing-product' },
      { id: 'www-good', url: 'https://www.cloudflare.com/fine/', pageKind: 'marketing-product' },
      {
        id: 'dev-blocked',
        url: 'https://developers.cloudflare.com/email-security/',
        pageKind: 'developer-docs',
      },
      { id: 'www-boom', url: 'https://www.cloudflare.com/boom/', pageKind: 'marketing-product' },
    ];
    const handler = robotsRoutedHandler(bothAllowAll);
    const { client } = makeStubClient((request) => {
      if (request.sourceId === 'www-bad') {
        return stubResult(request, 410, '');
      }
      if (request.sourceId === 'www-boom') {
        return stubResult(request, 404, '');
      }
      return handler(request);
    });

    const error = await runExpectingFailure(makeConfig({ sources, concurrency: 1 }), client);

    expect(error.name).toBe('CrawlRunError');
    expect(error.failures.map((failure) => failure.stage)).toEqual(['fetch', 'robots', 'fetch']);
    expect(error.failures.map((failure) => failure.url)).toEqual([
      'https://www.cloudflare.com/gone/',
      'https://developers.cloudflare.com/email-security/',
      'https://www.cloudflare.com/boom/',
    ]);
    expect(error.message).toBe(error.failures.map((failure) => failure.message).join('\n'));
  });

  it('provides a guardUrl that vetoes robots-disallowed hops on either host', async () => {
    let disallowedHopError: unknown;
    let allowedHopError: unknown = null;
    const handler = robotsRoutedHandler(bothAllowAll);
    const { client } = makeStubClient((request) => {
      if (request.sourceId === 'www-products' && request.guardUrl !== undefined) {
        // Simulate redirect hops: one onto the OTHER approved host's
        // disallowed path, one onto an allowed path.
        try {
          request.guardUrl(new URL('https://developers.cloudflare.com/email-security/report'));
        } catch (caught) {
          disallowedHopError = caught;
        }
        try {
          request.guardUrl(new URL('https://developers.cloudflare.com/workers/'));
        } catch (caught) {
          allowedHopError = caught;
        }
      }
      return handler(request);
    });

    const results = await fetchAllSources(makeConfig(), client);

    expect(results).toHaveLength(DEFAULT_SOURCES.length);
    expect(disallowedHopError).toBeInstanceOf(CrawlError);
    if (disallowedHopError instanceof CrawlError) {
      expect(disallowedHopError.stage).toBe('robots');
      expect(disallowedHopError.url).toBe(
        'https://developers.cloudflare.com/email-security/report',
      );
    }
    expect(allowedHopError).toBeNull();
  });
});
