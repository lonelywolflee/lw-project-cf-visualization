/**
 * Failure-matrix tests for runCrawl (F0–F7): the full pipeline against a
 * stub PageFetcher serving the real parse fixtures — no network, real fs on
 * mkdtemp scratch dirs only. Every failure case pre-seeds the target with
 * sentinel bytes and proves byte-level preservation plus zero staging
 * leftovers. F0/F7 use the REAL atomic writer; only F6 injects a thrower.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Catalog } from '@cf-viz/catalog';
import { afterEach, describe, expect, it } from 'vitest';

import type { SourceConfig, SourceEntry } from './config.js';
import { runCrawl, type CatalogWriter, type CrawlDeps } from './crawl.js';
import { CrawlError } from './errors.js';
import { CrawlRunError, type PageFetcher } from './fetch-sources.js';
import type { FetchPageRequest, FetchResult } from './http-client.js';
import { writeCatalogAtomically } from './write-catalog.js';

const GENERATED_AT = '2026-07-14T00:00:00.000Z';
const RETRIEVED_AT = '2026-07-14T00:00:00.000Z';

const CDN_URL = 'https://www.cloudflare.com/products/cdn/';
const PRODUCTS_OVERVIEW_URL = 'https://www.cloudflare.com/products/';
const SOLUTIONS_OVERVIEW_URL = 'https://www.cloudflare.com/solutions/';
const SASE_URL = 'https://www.cloudflare.com/sase/';
const DOCS_DIRECTORY_URL = 'https://developers.cloudflare.com/directory/';

const PRODUCTS_OVERVIEW_SOURCE: SourceEntry = {
  id: 'www-products-overview',
  url: PRODUCTS_OVERVIEW_URL,
  pageKind: 'marketing-overview',
};
const SOLUTIONS_OVERVIEW_SOURCE: SourceEntry = {
  id: 'www-solutions-overview',
  url: SOLUTIONS_OVERVIEW_URL,
  pageKind: 'marketing-overview',
};
const CDN_SOURCE: SourceEntry = {
  id: 'www-product-cdn',
  url: CDN_URL,
  pageKind: 'marketing-product',
};
const SASE_SOURCE: SourceEntry = {
  id: 'www-solution-sase',
  url: SASE_URL,
  pageKind: 'marketing-solution',
};
const DOCS_SOURCE: SourceEntry = {
  id: 'developers-docs-directory',
  url: DOCS_DIRECTORY_URL,
  pageKind: 'developer-docs',
};

/** Mirrors the real fixture set: both overviews, cdn, sase, docs directory. */
const HAPPY_SOURCES: readonly SourceEntry[] = [
  PRODUCTS_OVERVIEW_SOURCE,
  SOLUTIONS_OVERVIEW_SOURCE,
  CDN_SOURCE,
  SASE_SOURCE,
  DOCS_SOURCE,
];

function makeConfig(sources: readonly SourceEntry[] = HAPPY_SOURCES): SourceConfig {
  return {
    allowedHosts: ['www.cloudflare.com', 'developers.cloudflare.com'],
    fetch: { timeoutMs: 1000, maxRetries: 0, concurrency: 2, minRequestIntervalMs: 1000 },
    sources: [...sources],
  };
}

function fixture(name: string): string {
  return readFileSync(new URL(`./parse/fixtures/${name}`, import.meta.url), 'utf8');
}

/** Fixture body per URL; canonicals inside each fixture match these URLs. */
const HAPPY_BODIES: Readonly<Record<string, string>> = {
  [PRODUCTS_OVERVIEW_URL]: fixture('marketing-overview-products.html'),
  [SOLUTIONS_OVERVIEW_URL]: fixture('marketing-overview-solutions.html'),
  [CDN_URL]: fixture('marketing-product-cdn.html'),
  [SASE_URL]: fixture('marketing-solution-sase.html'),
  [DOCS_DIRECTORY_URL]: fixture('developer-docs-directory.html'),
};

interface StubRoutes {
  /** Body per exact page URL; a missing entry fails the test loudly. */
  readonly bodies: Readonly<Record<string, string>>;
  /** Status override per exact page URL (default 200). */
  readonly statuses?: Readonly<Record<string, number>>;
  /** robots.txt response per hostname; default 404 (unavailable-allow-all). */
  readonly robots?: Readonly<Record<string, { status: number; body: string }>>;
}

function stubResult(request: FetchPageRequest, status: number, bodyText: string): FetchResult {
  return {
    sourceId: request.sourceId,
    requestedUrl: request.url,
    finalUrl: request.url,
    status,
    contentType: 'text/html',
    retrievedAt: RETRIEVED_AT,
    redirectCount: 0,
    bodyText,
  };
}

/** Structural PageFetcher stub routing robots.txt per host, pages per URL. */
function makeStubClient(routes: StubRoutes): PageFetcher {
  return {
    fetchPage: (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/robots.txt') {
        const robots = routes.robots?.[url.hostname];
        return Promise.resolve(stubResult(request, robots?.status ?? 404, robots?.body ?? ''));
      }
      const body = routes.bodies[request.url];
      const status = routes.statuses?.[request.url];
      if (body === undefined && status === undefined) {
        return Promise.reject(new Error(`unexpected page fetch: ${request.url}`));
      }
      return Promise.resolve(stubResult(request, status ?? 200, body ?? ''));
    },
  };
}

const PREVIOUS_BYTES = Buffer.from('{"previous":true}\n', 'utf8');

let sandbox: string;

function makeSandbox(): string {
  sandbox = mkdtempSync(path.join(tmpdir(), 'issue5-crawl-'));
  return sandbox;
}

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

/** Sandbox with a pre-seeded sentinel target the run must never touch on failure. */
async function seedTarget(): Promise<{ dataDir: string; target: string }> {
  const dataDir = path.join(makeSandbox(), 'data');
  await mkdir(dataDir, { recursive: true });
  const target = path.join(dataDir, 'catalog.json');
  await writeFile(target, PREVIOUS_BYTES);
  return { dataDir, target };
}

/** Sentinel bytes intact AND no staging leftovers beside the target. */
async function assertPreserved(dataDir: string, target: string): Promise<void> {
  expect(Buffer.compare(await readFile(target), PREVIOUS_BYTES)).toBe(0);
  expect(await readdir(dataDir)).toEqual(['catalog.json']);
}

interface DepsOverrides {
  readonly config?: SourceConfig;
  readonly client?: PageFetcher;
  readonly generatedAt?: string;
  readonly writeCatalog?: CatalogWriter;
}

function makeDeps(
  target: string,
  overrides: DepsOverrides = {},
): {
  deps: CrawlDeps;
  lines: string[];
} {
  const lines: string[] = [];
  return {
    lines,
    deps: {
      config: overrides.config ?? makeConfig(),
      client: overrides.client ?? makeStubClient({ bodies: HAPPY_BODIES }),
      generatedAt: overrides.generatedAt ?? GENERATED_AT,
      outputPath: target,
      writeCatalog: overrides.writeCatalog ?? writeCatalogAtomically,
      log: (line) => {
        lines.push(line);
      },
    },
  };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (caught: unknown) => caught,
  );
}

describe('runCrawl failure matrix', () => {
  it('F0: happy path — writes the catalog, logs the five stages, byte-deterministic', async () => {
    const { dataDir, target } = await seedTarget();
    const { deps, lines } = makeDeps(target);

    const catalog = await runCrawl(deps);

    expect(catalog.sources).toHaveLength(5);
    const written = await readFile(target);
    const text = written.toString('utf8');
    expect(text.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(text) as Catalog;
    expect(parsed.sources).toHaveLength(5);
    expect(parsed.generatedAt).toBe(GENERATED_AT);
    expect(lines).toEqual([
      'config: 5 sources (www.cloudflare.com 4, developers.cloudflare.com 1)',
      'fetch: 5/5 pages fetched (robots-gated)',
      'parse: 5 pages parsed and normalized',
      'assemble: 3 families, 5 products, 3 solutions, 4 use cases, 4 relationships — schema valid',
      `write: replaced ${target}`,
    ]);
    expect(await readdir(dataDir)).toEqual(['catalog.json']);

    // Identical deps → byte-identical file (determinism through the pipeline).
    const second = makeDeps(target);
    await runCrawl(second.deps);
    expect(Buffer.compare(written, await readFile(target))).toBe(0);
  });

  it('F1: a fetch failure (HTTP 500) aggregates into CrawlRunError; previous data preserved', async () => {
    const { dataDir, target } = await seedTarget();
    const client = makeStubClient({ bodies: HAPPY_BODIES, statuses: { [CDN_URL]: 500 } });
    const { deps } = makeDeps(target, { client });

    const error = await captureError(runCrawl(deps));

    expect(error).toBeInstanceOf(CrawlRunError);
    if (!(error instanceof CrawlRunError)) return;
    expect(error.message).toContain('[fetch');
    expect(error.message).toContain('HTTP 500');
    await assertPreserved(dataDir, target);
  });

  it('F2: a robots denial fails every gated www source; previous data preserved', async () => {
    const { dataDir, target } = await seedTarget();
    const client = makeStubClient({
      bodies: HAPPY_BODIES,
      robots: {
        'www.cloudflare.com': { status: 200, body: 'User-agent: *\nDisallow: /products/' },
      },
    });
    const { deps } = makeDeps(target, { client });

    const error = await captureError(runCrawl(deps));

    expect(error).toBeInstanceOf(CrawlRunError);
    if (!(error instanceof CrawlRunError)) return;
    // Both /products/-prefixed www sources are denied; the rest still ran.
    expect(error.failures).toHaveLength(2);
    expect(error.message).toContain(`[robots ${PRODUCTS_OVERVIEW_URL}]`);
    expect(error.message).toContain(`[robots ${CDN_URL}]`);
    await assertPreserved(dataDir, target);
  });

  it('F3: a parse failure aggregates like a fetch failure; previous data preserved', async () => {
    const { dataDir, target } = await seedTarget();
    const client = makeStubClient({
      bodies: {
        ...HAPPY_BODIES,
        [CDN_URL]: fixture('marketing-product-cdn-usecase-missing-title.html'),
      },
    });
    const { deps } = makeDeps(target, { client });

    const error = await captureError(runCrawl(deps));

    expect(error).toBeInstanceOf(CrawlRunError);
    if (!(error instanceof CrawlRunError)) return;
    expect(error.message).toContain(`[parse ${CDN_URL}`);
    await assertPreserved(dataDir, target);
  });

  it('F4a: a product missing from the products overview fails normalization; preserved', async () => {
    const { dataDir, target } = await seedTarget();
    const { deps } = makeDeps(target, { config: makeConfig([CDN_SOURCE]) });

    const error = await captureError(runCrawl(deps));

    expect(error).toBeInstanceOf(CrawlError);
    if (!(error instanceof CrawlError)) return;
    expect(error.stage).toBe('normalize');
    expect(error.message).toContain('[normalize');
    expect(error.message).toContain('missing from the products overview');
    await assertPreserved(dataDir, target);
  });

  it('F4b: an equal-precedence cross-page use-case summary conflict fails; preserved', async () => {
    const { dataDir, target } = await seedTarget();
    const client = makeStubClient({
      bodies: {
        ...HAPPY_BODIES,
        [CDN_URL]: fixture('marketing-product-cdn-usecase-conflict.html'),
      },
    });
    const { deps } = makeDeps(target, {
      client,
      config: makeConfig([PRODUCTS_OVERVIEW_SOURCE, CDN_SOURCE, SASE_SOURCE]),
    });

    const error = await captureError(runCrawl(deps));

    expect(error).toBeInstanceOf(CrawlError);
    if (!(error instanceof CrawlError)) return;
    expect(error.stage).toBe('normalize');
    expect(error.message).toContain('[normalize');
    expect(error.message).toContain('conflicting summary');
    await assertPreserved(dataDir, target);
  });

  it('F5: an invalid generatedAt fails schema validation at stage validate; preserved', async () => {
    const { dataDir, target } = await seedTarget();
    const { deps } = makeDeps(target, { generatedAt: 'not-a-timestamp' });

    const error = await captureError(runCrawl(deps));

    expect(error).toBeInstanceOf(CrawlError);
    if (!(error instanceof CrawlError)) return;
    expect(error.stage).toBe('validate');
    expect(error.message).toContain('[validate');
    await assertPreserved(dataDir, target);
  });

  it('F6: a write failure propagates after exactly one post-assembly writer call; preserved', async () => {
    const { dataDir, target } = await seedTarget();
    const writeFailure = new CrawlError(`[write ${target}] disk full`, { stage: 'write' });
    const lines: string[] = [];
    let writerCalls = 0;
    let assembleLoggedBeforeWrite = false;
    let outputPathSeen = '';
    const writeCatalog: CatalogWriter = (catalog, outputPath) => {
      writerCalls += 1;
      outputPathSeen = outputPath;
      assembleLoggedBeforeWrite = lines.some((line) => line.startsWith('assemble:'));
      expect(catalog.sources).toHaveLength(5); // assembly succeeded first
      return Promise.reject(writeFailure);
    };
    const deps: CrawlDeps = {
      config: makeConfig(),
      client: makeStubClient({ bodies: HAPPY_BODIES }),
      generatedAt: GENERATED_AT,
      outputPath: target,
      writeCatalog,
      log: (line) => {
        lines.push(line);
      },
    };

    const error = await captureError(runCrawl(deps));

    expect(error).toBe(writeFailure);
    expect(writerCalls).toBe(1);
    expect(outputPathSeen).toBe(target);
    expect(assembleLoggedBeforeWrite).toBe(true);
    expect(lines.some((line) => line.startsWith('write:'))).toBe(false);
    await assertPreserved(dataDir, target);
  });

  it('F7: first run with no data directory at all succeeds through the real writer', async () => {
    const target = path.join(makeSandbox(), 'data', 'catalog.json');
    const { deps, lines } = makeDeps(target);

    const catalog = await runCrawl(deps);

    expect(catalog.generatedAt).toBe(GENERATED_AT);
    const written = await readFile(target, 'utf8');
    expect((JSON.parse(written) as Catalog).sources).toHaveLength(5);
    expect(await readdir(path.dirname(target))).toEqual(['catalog.json']);
    expect(lines.at(-1)).toBe(`write: replaced ${target}`);
  });
});
