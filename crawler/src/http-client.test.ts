import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SourceConfig } from './config.js';
import { CrawlError } from './errors.js';
import {
  CRAWLER_USER_AGENT,
  CRAWLER_USER_AGENT_TOKEN,
  HttpClient,
  httpClientFromConfig,
  type FetchLike,
  type FetchPageRequest,
  type HttpClientOptions,
} from './http-client.js';

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error('expected at least one item');
  }
  return item;
}

/** Builds a client with recording sleep; overrides win over the defaults. */
function makeClient(
  fetchImpl: FetchLike,
  overrides: Partial<HttpClientOptions> = {},
): { client: HttpClient; delays: number[] } {
  const delays: number[] = [];
  const client = new HttpClient({
    userAgent: CRAWLER_USER_AGENT,
    timeoutMs: 1000,
    maxRetries: 0,
    minRequestIntervalMs: 0,
    allowedHosts: ['www.cloudflare.com', 'developers.cloudflare.com'],
    fetchImpl,
    sleepImpl: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    ...overrides,
  });
  return { client, delays };
}

function pageRequest(url: string, guardUrl?: (url: URL) => void): FetchPageRequest {
  return { sourceId: 'test-source', url, ...(guardUrl === undefined ? {} : { guardUrl }) };
}

function toUrl(input: string | URL): URL {
  return input instanceof URL ? input : new URL(input);
}

const htmlResponse = (): Response =>
  new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } });

describe('HttpClient with a fake fetch (no network)', () => {
  it('exports the crawler UA token as a substring of the full UA', () => {
    expect(CRAWLER_USER_AGENT).toContain(`${CRAWLER_USER_AGENT_TOKEN}/`);
  });

  it('sends the configured user-agent and accept headers', async () => {
    const fakeFetch = vi.fn<FetchLike>(() => Promise.resolve(htmlResponse()));
    const { client } = makeClient(fakeFetch);

    await client.fetchPage(pageRequest('https://www.cloudflare.com/'));

    const [input, init] = first(fakeFetch.mock.calls);
    expect(toUrl(input).href).toBe('https://www.cloudflare.com/');
    expect(init?.redirect).toBe('manual');
    const headers = new Headers(init?.headers);
    expect(headers.get('user-agent')).toBe(CRAWLER_USER_AGENT);
    expect(headers.get('accept')).toBe('text/html');
  });

  it('returns a fully populated FetchResult on a direct 200', async () => {
    const fakeFetch = vi.fn<FetchLike>(() => Promise.resolve(htmlResponse()));
    const { client, delays } = makeClient(fakeFetch);

    const result = await client.fetchPage(pageRequest('https://www.cloudflare.com/products'));

    expect(result.sourceId).toBe('test-source');
    expect(result.requestedUrl).toBe('https://www.cloudflare.com/products');
    expect(result.finalUrl).toBe('https://www.cloudflare.com/products');
    expect(result.status).toBe(200);
    expect(result.contentType).toBe('text/html');
    expect(result.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(result.redirectCount).toBe(0);
    expect(result.bodyText).toBe('<html>ok</html>');
    expect(delays).toEqual([]);
  });

  it('reports contentType null when the header is absent', async () => {
    // A byte body avoids the implicit text/plain header a string body gets.
    const body = new TextEncoder().encode('<html>bare</html>');
    const fakeFetch = vi.fn<FetchLike>(() => Promise.resolve(new Response(body, { status: 200 })));
    const { client } = makeClient(fakeFetch);

    const result = await client.fetchPage(pageRequest('https://www.cloudflare.com/'));

    expect(result.contentType).toBeNull();
    expect(result.bodyText).toBe('<html>bare</html>');
  });

  it('resolves relative redirects against the current URL and counts hops', async () => {
    const fakeFetch = vi.fn<FetchLike>((input) => {
      const url = toUrl(input);
      if (url.href === 'https://www.cloudflare.com/start') {
        return Promise.resolve(new Response(null, { status: 301, headers: { location: '/hop' } }));
      }
      if (url.href === 'https://www.cloudflare.com/hop') {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: 'https://developers.cloudflare.com/final' },
          }),
        );
      }
      return Promise.resolve(htmlResponse());
    });
    const { client } = makeClient(fakeFetch);

    const result = await client.fetchPage(pageRequest('https://www.cloudflare.com/start'));

    expect(result.finalUrl).toBe('https://developers.cloudflare.com/final');
    expect(result.redirectCount).toBe(2);
    expect(result.status).toBe(200);
    expect(fakeFetch).toHaveBeenCalledTimes(3);
    const secondCall = fakeFetch.mock.calls[1];
    expect(secondCall === undefined ? '' : toUrl(secondCall[0]).href).toBe(
      'https://www.cloudflare.com/hop',
    );
  });

  it('rejects a redirect to an off-allowlist host before fetching that hop', async () => {
    const fakeFetch = vi.fn<FetchLike>(() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: 'https://evil.example.com/x' } }),
      ),
    );
    const { client } = makeClient(fakeFetch);

    const error = await client
      .fetchPage(pageRequest('https://www.cloudflare.com/escape'))
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CrawlError);
    if (!(error instanceof CrawlError)) return;
    expect(error.stage).toBe('fetch');
    expect(error.url).toBe('https://evil.example.com/x');
    expect(error.message).toContain('not allowlisted');
    // Only the first hop was fetched; the off-allowlist hop was never contacted.
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects an http:// input before any network contact', async () => {
    const fakeFetch = vi.fn<FetchLike>(() => Promise.resolve(htmlResponse()));
    const { client } = makeClient(fakeFetch);

    await expect(client.fetchPage(pageRequest('http://www.cloudflare.com/'))).rejects.toThrow(
      /not https/,
    );
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('fails a redirect loop once maxRedirects is exceeded', async () => {
    const fakeFetch = vi.fn<FetchLike>(() =>
      Promise.resolve(new Response(null, { status: 301, headers: { location: '/loop' } })),
    );
    const { client } = makeClient(fakeFetch, { maxRedirects: 3 });

    await expect(client.fetchPage(pageRequest('https://www.cloudflare.com/loop'))).rejects.toThrow(
      /redirect limit exceeded \(4 hops\)/,
    );
    // Initial fetch + 3 allowed hops; the 4th redirect response trips the limit.
    expect(fakeFetch).toHaveBeenCalledTimes(4);
  });

  it('fails a redirect without a Location header', async () => {
    const fakeFetch = vi.fn<FetchLike>(() => Promise.resolve(new Response(null, { status: 302 })));
    const { client } = makeClient(fakeFetch);

    await expect(client.fetchPage(pageRequest('https://www.cloudflare.com/'))).rejects.toThrow(
      /redirect 302 without a Location header/,
    );
  });

  it('retries a 429 once and succeeds with delays [1000]', async () => {
    let requests = 0;
    const fakeFetch = vi.fn<FetchLike>(() => {
      requests += 1;
      if (requests === 1) {
        return Promise.resolve(new Response('slow down', { status: 429 }));
      }
      return Promise.resolve(htmlResponse());
    });
    const { client, delays } = makeClient(fakeFetch, { maxRetries: 2 });

    const result = await client.fetchPage(pageRequest('https://www.cloudflare.com/'));

    expect(result.status).toBe(200);
    expect(delays).toEqual([1000]);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it('retries timeouts then throws a CrawlError with delays [1000, 2000]', async () => {
    const fakeFetch = vi.fn<FetchLike>(() =>
      Promise.reject(new DOMException('timeout', 'TimeoutError')),
    );
    const { client, delays } = makeClient(fakeFetch, { maxRetries: 2 });

    const error = await client
      .fetchPage(pageRequest('https://www.cloudflare.com/slow'))
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CrawlError);
    if (!(error instanceof CrawlError)) return;
    expect(error.stage).toBe('fetch');
    expect(error.message).toMatch(/timed out after 1000ms/);
    expect(error.cause).toBeInstanceOf(DOMException);
    expect(delays).toEqual([1000, 2000]);
    expect(fakeFetch).toHaveBeenCalledTimes(3);
  });

  it('retries a mid-body failure and succeeds on the next attempt', async () => {
    const stallingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new DOMException('body stall', 'TimeoutError'));
      },
    });
    const fakeFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(new Response(stallingBody, { status: 200 }))
      .mockResolvedValueOnce(htmlResponse());
    const { client, delays } = makeClient(fakeFetch, { maxRetries: 1 });

    const result = await client.fetchPage(pageRequest('https://www.cloudflare.com/'));

    expect(result.bodyText).toBe('<html>ok</html>');
    expect(delays).toEqual([1000]);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a redirect to a non-default port on an allowlisted host', async () => {
    const fakeFetch = vi.fn<FetchLike>(() =>
      Promise.resolve(
        new Response(null, {
          status: 301,
          headers: { location: 'https://www.cloudflare.com:8443/x' },
        }),
      ),
    );
    const { client } = makeClient(fakeFetch);

    await expect(client.fetchPage(pageRequest('https://www.cloudflare.com/'))).rejects.toThrow(
      /non-default port/,
    );
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('returns a 404 as a FetchResult without retrying', async () => {
    const fakeFetch = vi.fn<FetchLike>(() =>
      Promise.resolve(new Response('missing', { status: 404 })),
    );
    const { client, delays } = makeClient(fakeFetch, { maxRetries: 3 });

    const result = await client.fetchPage(pageRequest('https://www.cloudflare.com/nope'));

    expect(result.status).toBe(404);
    expect(result.bodyText).toBe('missing');
    expect(delays).toEqual([]);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('propagates a guardUrl CrawlError untouched and skips the hop fetch', async () => {
    const guardError = new CrawlError('[fetch https://www.cloudflare.com/blocked] vetoed', {
      stage: 'fetch',
      url: 'https://www.cloudflare.com/blocked',
    });
    const fakeFetch = vi.fn<FetchLike>(() =>
      Promise.resolve(new Response(null, { status: 302, headers: { location: '/blocked' } })),
    );
    const { client } = makeClient(fakeFetch);
    const guardUrl = (url: URL): void => {
      if (url.pathname === '/blocked') {
        throw guardError;
      }
    };

    await expect(
      client.fetchPage(pageRequest('https://www.cloudflare.com/start', guardUrl)),
    ).rejects.toBe(guardError);
    // The first hop was fetched; the vetoed hop was not.
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('never embeds the response body in errors after retry exhaustion', async () => {
    const sentinel = 'SENTINEL-BODY-a7f3e9';
    const fakeFetch = vi.fn<FetchLike>(() =>
      Promise.resolve(new Response(sentinel, { status: 500 })),
    );
    const { client, delays } = makeClient(fakeFetch, { maxRetries: 1 });

    const error = await client
      .fetchPage(pageRequest('https://www.cloudflare.com/boom'))
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CrawlError);
    if (!(error instanceof CrawlError)) return;
    expect(error.message).toMatch(/HTTP 500/);
    expect(error.message).not.toContain(sentinel);
    expect(error.cause).toBeInstanceOf(Error);
    if (error.cause instanceof Error) {
      expect(error.cause.message).not.toContain(sentinel);
    }
    expect(delays).toEqual([1000]);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it('paces consecutive request starts through the injected sleep', async () => {
    const fakeFetch = vi.fn<FetchLike>(() => Promise.resolve(htmlResponse()));
    const { client, delays } = makeClient(fakeFetch, { minRequestIntervalMs: 500 });

    await client.fetchPage(pageRequest('https://www.cloudflare.com/a'));
    await client.fetchPage(pageRequest('https://www.cloudflare.com/b'));

    // Each request start extends the instance-wide chain by one interval.
    expect(delays).toEqual([500, 500]);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });
});

// --- Local node:http test server (inline; adapted from the verified probe) ---

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void;

interface RecordedRequest {
  method: string;
  url: string;
  userAgent: string | undefined;
  accept: string | undefined;
}

interface TestServer {
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

async function startTestServer(
  routes: Readonly<Record<string, RouteHandler>>,
): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    requests.push({
      method: req.method ?? '',
      url,
      userAgent: req.headers['user-agent'],
      accept: req.headers.accept,
    });
    const handler = routes[url];
    if (handler === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    handler(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Test server did not bind to a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: async () => {
      // undici keeps keep-alive sockets open; close them or close() hangs.
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

/** Returns a 127.0.0.1 port that is closed (bound once, then released). */
async function findClosedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Could not allocate a port');
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
  return port;
}

/** Real-fetch client against the loopback server; sleep records delays. */
function makeIntegrationClient(overrides: Partial<HttpClientOptions> = {}): {
  client: HttpClient;
  delays: number[];
} {
  const delays: number[] = [];
  const client = new HttpClient({
    userAgent: CRAWLER_USER_AGENT,
    timeoutMs: 1000,
    maxRetries: 0,
    minRequestIntervalMs: 0,
    allowedHosts: ['127.0.0.1'],
    sleepImpl: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    ...overrides,
  });
  return { client, delays };
}

describe('HttpClient against a local node:http server (no public network)', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({
      '/rel301': (_req, res) => {
        res.writeHead(301, { location: '/hop2' });
        res.end();
      },
      '/hop2': (_req, res) => {
        res.writeHead(302, { location: `${server.baseUrl}/ok` });
        res.end();
      },
      '/ok': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html>ok</html>');
      },
      '/slow': (req, res) => {
        const timer = setTimeout(() => {
          res.writeHead(200);
          res.end('slow');
        }, 1500);
        req.on('close', () => {
          clearTimeout(timer);
        });
      },
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('follows a real 301(relative) -> 302(absolute) -> 200 chain', async () => {
    const { client, delays } = makeIntegrationClient();
    const before = server.requests.length;

    const result = await client.fetchPage({
      sourceId: 'it-chain',
      url: `${server.baseUrl}/rel301`,
    });

    expect(result.status).toBe(200);
    expect(result.finalUrl).toBe(`${server.baseUrl}/ok`);
    expect(result.redirectCount).toBe(2);
    expect(result.contentType).toBe('text/html; charset=utf-8');
    expect(result.bodyText).toBe('<html>ok</html>');
    expect(delays).toEqual([]);
    const chainRequests = server.requests.slice(before);
    expect(chainRequests.map((request) => request.url)).toEqual(['/rel301', '/hop2', '/ok']);
    expect(chainRequests.every((request) => request.userAgent === CRAWLER_USER_AGENT)).toBe(true);
    expect(chainRequests.every((request) => request.accept === 'text/html')).toBe(true);
  });

  it('times out a slow route, retries, and surfaces the TimeoutError cause', async () => {
    const { client, delays } = makeIntegrationClient({ timeoutMs: 100, maxRetries: 1 });

    const error = await client
      .fetchPage({ sourceId: 'it-slow', url: `${server.baseUrl}/slow` })
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CrawlError);
    if (!(error instanceof CrawlError)) return;
    expect(error.stage).toBe('fetch');
    expect(error.message).toMatch(/timed out after 100ms/);
    expect(error.cause).toBeInstanceOf(DOMException);
    if (error.cause instanceof DOMException) {
      expect(error.cause.name).toBe('TimeoutError');
    }
    expect(delays).toEqual([1000]);
  });

  it('retries ECONNREFUSED then throws a CrawlError carrying the cause', async () => {
    const port = await findClosedPort();
    const { client, delays } = makeIntegrationClient({ maxRetries: 1 });

    const error = await client
      .fetchPage({ sourceId: 'it-refused', url: `http://127.0.0.1:${String(port)}/x` })
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CrawlError);
    if (!(error instanceof CrawlError)) return;
    expect(error.stage).toBe('fetch');
    expect(error.message).toMatch(/network failure \(ECONNREFUSED\)/);
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(delays).toEqual([1000]);
  });
});

describe('httpClientFromConfig', () => {
  it('builds a working HttpClient that enforces the validated config allowlist', async () => {
    const config: SourceConfig = {
      allowedHosts: ['www.cloudflare.com', 'developers.cloudflare.com'],
      fetch: { timeoutMs: 1000, maxRetries: 0, concurrency: 1, minRequestIntervalMs: 250 },
      sources: [
        {
          id: 'www-products-overview',
          url: 'https://www.cloudflare.com/products/',
          pageKind: 'marketing-overview',
        },
      ],
    };

    const client = httpClientFromConfig(config);
    expect(client).toBeInstanceOf(HttpClient);

    // 127.0.0.1 is NOT in the config's allowlist, so the client must veto the
    // request before any connection attempt — proving the factory installed
    // config.allowedHosts. The port is a freshly closed loopback port, so
    // even a broken mapping could not reach a live socket.
    const port = await findClosedPort();
    const error = await client
      .fetchPage({ sourceId: 'factory-veto', url: `http://127.0.0.1:${String(port)}/x` })
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CrawlError);
    if (!(error instanceof CrawlError)) return;
    expect(error.stage).toBe('fetch');
    expect(error.message).toContain("hostname '127.0.0.1' is not allowlisted");
  });
});
