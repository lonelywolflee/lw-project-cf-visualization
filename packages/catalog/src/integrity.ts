import type { CatalogIssue } from './errors.js';
import { RELATIONSHIP_ENDPOINTS, type Catalog } from './schema.js';

interface IdentifiedEntity {
  readonly id: string;
}

type SourcedEntityCollection =
  'productFamilies' | 'products' | 'solutions' | 'useCases' | 'relationships';

function collectIdSet(
  collection: 'sources' | 'productFamilies' | 'products' | 'solutions' | 'useCases',
  entities: readonly IdentifiedEntity[],
  issues: CatalogIssue[],
): ReadonlySet<string> {
  const seen = new Set<string>();
  entities.forEach((entity, index) => {
    if (seen.has(entity.id)) {
      issues.push({
        code: 'duplicate-id',
        path: `${collection}[${String(index)}].id`,
        message: `Duplicate id '${entity.id}' in ${collection}`,
      });
    }
    seen.add(entity.id);
  });
  return seen;
}

function checkSourceReferences(
  collection: SourcedEntityCollection,
  entries: readonly { readonly sourceIds: readonly string[] }[],
  knownSourceIds: ReadonlySet<string>,
  issues: CatalogIssue[],
): void {
  entries.forEach((entry, index) => {
    entry.sourceIds.forEach((sourceId, sourceIndex) => {
      if (!knownSourceIds.has(sourceId)) {
        issues.push({
          code: 'unknown-source-reference',
          path: `${collection}[${String(index)}].sourceIds[${String(sourceIndex)}]`,
          message: `Unknown source id '${sourceId}'`,
        });
      }
    });
  });
}

/**
 * Collects every cross-entity integrity issue in a shape-valid catalog:
 * duplicate ids per collection, references to unknown sources or entities,
 * and duplicate relationship edges. Returns an empty array when sound.
 */
export function collectIntegrityIssues(catalog: Catalog): CatalogIssue[] {
  const issues: CatalogIssue[] = [];

  const sourceIds = collectIdSet('sources', catalog.sources, issues);
  const entityIds = {
    productFamilies: collectIdSet('productFamilies', catalog.productFamilies, issues),
    products: collectIdSet('products', catalog.products, issues),
    solutions: collectIdSet('solutions', catalog.solutions, issues),
    useCases: collectIdSet('useCases', catalog.useCases, issues),
  };

  checkSourceReferences('productFamilies', catalog.productFamilies, sourceIds, issues);
  checkSourceReferences('products', catalog.products, sourceIds, issues);
  checkSourceReferences('solutions', catalog.solutions, sourceIds, issues);
  checkSourceReferences('useCases', catalog.useCases, sourceIds, issues);
  checkSourceReferences('relationships', catalog.relationships, sourceIds, issues);

  catalog.products.forEach((product, index) => {
    if (!entityIds.productFamilies.has(product.familyId)) {
      issues.push({
        code: 'unknown-entity-reference',
        path: `products[${String(index)}].familyId`,
        message: `Unknown productFamilies id '${product.familyId}'`,
      });
    }
  });

  const seenEdges = new Set<string>();
  catalog.relationships.forEach((relationship, index) => {
    const [fromCollection, toCollection] = RELATIONSHIP_ENDPOINTS[relationship.type];
    if (!entityIds[fromCollection].has(relationship.fromId)) {
      issues.push({
        code: 'unknown-entity-reference',
        path: `relationships[${String(index)}].fromId`,
        message: `Unknown ${fromCollection} id '${relationship.fromId}'`,
      });
    }
    if (!entityIds[toCollection].has(relationship.toId)) {
      issues.push({
        code: 'unknown-entity-reference',
        path: `relationships[${String(index)}].toId`,
        message: `Unknown ${toCollection} id '${relationship.toId}'`,
      });
    }
    const edgeKey = `${relationship.type} ${relationship.fromId} ${relationship.toId}`;
    if (seenEdges.has(edgeKey)) {
      issues.push({
        code: 'duplicate-relationship',
        path: `relationships[${String(index)}]`,
        message: `Duplicate relationship '${relationship.type}' from '${relationship.fromId}' to '${relationship.toId}'`,
      });
    }
    seenEdges.add(edgeKey);
  });

  return issues;
}
