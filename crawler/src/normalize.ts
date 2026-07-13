/**
 * Per-page normalization: map one {@link ParsedPage} to a
 * {@link CatalogFragment} of claims, with no cross-page knowledge.
 *
 * String in, claims out; no DOM, no network, no clock. Every claim states
 * only what its own page says: identity keys and ids are pure functions of
 * page content and URLs (never of array position), and fields the page does
 * not state stay null (e.g. a dedicated product page claims no official name
 * — the products overview owns it). Cross-page merging, precedence, and
 * conflict detection all live in assemble.ts.
 *
 * Family summaries are deliberately NOT claimed here: the products overview
 * states family names only, so the schema-required summary is built in
 * assemble.ts from a provenance-true template.
 */
import type { RelationshipType, Source, SourcePageKind } from '@cf-viz/catalog';

import { CrawlError } from './errors.js';
import { idFromPath, pathKeyOf, slugify } from './ids.js';
import type { ParsedPage, RawEntityCard } from './parse/index.js';

/** One page's statement that a product family exists under this name. */
export interface FamilyClaim {
  /** Family id: `slugify(heading)` (families have no page of their own). */
  readonly id: string;
  /** Official family name as stated by the overview heading. */
  readonly name: string;
  /** Source the claim was extracted from. */
  readonly sourceId: string;
}

/** One page's (possibly partial) statement about a product. */
export interface ProductClaim {
  /** Cross-page identity key: `pathKeyOf` of the card href / canonical URL. */
  readonly key: string;
  /** Serialized id: `idFromPath` of the same URL. */
  readonly id: string;
  /** Official name, or null when this page does not own the name. */
  readonly name: string | null;
  /** Display copy, or null when this page states none. */
  readonly summary: string | null;
  /** Family membership, or null (only the products overview states it). */
  readonly familyId: string | null;
  /** Source the claim was extracted from. */
  readonly sourceId: string;
}

/** One page's statement about a solution. */
export interface SolutionClaim {
  /** Cross-page identity key: `pathKeyOf` of the card href / canonical URL. */
  readonly key: string;
  /** Serialized id: `idFromPath` of the same URL. */
  readonly id: string;
  /** Official solution name as stated by this page. */
  readonly name: string;
  /** Display copy as stated by this page. */
  readonly summary: string;
  /** Source the claim was extracted from. */
  readonly sourceId: string;
}

/** One page's statement about a use case (id = `slugify(name)`; no URL). */
export interface UseCaseClaim {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  /** Source the claim was extracted from. */
  readonly sourceId: string;
}

/** One page's explicit statement of a typed relationship between entities. */
export interface EdgeClaim {
  readonly type: RelationshipType;
  readonly fromId: string;
  readonly toId: string;
  /** Source the claim was extracted from. */
  readonly sourceId: string;
}

/**
 * One docs-directory entry. Docs pages mint NO entities; they only enrich
 * provenance of already-minted products by exact slug match in assemble.ts.
 */
export interface DocsEntryClaim {
  /** The href's slug when its path has EXACTLY one segment, else null. */
  readonly slug: string | null;
  /** Source the claim was extracted from. */
  readonly sourceId: string;
}

/** Everything one page claims, plus its provenance Source record. */
export interface CatalogFragment {
  readonly source: Source;
  readonly familyClaims: readonly FamilyClaim[];
  readonly productClaims: readonly ProductClaim[];
  readonly solutionClaims: readonly SolutionClaim[];
  readonly useCaseClaims: readonly UseCaseClaim[];
  readonly edgeClaims: readonly EdgeClaim[];
  readonly docsEntryClaims: readonly DocsEntryClaim[];
}

/** Optional claim collections for {@link buildFragment}; absent means none. */
interface FragmentParts {
  readonly familyClaims?: readonly FamilyClaim[];
  readonly productClaims?: readonly ProductClaim[];
  readonly solutionClaims?: readonly SolutionClaim[];
  readonly useCaseClaims?: readonly UseCaseClaim[];
  readonly edgeClaims?: readonly EdgeClaim[];
  readonly docsEntryClaims?: readonly DocsEntryClaim[];
}

/**
 * Map one parsed page to its catalog fragment. The Source record is built
 * from the shared {@link ParsedPage} base fields plus the CONFIGURED page
 * kind (the catalog enum is coarser than the parser kinds); the claims are
 * the per-kind mapping documented on each branch.
 */
export function normalizePage(page: ParsedPage, configuredKind: SourcePageKind): CatalogFragment {
  const source: Source = {
    id: page.sourceId,
    url: page.canonicalUrl,
    pageKind: configuredKind,
    title: page.title,
    retrievedAt: page.retrievedAt,
  };
  switch (page.kind) {
    case 'products-overview': {
      // One FamilyClaim per section (heading = the only stable family
      // handle) and one ProductClaim per card; the overview owns official
      // names, taglines, and family membership. It states no edges.
      const familyClaims: FamilyClaim[] = [];
      const productClaims: ProductClaim[] = [];
      for (const family of page.families) {
        const familyId = slugify(family.heading);
        familyClaims.push({ id: familyId, name: family.heading, sourceId: source.id });
        for (const card of family.items) {
          const href = requireCardHref(card, 'product', page.canonicalUrl);
          productClaims.push({
            key: pathKeyOf(href),
            id: idFromPath(href),
            name: card.name,
            summary: card.summary,
            familyId,
            sourceId: source.id,
          });
        }
      }
      return buildFragment(source, { familyClaims, productClaims });
    }
    case 'solutions-overview': {
      // One SolutionClaim per benefit tile; identity comes from the tile's
      // overlay anchor href.
      const solutionClaims = page.solutions.map((card): SolutionClaim => {
        const href = requireCardHref(card, 'solution', page.canonicalUrl);
        return {
          key: pathKeyOf(href),
          id: idFromPath(href),
          name: card.name,
          summary: card.summary,
          sourceId: source.id,
        };
      });
      return buildFragment(source, { solutionClaims });
    }
    case 'marketing-product': {
      // The dedicated page claims the product by its canonical URL with
      // name/familyId null (the overview owns both) and the meta description
      // as summary, plus its explicit use cases and the product-use-case
      // edges the page itself states.
      const productId = idFromPath(page.canonicalUrl);
      const productClaims: readonly ProductClaim[] = [
        {
          key: pathKeyOf(page.canonicalUrl),
          id: productId,
          name: null,
          summary: page.description,
          familyId: null,
          sourceId: source.id,
        },
      ];
      const useCaseClaims = toUseCaseClaims(page.useCases, source.id);
      const edgeClaims = toEdgeClaims('product-use-case', productId, useCaseClaims, source.id);
      return buildFragment(source, { productClaims, useCaseClaims, edgeClaims });
    }
    case 'marketing-solution': {
      // The dedicated page fully specifies its solution (hero eyebrow name +
      // meta description) plus its explicit use cases and edges.
      const solutionId = idFromPath(page.canonicalUrl);
      const solutionClaims: readonly SolutionClaim[] = [
        {
          key: pathKeyOf(page.canonicalUrl),
          id: solutionId,
          name: page.solutionName,
          summary: page.description,
          sourceId: source.id,
        },
      ];
      const useCaseClaims = toUseCaseClaims(page.useCases, source.id);
      const edgeClaims = toEdgeClaims('solution-use-case', solutionId, useCaseClaims, source.id);
      return buildFragment(source, { solutionClaims, useCaseClaims, edgeClaims });
    }
    case 'developer-docs': {
      // Docs pages mint NO entities: each entry only offers a slug for
      // provenance enrichment when its href path has exactly one segment.
      const docsEntryClaims = page.entries.map((entry): DocsEntryClaim => ({
        slug: docsSlugOf(entry.href),
        sourceId: source.id,
      }));
      return buildFragment(source, { docsEntryClaims });
    }
  }
}

/** Assemble a fragment with every unstated claim collection empty. */
function buildFragment(source: Source, parts: FragmentParts): CatalogFragment {
  return {
    source,
    familyClaims: parts.familyClaims ?? [],
    productClaims: parts.productClaims ?? [],
    solutionClaims: parts.solutionClaims ?? [],
    useCaseClaims: parts.useCaseClaims ?? [],
    edgeClaims: parts.edgeClaims ?? [],
    docsEntryClaims: parts.docsEntryClaims ?? [],
  };
}

/**
 * Overview cards must carry an href — it is the entity's identity. A card
 * without one cannot be normalized (defensive: the parsers require hrefs on
 * overview cards already).
 */
function requireCardHref(card: RawEntityCard, entityKind: string, url: string): string {
  if (card.href === null) {
    throw new CrawlError(
      `[normalize ${url}] ${entityKind} card '${card.name}' carries no href to derive identity from`,
      { stage: 'normalize', url },
    );
  }
  return card.href;
}

/** Map use-case cards to claims; the card name is the only stable handle. */
function toUseCaseClaims(
  cards: readonly RawEntityCard[],
  sourceId: string,
): readonly UseCaseClaim[] {
  return cards.map((card): UseCaseClaim => ({
    id: slugify(card.name),
    name: card.name,
    summary: card.summary,
    sourceId,
  }));
}

/** One explicit edge per use-case card, from the page's own entity. */
function toEdgeClaims(
  type: RelationshipType,
  fromId: string,
  useCaseClaims: readonly UseCaseClaim[],
  sourceId: string,
): readonly EdgeClaim[] {
  return useCaseClaims.map((useCase): EdgeClaim => ({ type, fromId, toId: useCase.id, sourceId }));
}

/**
 * Slug of a docs-entry href when its path has EXACTLY one segment (e.g.
 * '/workers/' → 'workers'); multi-segment hrefs identify sub-pages, not
 * products, and yield null.
 */
function docsSlugOf(href: string | null): string | null {
  if (href === null) {
    return null;
  }
  const segments = new URL(href).pathname.split('/').filter((segment) => segment.length > 0);
  const [only] = segments;
  if (segments.length !== 1 || only === undefined) {
    return null;
  }
  return slugify(only);
}
