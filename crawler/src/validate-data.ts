/**
 * Standalone check for `pnpm validate:data` — validates the COMMITTED data
 * artifacts without any network access:
 *
 * 1. web/public/data/catalog.json against the shared runtime schema;
 * 2. data/curated/curated.json — shape, internal duplicates, and
 *    cross-references into the validated catalog;
 * 3. web/public/data/curated.json freshness — the committed artifact must
 *    be byte-identical to a fresh build from the source, so editing the
 *    source without running `pnpm build:curated` cannot ship stale data.
 *
 * Exits 1 with stage-tagged issues when the committed data would not load
 * in the web application.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { safeParseCatalog, type CatalogIssue } from '@cf-viz/catalog';

import { buildCuratedArtifact } from './curated-build.js';

const catalogPath =
  process.argv[2] ?? fileURLToPath(new URL('../../web/public/data/catalog.json', import.meta.url));
const curatedSourcePath =
  process.argv[3] ?? fileURLToPath(new URL('../../data/curated/curated.json', import.meta.url));
const curatedArtifactPath =
  process.argv[4] ?? fileURLToPath(new URL('../../web/public/data/curated.json', import.meta.url));

type Stage = 'read' | 'parse' | 'curated-read' | 'curated-parse' | 'artifact-read' | 'freshness';

function fail(stage: Stage, filePath: string, message: string): never {
  console.error(`validate:data failed at stage "${stage}" for ${filePath}: ${message}`);
  process.exit(1);
}

function failWithIssues(
  stage: 'validate' | 'curated-validate',
  filePath: string,
  issues: readonly CatalogIssue[],
): never {
  console.error(`validate:data failed at stage "${stage}" for ${filePath}:`);
  for (const issue of issues) {
    console.error(`  [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  process.exit(1);
}

async function readJson(filePath: string, readStage: Stage, parseStage: Stage): Promise<unknown> {
  const raw = await readFile(filePath, 'utf8').catch((error: unknown) =>
    fail(readStage, filePath, error instanceof Error ? error.message : String(error)),
  );
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    fail(parseStage, filePath, error instanceof Error ? error.message : String(error));
  }
}

const catalogDocument = await readJson(catalogPath, 'read', 'parse');
const catalogResult = safeParseCatalog(catalogDocument);
if (!catalogResult.success) {
  failWithIssues('validate', catalogPath, catalogResult.issues);
}

const catalog = catalogResult.data;
const catalogCounts = (
  [
    [catalog.sources.length, 'sources'],
    [catalog.productFamilies.length, 'families'],
    [catalog.products.length, 'products'],
    [catalog.solutions.length, 'solutions'],
    [catalog.useCases.length, 'use cases'],
    [catalog.relationships.length, 'relationships'],
  ] as const
)
  .map(([count, label]) => `${String(count)} ${label}`)
  .join(', ');
console.log(
  `catalog.json is valid (schemaVersion ${catalog.schemaVersion}, generatedAt ${catalog.generatedAt}): ${catalogCounts}`,
);

const curatedDocument = await readJson(curatedSourcePath, 'curated-read', 'curated-parse');
const build = buildCuratedArtifact(curatedDocument, catalog);
if (!build.success) {
  failWithIssues('curated-validate', curatedSourcePath, build.issues);
}

const artifactBytes = await readFile(curatedArtifactPath, 'utf8').catch((error: unknown) =>
  fail(
    'artifact-read',
    curatedArtifactPath,
    error instanceof Error ? error.message : String(error),
  ),
);
if (artifactBytes !== build.body) {
  fail(
    'freshness',
    curatedArtifactPath,
    `committed artifact is stale; run 'pnpm build:curated' to regenerate it from ${curatedSourcePath}`,
  );
}

const curatedCounts = [
  `${String(build.data.products.length)} products`,
  `${String(build.data.compositions.length)} compositions`,
  `${String(build.data.pricing.length)} pricing entries`,
  `${String(build.data.learningNotes.length)} learning notes`,
  `${String(build.data.solutionNotes.length)} solution notes`,
  `${String(build.data.scenarios.length)} scenarios`,
  `${String(build.data.narration.length)} narration stops`,
].join(', ');
console.log(
  `curated.json is valid and fresh (schemaVersion ${build.data.schemaVersion}): ${curatedCounts}`,
);
