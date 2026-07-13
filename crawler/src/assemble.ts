/**
 * Cross-page merge, deterministic ordering, and the final validation gate:
 * the only place a whole Catalog is constructed.
 *
 * Determinism by construction:
 * - fragments are sorted by source id first, so no later step can observe
 *   fetch-completion or config order;
 * - every collection is sorted by codepoint comparison (never localeCompare)
 *   and every object literal is written in catalog schema field order, so
 *   JSON.stringify output is fixed here and nowhere else;
 * - no clock: generatedAt is a required parameter.
 *
 * Merge semantics: claims group by identity key with fixed page-kind
 * precedence — an entity's own dedicated page beats the overviews; docs
 * pages never claim fields and only enrich provenance. Equal-precedence
 * disagreement, a product missing from the products overview, duplicate
 * source ids, and edges to entities that were never minted are explicit
 * CrawlErrors at stage 'normalize' — inconsistencies, not omissions.
 */
import {
  CATALOG_SCHEMA_VERSION,
  CatalogValidationError,
  safeParseCatalog,
  type Catalog,
  type ProductFamily,
  type Relationship,
  type RelationshipType,
  type Source,
  type SourcePageKind,
} from '@cf-viz/catalog';

import { CrawlError } from './errors.js';
import type {
  CatalogFragment,
  DocsEntryClaim,
  ProductClaim,
  SolutionClaim,
  UseCaseClaim,
} from './normalize.js';

/** Inputs {@link assembleCatalog} cannot derive deterministically itself. */
export interface AssembleOptions {
  /** UTC ISO instant stamped as the catalog's generatedAt (caller's clock). */
  readonly generatedAt: string;
}

/**
 * Fixed page-kind precedence for field merging: the entity's own dedicated
 * page > the overviews > developer docs (which never claim fields at all).
 */
const PAGE_KIND_PRECEDENCE: Readonly<Record<SourcePageKind, number>> = {
  'marketing-product': 2,
  'marketing-solution': 2,
  'marketing-overview': 1,
  'developer-docs': 0,
};

/** A claim tagged with its fragment's precedence and provenance URL. */
interface Attributed<TClaim> {
  readonly claim: TClaim;
  readonly precedence: number;
  readonly sourceUrl: string;
}

/**
 * Merge normalized fragments into one validated catalog. Throws a CrawlError
 * at stage 'normalize' for inconsistent claims and at stage 'validate' when
 * the assembled candidate fails the catalog schema (one `path: message` line
 * per issue; original issues attached via cause).
 */
export function assembleCatalog(
  fragments: readonly CatalogFragment[],
  options: AssembleOptions,
): Catalog {
  const sorted = [...fragments].sort((a, b) => compareCodepoints(a.source.id, b.source.id));
  const sources = assembleSources(sorted);
  const productFamilies = assembleFamilies(sorted);
  const docsEntries = sorted.flatMap((fragment) => fragment.docsEntryClaims);
  const products = assembleProducts(sorted, docsEntries);
  const solutions = assembleSolutions(sorted);
  const useCases = assembleUseCases(sorted);
  const relationships = assembleRelationships(sorted, {
    products: new Set(products.map((product) => product.id)),
    solutions: new Set(solutions.map((solution) => solution.id)),
    useCases: new Set(useCases.map((useCase) => useCase.id)),
  });
  const candidate = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    sources,
    productFamilies,
    products,
    solutions,
    useCases,
    relationships,
  };
  const result = safeParseCatalog(candidate);
  if (!result.success) {
    const lines = result.issues.map((issue) => `${issue.path}: ${issue.message}`);
    throw new CrawlError(`[validate] assembled catalog failed validation:\n${lines.join('\n')}`, {
      stage: 'validate',
      cause: new CatalogValidationError(result.issues),
    });
  }
  return result.data;
}

/** Codepoint string comparison (deliberately NOT localeCompare: ICU-free). */
function compareCodepoints(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** One Source per fragment, rebuilt in schema field order; duplicate ids error. */
function assembleSources(sorted: readonly CatalogFragment[]): Source[] {
  const seenUrls = new Map<string, string>();
  for (const fragment of sorted) {
    const previousUrl = seenUrls.get(fragment.source.id);
    if (previousUrl !== undefined) {
      throw new CrawlError(
        `[normalize] duplicate source id '${fragment.source.id}' claimed by ${previousUrl} and ${fragment.source.url}`,
        { stage: 'normalize' },
      );
    }
    seenUrls.set(fragment.source.id, fragment.source.url);
  }
  return sorted.map((fragment): Source => ({
    id: fragment.source.id,
    url: fragment.source.url,
    pageKind: fragment.source.pageKind,
    title: fragment.source.title,
    retrievedAt: fragment.source.retrievedAt,
  }));
}

/**
 * Group family claims by id; a second name for one id is an inconsistency
 * error (all family claims share one precedence — only the overview mints
 * them).
 *
 * The summary is a deterministic provenance-true template: the products
 * overview states family NAMES only, while the catalog schema requires a
 * non-blank summary — so the summary states exactly what we know (the name
 * and where it was grouped) and invents no product copy.
 */
function assembleFamilies(sorted: readonly CatalogFragment[]): ProductFamily[] {
  interface FamilyAccumulator {
    readonly name: string;
    readonly nameSourceUrl: string;
    readonly sourceIds: Set<string>;
  }
  const families = new Map<string, FamilyAccumulator>();
  for (const fragment of sorted) {
    for (const claim of fragment.familyClaims) {
      const existing = families.get(claim.id);
      if (existing === undefined) {
        families.set(claim.id, {
          name: claim.name,
          nameSourceUrl: fragment.source.url,
          sourceIds: new Set([claim.sourceId]),
        });
        continue;
      }
      if (existing.name !== claim.name) {
        throw new CrawlError(
          `[normalize] conflicting name for product family '${claim.id}' between ${existing.nameSourceUrl} and ${fragment.source.url}`,
          { stage: 'normalize' },
        );
      }
      existing.sourceIds.add(claim.sourceId);
    }
  }
  return [...families.entries()]
    .map(([id, accumulated]): ProductFamily => ({
      id,
      name: accumulated.name,
      summary: `Cloudflare product family "${accumulated.name}" as grouped on the official products overview.`,
      sourceIds: [...accumulated.sourceIds].sort(compareCodepoints),
    }))
    .sort((a, b) => compareCodepoints(a.id, b.id));
}

/**
 * Group product claims by identity key. Name and familyId can only come from
 * the products overview (dedicated pages claim both as null), so a group
 * without them is a product missing from the overview — an explicit error
 * naming the product page. Summary takes the highest-precedence non-null
 * value (the dedicated page's description beats the overview tagline).
 * Docs entries enrich sourceIds by exact slug === id match only.
 */
function assembleProducts(
  sorted: readonly CatalogFragment[],
  docsEntries: readonly DocsEntryClaim[],
): Catalog['products'] {
  const groups = groupClaims(
    sorted,
    (fragment) => fragment.productClaims,
    (claim) => claim.key,
  );
  return [...groups.values()]
    .map((group) => {
      const { key, id } = requireAgreedIdentity(group, 'product');
      const name = pickHighestPrecedence(group, 'name', `product '${id}'`, (claim) => claim.name);
      const summary = pickHighestPrecedence(
        group,
        'summary',
        `product '${id}'`,
        (claim) => claim.summary,
      );
      const familyId = pickHighestPrecedence(
        group,
        'familyId',
        `product '${id}'`,
        (claim) => claim.familyId,
      );
      if (name === null || summary === null || familyId === null) {
        const url = highestPrecedenceUrl(group, key);
        throw new CrawlError(
          `[normalize ${url}] product '${id}' is missing from the products overview`,
          { stage: 'normalize', url },
        );
      }
      const sourceIds = new Set(group.map((attributed) => attributed.claim.sourceId));
      for (const entry of docsEntries) {
        if (entry.slug === id) {
          sourceIds.add(entry.sourceId);
        }
      }
      return {
        id,
        name,
        summary,
        familyId,
        sourceIds: [...sourceIds].sort(compareCodepoints),
      };
    })
    .sort((a, b) => compareCodepoints(a.id, b.id));
}

/**
 * Group solution claims by identity key; every solution claim carries a name
 * and summary, so merging is pure precedence (dedicated page wins over the
 * overview). No familyId, no docs enrichment.
 */
function assembleSolutions(sorted: readonly CatalogFragment[]): Catalog['solutions'] {
  const groups = groupClaims(
    sorted,
    (fragment) => fragment.solutionClaims,
    (claim) => claim.key,
  );
  return [...groups.values()]
    .map((group) => {
      const { key, id } = requireAgreedIdentity(group, 'solution');
      const name = pickHighestPrecedence(group, 'name', `solution '${id}'`, (claim) => claim.name);
      const summary = pickHighestPrecedence(
        group,
        'summary',
        `solution '${id}'`,
        (claim) => claim.summary,
      );
      if (name === null || summary === null) {
        // Unreachable by construction (SolutionClaim fields are non-null);
        // kept so the compiler enforces it.
        const url = highestPrecedenceUrl(group, key);
        throw new CrawlError(`[normalize ${url}] solution '${id}' claims no name or summary`, {
          stage: 'normalize',
          url,
        });
      }
      const sourceIds = new Set(group.map((attributed) => attributed.claim.sourceId));
      return { id, name, summary, sourceIds: [...sourceIds].sort(compareCodepoints) };
    })
    .sort((a, b) => compareCodepoints(a.id, b.id));
}

/**
 * Group use-case claims by id (their identity key: use cases have no URL).
 * All use-case claims share one precedence, so any disagreement on name or
 * summary is an inconsistency error.
 */
function assembleUseCases(sorted: readonly CatalogFragment[]): Catalog['useCases'] {
  const groups = groupClaims(
    sorted,
    (fragment) => fragment.useCaseClaims,
    (claim) => claim.id,
  );
  return [...groups.values()]
    .map((group) => {
      const { id } = requireAgreedIdentity(group, 'use case');
      const name = pickHighestPrecedence(group, 'name', `use case '${id}'`, (claim) => claim.name);
      const summary = pickHighestPrecedence(
        group,
        'summary',
        `use case '${id}'`,
        (claim) => claim.summary,
      );
      if (name === null || summary === null) {
        // Unreachable by construction (UseCaseClaim fields are non-null).
        const url = highestPrecedenceUrl(group, id);
        throw new CrawlError(`[normalize ${url}] use case '${id}' claims no name or summary`, {
          stage: 'normalize',
          url,
        });
      }
      const sourceIds = new Set(group.map((attributed) => attributed.claim.sourceId));
      return { id, name, summary, sourceIds: [...sourceIds].sort(compareCodepoints) };
    })
    .sort((a, b) => compareCodepoints(a.id, b.id));
}

/** The from/to entity collections each relationship type must resolve in. */
type EntityIdSets = Readonly<Record<'products' | 'solutions' | 'useCases', ReadonlySet<string>>>;

const RELATIONSHIP_ENDPOINT_SETS: Readonly<
  Record<RelationshipType, readonly [keyof EntityIdSets, keyof EntityIdSets]>
> = {
  'product-solution': ['products', 'solutions'],
  'product-use-case': ['products', 'useCases'],
  'solution-use-case': ['solutions', 'useCases'],
};

/**
 * Dedupe edge claims by (type, fromId, toId) with unioned sourceIds, then
 * require both endpoints to exist in the collections the type implies. An
 * explicitly claimed edge whose endpoint entity could not be minted is an
 * inconsistency (extraction incomplete), never a silent omission.
 */
function assembleRelationships(
  sorted: readonly CatalogFragment[],
  entityIds: EntityIdSets,
): Relationship[] {
  interface EdgeAccumulator {
    readonly type: RelationshipType;
    readonly fromId: string;
    readonly toId: string;
    readonly sourceIds: Set<string>;
    readonly claimUrl: string;
  }
  const edges = new Map<string, EdgeAccumulator>();
  for (const fragment of sorted) {
    for (const claim of fragment.edgeClaims) {
      const dedupeKey = `${claim.type} ${claim.fromId} ${claim.toId}`;
      const existing = edges.get(dedupeKey);
      if (existing === undefined) {
        edges.set(dedupeKey, {
          type: claim.type,
          fromId: claim.fromId,
          toId: claim.toId,
          sourceIds: new Set([claim.sourceId]),
          claimUrl: fragment.source.url,
        });
        continue;
      }
      existing.sourceIds.add(claim.sourceId);
    }
  }
  return [...edges.values()]
    .map((edge): Relationship => {
      const [fromCollection, toCollection] = RELATIONSHIP_ENDPOINT_SETS[edge.type];
      requireEndpoint(edge.type, edge.fromId, entityIds[fromCollection], edge.claimUrl);
      requireEndpoint(edge.type, edge.toId, entityIds[toCollection], edge.claimUrl);
      return {
        type: edge.type,
        fromId: edge.fromId,
        toId: edge.toId,
        sourceIds: [...edge.sourceIds].sort(compareCodepoints),
      };
    })
    .sort((a, b) => {
      const byType = compareCodepoints(a.type, b.type);
      if (byType !== 0) {
        return byType;
      }
      const byFrom = compareCodepoints(a.fromId, b.fromId);
      if (byFrom !== 0) {
        return byFrom;
      }
      return compareCodepoints(a.toId, b.toId);
    });
}

/** A dangling edge endpoint is an inconsistency error, not an omission. */
function requireEndpoint(
  type: RelationshipType,
  endpointId: string,
  minted: ReadonlySet<string>,
  claimUrl: string,
): void {
  if (!minted.has(endpointId)) {
    throw new CrawlError(
      `[normalize ${claimUrl}] relationship '${type}' references '${endpointId}', which resolves to no assembled entity`,
      { stage: 'normalize', url: claimUrl },
    );
  }
}

/** Flatten one claim collection across fragments and group by identity key. */
function groupClaims<TClaim>(
  sorted: readonly CatalogFragment[],
  claimsOf: (fragment: CatalogFragment) => readonly TClaim[],
  keyOf: (claim: TClaim) => string,
): Map<string, Attributed<TClaim>[]> {
  const groups = new Map<string, Attributed<TClaim>[]>();
  for (const fragment of sorted) {
    const precedence = PAGE_KIND_PRECEDENCE[fragment.source.pageKind];
    for (const claim of claimsOf(fragment)) {
      const key = keyOf(claim);
      const group = groups.get(key);
      const attributed: Attributed<TClaim> = { claim, precedence, sourceUrl: fragment.source.url };
      if (group === undefined) {
        groups.set(key, [attributed]);
      } else {
        group.push(attributed);
      }
    }
  }
  return groups;
}

/**
 * Every claim in a group must agree on the serialized id (same identity key
 * implies the same idFromPath by construction — asserted defensively).
 */
function requireAgreedIdentity(
  group: readonly Attributed<ProductClaim | SolutionClaim | UseCaseClaim>[],
  entityKind: string,
): { readonly key: string; readonly id: string } {
  const [head] = group;
  if (head === undefined) {
    throw new CrawlError(`[normalize] empty ${entityKind} claim group`, { stage: 'normalize' });
  }
  const ids = new Set(group.map((attributed) => attributed.claim.id));
  if (ids.size > 1) {
    const urls = distinctSortedUrls(group);
    throw new CrawlError(
      `[normalize] one ${entityKind} identity produced conflicting ids ${[...ids]
        .sort(compareCodepoints)
        .map((id) => `'${id}'`)
        .join(', ')} between ${urls}`,
      { stage: 'normalize' },
    );
  }
  const key = 'key' in head.claim ? head.claim.key : head.claim.id;
  return { key, id: head.claim.id };
}

/**
 * Highest-precedence non-null value for one field; two claims at the SAME
 * precedence disagreeing is an inconsistency error naming both source URLs.
 * Returns null when no claim states the field.
 */
function pickHighestPrecedence<TClaim>(
  group: readonly Attributed<TClaim>[],
  fieldName: string,
  entityDescription: string,
  valueOf: (claim: TClaim) => string | null,
): string | null {
  const levels = [...new Set(group.map((attributed) => attributed.precedence))].sort(
    (a, b) => b - a,
  );
  for (const level of levels) {
    const carriers = group.filter(
      (attributed) => attributed.precedence === level && valueOf(attributed.claim) !== null,
    );
    const [winner] = carriers;
    if (winner === undefined) {
      continue;
    }
    const values = new Set(carriers.map((attributed) => valueOf(attributed.claim)));
    if (values.size > 1) {
      throw new CrawlError(
        `[normalize] conflicting ${fieldName} for ${entityDescription} between ${distinctSortedUrls(carriers)}`,
        { stage: 'normalize' },
      );
    }
    return valueOf(winner.claim);
  }
  return null;
}

/** URL of the highest-precedence claim in a group (deterministic tiebreak). */
function highestPrecedenceUrl(group: readonly Attributed<unknown>[], fallback: string): string {
  const [best] = [...group].sort((a, b) => {
    if (a.precedence !== b.precedence) {
      return b.precedence - a.precedence;
    }
    return compareCodepoints(a.sourceUrl, b.sourceUrl);
  });
  return best === undefined ? fallback : best.sourceUrl;
}

/** Distinct claim source URLs, codepoint-sorted, comma-joined for messages. */
function distinctSortedUrls(group: readonly Attributed<unknown>[]): string {
  return [...new Set(group.map((attributed) => attributed.sourceUrl))]
    .sort(compareCodepoints)
    .join(' and ');
}
