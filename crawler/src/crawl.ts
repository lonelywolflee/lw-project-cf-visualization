/**
 * The crawl pipeline: fetch → parse → normalize → assemble → atomic write,
 * composed from injected dependencies so the whole run is testable offline.
 *
 * Progress is reported as one concise line per stage through the injected
 * `log` function; failures are NEVER logged here — they throw (CrawlError or
 * CrawlRunError), and the composition root decides how to present them.
 * Parse and normalize failures are aggregated across sources into one
 * {@link CrawlRunError} exactly like fetch failures, so a single run reports
 * every broken source at once (AGENTS §3: all-or-nothing, no partial data).
 */
import type { Catalog, SourcePageKind } from '@cf-viz/catalog';

import { assembleCatalog } from './assemble.js';
import type { SourceConfig } from './config.js';
import { CrawlError } from './errors.js';
import { CrawlRunError, fetchAllSources, type PageFetcher } from './fetch-sources.js';
import { normalizePage, type CatalogFragment } from './normalize.js';
import { parsePage } from './parse/index.js';

/** Atomic-writer capability: serialize + temp file + rename (write-catalog.ts owns the format). */
export type CatalogWriter = (catalog: Catalog, outputPath: string) => Promise<void>;

/** Everything {@link runCrawl} needs; all fields required (no hidden defaults). */
export interface CrawlDeps {
  readonly config: SourceConfig;
  /** HttpClient satisfies it structurally; tests pass a stub. */
  readonly client: PageFetcher;
  /** UTC ISO instant from the caller's clock — keeps runCrawl clock-free. */
  readonly generatedAt: string;
  /** Absolute path of the catalog file to replace. */
  readonly outputPath: string;
  /** main passes writeCatalogAtomically; tests may pass a thrower. */
  readonly writeCatalog: CatalogWriter;
  /** Progress lines ONLY; failures always THROW, never log. */
  readonly log: (line: string) => void;
}

/** `config: 5 sources (www.cloudflare.com 4, developers.cloudflare.com 1)`. */
function configLine(config: SourceConfig): string {
  const hostCounts = new Map<string, number>();
  for (const source of config.sources) {
    const host = new URL(source.url).hostname;
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  }
  const perHost = [...hostCounts.entries()]
    .map(([host, count]) => `${host} ${String(count)}`)
    .join(', ');
  return `config: ${String(config.sources.length)} sources (${perHost})`;
}

/** `assemble: 3 families, 4 products, … — schema valid` (validation is inside assembleCatalog). */
function assembleLine(catalog: Catalog): string {
  return (
    `assemble: ${String(catalog.productFamilies.length)} families, ` +
    `${String(catalog.products.length)} products, ` +
    `${String(catalog.solutions.length)} solutions, ` +
    `${String(catalog.useCases.length)} use cases, ` +
    `${String(catalog.relationships.length)} relationships — schema valid`
  );
}

/**
 * Run the complete crawl pipeline and return the validated catalog after it
 * has atomically replaced the file at `deps.outputPath`.
 *
 * @throws CrawlRunError aggregating every per-source fetch, robots, parse, or
 * normalize failure (config order); CrawlError for assemble-time
 * inconsistencies (stage 'normalize'), schema failures (stage 'validate'),
 * and write failures (stage 'write'). On ANY throw the previous file content
 * is untouched.
 */
export async function runCrawl(deps: CrawlDeps): Promise<Catalog> {
  const { config, client, generatedAt, outputPath, writeCatalog, log } = deps;
  log(configLine(config));

  const results = await fetchAllSources(config, client);
  log(
    `fetch: ${String(results.length)}/${String(config.sources.length)} pages fetched (robots-gated)`,
  );

  const kindBySourceId = new Map<string, SourcePageKind>(
    config.sources.map((source) => [source.id, source.pageKind]),
  );
  const fragments: CatalogFragment[] = [];
  const failures: CrawlError[] = [];
  for (const result of results) {
    const kind = kindBySourceId.get(result.sourceId);
    if (kind === undefined) {
      // Unreachable via fetchAllSources (results carry configured source ids
      // only), kept as a hard failure rather than a silently dropped page.
      failures.push(
        new CrawlError(
          `[normalize ${result.finalUrl}] fetched sourceId '${result.sourceId}' matches no configured source`,
          { stage: 'normalize', url: result.finalUrl },
        ),
      );
      continue;
    }
    try {
      fragments.push(normalizePage(parsePage(result, kind), kind));
    } catch (error) {
      if (error instanceof CrawlError) {
        failures.push(error);
        continue;
      }
      throw error; // a non-crawl error is a bug and must look like one
    }
  }
  if (failures.length > 0) {
    throw new CrawlRunError(failures);
  }
  log(`parse: ${String(fragments.length)} pages parsed and normalized`);

  const catalog = assembleCatalog(fragments, { generatedAt });
  log(assembleLine(catalog));

  await writeCatalog(catalog, outputPath);
  log(`write: replaced ${outputPath}`);
  return catalog;
}
