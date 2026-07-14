/**
 * Composition root for `pnpm crawl` — wiring only. The pipeline lives in
 * crawl.ts; this file resolves paths, stamps the single clock read, and maps
 * failures to the CLI contract: crawl failures print their message ONLY
 * (never cause chains — messages are body-free by construction) to stderr
 * with exit code 1, while unexpected errors rethrow so a bug crashes with a
 * stack and a non-zero exit.
 */
import { fileURLToPath } from 'node:url';

import { loadSourceConfig } from './config.js';
import { runCrawl } from './crawl.js';
import { CrawlError } from './errors.js';
import { CrawlRunError } from './fetch-sources.js';
import { httpClientFromConfig } from './http-client.js';
import { writeCatalogAtomically } from './write-catalog.js';

const configPath = fileURLToPath(new URL('../config/sources.json', import.meta.url));
const outputPath = fileURLToPath(new URL('../../web/public/data/catalog.json', import.meta.url));

try {
  const config = await loadSourceConfig(configPath);
  await runCrawl({
    config,
    client: httpClientFromConfig(config),
    generatedAt: new Date().toISOString(),
    outputPath,
    writeCatalog: writeCatalogAtomically,
    log: (line) => {
      console.log(line);
    },
  });
} catch (error) {
  // CrawlRunError is NOT a CrawlError subclass — both must be caught here.
  if (error instanceof CrawlError || error instanceof CrawlRunError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
