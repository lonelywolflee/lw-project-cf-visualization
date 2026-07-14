/**
 * Standalone check for `pnpm validate:data` — validates the COMMITTED
 * catalog at web/public/data/catalog.json against the shared runtime schema
 * without any network access. Exits 1 with stage-tagged issues when the
 * committed data would not load in the web application.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { safeParseCatalog } from '@cf-viz/catalog';

const catalogPath =
  process.argv[2] ?? fileURLToPath(new URL('../../web/public/data/catalog.json', import.meta.url));

function fail(stage: 'read' | 'parse', message: string): never {
  console.error(`validate:data failed at stage "${stage}" for ${catalogPath}: ${message}`);
  process.exit(1);
}

const raw = await readFile(catalogPath, 'utf8').catch((error: unknown) =>
  fail('read', error instanceof Error ? error.message : String(error)),
);
let document: unknown;
try {
  document = JSON.parse(raw);
} catch (error) {
  fail('parse', error instanceof Error ? error.message : String(error));
}

const result = safeParseCatalog(document);
if (!result.success) {
  console.error(`validate:data failed at stage "validate" for ${catalogPath}:`);
  for (const issue of result.issues) {
    console.error(`  [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  process.exit(1);
}

const { data } = result;
const counts = (
  [
    [data.sources.length, 'sources'],
    [data.productFamilies.length, 'families'],
    [data.products.length, 'products'],
    [data.solutions.length, 'solutions'],
    [data.useCases.length, 'use cases'],
    [data.relationships.length, 'relationships'],
  ] as const
)
  .map(([count, label]) => `${String(count)} ${label}`)
  .join(', ');
console.log(
  `catalog.json is valid (schemaVersion ${data.schemaVersion}, generatedAt ${data.generatedAt}): ${counts}`,
);
