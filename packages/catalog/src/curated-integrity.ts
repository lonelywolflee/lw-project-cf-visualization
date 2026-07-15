import type { CuratedData } from './curated-schema.js';
import type { CatalogIssue } from './errors.js';
import type { Catalog } from './schema.js';

function collectUniqueIds(
  collection:
    | 'products'
    | 'compositions'
    | 'pricing'
    | 'learningNotes'
    | 'solutionNotes'
    | 'scenarios'
    | 'narration',
  key: 'productId' | 'solutionId' | 'id',
  ids: readonly string[],
  issues: CatalogIssue[],
): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      issues.push({
        code: 'duplicate-id',
        path: `${collection}[${String(index)}].${key}`,
        message: `Duplicate ${key} '${id}' in ${collection}`,
      });
    }
    seen.add(id);
  });
}

/**
 * Collects every internal integrity issue in a shape-valid curated dataset:
 * duplicate entry ids per collection. Returns an empty array when sound.
 *
 * Package-internal: applied by {@link safeParseCuratedData}. Catalog
 * cross-references live in {@link collectCuratedReferenceIssues} because
 * they need a parsed Catalog.
 */
export function collectCuratedIntegrityIssues(curated: CuratedData): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  collectUniqueIds(
    'products',
    'productId',
    curated.products.map((entry) => entry.productId),
    issues,
  );
  collectUniqueIds(
    'compositions',
    'solutionId',
    curated.compositions.map((entry) => entry.solutionId),
    issues,
  );
  collectUniqueIds(
    'pricing',
    'productId',
    curated.pricing.map((entry) => entry.productId),
    issues,
  );
  collectUniqueIds(
    'learningNotes',
    'productId',
    curated.learningNotes.map((entry) => entry.productId),
    issues,
  );
  collectUniqueIds(
    'scenarios',
    'id',
    curated.scenarios.map((entry) => entry.id),
    issues,
  );
  collectUniqueIds(
    'narration',
    'productId',
    curated.narration.map((entry) => entry.productId),
    issues,
  );
  collectUniqueIds(
    'solutionNotes',
    'solutionId',
    curated.solutionNotes.map((entry) => entry.solutionId),
    issues,
  );
  return issues;
}

/**
 * Product ids that are ALSO solution ids in the current catalog. Progress
 * keys for solutions must be namespaced (`solution:<id>`) because of these
 * collisions — a raw solution id would corrupt the product's verified
 * state, streak, and re-fog. This snapshot makes the collision set a
 * contract: a NEW collision fails validation until the snapshot (and the
 * namespace reasoning) is consciously revisited.
 */
export const KNOWN_PRODUCT_SOLUTION_COLLISIONS: readonly string[] = ['workflows'];

/**
 * Collects every reference from a valid curated dataset to a product or
 * solution id that does not exist in `catalog`. Returns an empty array when
 * every reference resolves.
 *
 * The catalog is assumed internally sound (its own parse pipeline enforces
 * unique ids); this check only guards the curated → catalog direction.
 */
export function collectCuratedReferenceIssues(
  curated: CuratedData,
  catalog: Catalog,
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const productIds = new Set(catalog.products.map((product) => product.id));
  const solutionIds = new Set(catalog.solutions.map((solution) => solution.id));

  curated.products.forEach((entry, index) => {
    if (!productIds.has(entry.productId)) {
      issues.push({
        code: 'unknown-entity-reference',
        path: `products[${String(index)}].productId`,
        message: `Unknown products id '${entry.productId}'`,
      });
    }
  });

  curated.compositions.forEach((entry, index) => {
    if (!solutionIds.has(entry.solutionId)) {
      issues.push({
        code: 'unknown-entity-reference',
        path: `compositions[${String(index)}].solutionId`,
        message: `Unknown solutions id '${entry.solutionId}'`,
      });
    }
    entry.productIds.forEach((productId, productIndex) => {
      if (!productIds.has(productId)) {
        issues.push({
          code: 'unknown-entity-reference',
          path: `compositions[${String(index)}].productIds[${String(productIndex)}]`,
          message: `Unknown products id '${productId}'`,
        });
      }
    });
  });

  curated.pricing.forEach((entry, index) => {
    if (!productIds.has(entry.productId)) {
      issues.push({
        code: 'unknown-entity-reference',
        path: `pricing[${String(index)}].productId`,
        message: `Unknown products id '${entry.productId}'`,
      });
    }
  });

  curated.learningNotes.forEach((entry, index) => {
    if (!productIds.has(entry.productId)) {
      issues.push({
        code: 'unknown-entity-reference',
        path: `learningNotes[${String(index)}].productId`,
        message: `Unknown products id '${entry.productId}'`,
      });
    }
  });

  curated.scenarios.forEach((entry, index) => {
    // Scenario and solution lenses share one URL namespace (`?lens=`), so
    // an id collision would make a deep link ambiguous — reject it here.
    if (solutionIds.has(entry.id)) {
      issues.push({
        code: 'duplicate-id',
        path: `scenarios[${String(index)}].id`,
        message: `Scenario id '${entry.id}' collides with a solution id`,
      });
    }
    entry.productIds.forEach((productId, productIndex) => {
      if (!productIds.has(productId)) {
        issues.push({
          code: 'unknown-entity-reference',
          path: `scenarios[${String(index)}].productIds[${String(productIndex)}]`,
          message: `Unknown products id '${productId}'`,
        });
      }
    });
  });

  curated.narration.forEach((entry, index) => {
    if (!productIds.has(entry.productId)) {
      issues.push({
        code: 'unknown-entity-reference',
        path: `narration[${String(index)}].productId`,
        message: `Unknown products id '${entry.productId}'`,
      });
    }
  });

  curated.solutionNotes.forEach((entry, index) => {
    if (!solutionIds.has(entry.solutionId)) {
      issues.push({
        code: 'unknown-entity-reference',
        path: `solutionNotes[${String(index)}].solutionId`,
        message: `Unknown solutions id '${entry.solutionId}'`,
      });
    }
    (entry.boundariesKo ?? []).forEach((boundary, boundaryIndex) => {
      if (!solutionIds.has(boundary.solutionId)) {
        issues.push({
          code: 'unknown-entity-reference',
          path: `solutionNotes[${String(index)}].boundariesKo[${String(boundaryIndex)}].solutionId`,
          message: `Unknown solutions id '${boundary.solutionId}'`,
        });
      }
      if (boundary.solutionId === entry.solutionId) {
        issues.push({
          code: 'duplicate-id',
          path: `solutionNotes[${String(index)}].boundariesKo[${String(boundaryIndex)}].solutionId`,
          message: `Solution '${entry.solutionId}' cannot bound itself`,
        });
      }
    });
  });

  // Snapshot check: solution progress keys are namespaced because product
  // and solution ids collide. A collision outside the known snapshot means
  // the namespace contract must be consciously re-confirmed.
  const knownCollisions = new Set(KNOWN_PRODUCT_SOLUTION_COLLISIONS);
  for (const solution of catalog.solutions) {
    if (productIds.has(solution.id) && !knownCollisions.has(solution.id)) {
      issues.push({
        code: 'duplicate-id',
        path: `catalog.solutions[${solution.id}]`,
        message: `New product∩solution id collision '${solution.id}' — update KNOWN_PRODUCT_SOLUTION_COLLISIONS after re-confirming the progress-key namespace contract`,
      });
    }
  }

  return issues;
}
