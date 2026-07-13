/**
 * Contract between the selector-owning per-kind parsers and normalization.
 *
 * Invariants every parser upholds:
 * - every string is whitespace-collapsed (HTML whitespace is not semantic);
 * - every href is resolved ABSOLUTE against the page's canonical URL
 *   (`new URL(href, base)`), so downstream code never sees relative paths.
 *
 * Note there is deliberately no `solutionRefs` field on the marketing-product
 * variant: recon proved the approved pages contain zero explicit
 * product-to-solution statements (the /solutions/ links on product pages are
 * the global footer nav, which must not be mined).
 */
import type { SourcePageKind } from '@cf-viz/catalog';

/** A bare (text, href) pair — a link that can support an edge but cannot mint an entity. */
export interface RawLink {
  /** Collapsed link text. */
  readonly text: string;
  /** Absolute URL the link points at. */
  readonly href: string;
}

/** A fully-specifiable entity found on a page: name plus display copy. */
export interface RawEntityCard {
  /** Collapsed official name (bounded to the catalog name cap upstream). */
  readonly name: string;
  /** Collapsed, deterministically trimmed display copy; never blank. */
  readonly summary: string;
  /** Absolute URL for the card, or null when the card carries no link of its own. */
  readonly href: string | null;
}

/**
 * One product card on the products overview. Unlike {@link RawEntityCard},
 * the tagline is nullable: the live overview ships genuine product cards
 * whose tagline paragraph is empty (observed 2026-07-13 on
 * /products/ddos-for-web/), while the strong name and the href stay required
 * — a card missing either is still structure drift.
 */
export interface ProductCard {
  /** Collapsed official name (bounded to the catalog name cap upstream). */
  readonly name: string;
  /** Collapsed, deterministically trimmed tagline, or null when the card states none. */
  readonly tagline: string | null;
  /** Absolute URL for the card (product identity — always required). */
  readonly href: string;
}

/** A heading-grouped run of product cards (one products-overview family figure). */
export interface ProductTaxonomySection {
  /** Collapsed family name from the figcaption. */
  readonly heading: string;
  /** Product cards inside the family; the parser requires at least one. */
  readonly items: readonly ProductCard[];
}

/** Per-fetch identity handed to every parser (all fields from FetchResult). */
export interface PageMeta {
  /** Configured source id the fetch belongs to. */
  readonly sourceId: string;
  /** Final (post-redirect) URL the body was retrieved from. */
  readonly url: string;
  /** UTC ISO timestamp (`Z` suffix) of the fetch. */
  readonly retrievedAt: string;
}

/** Fields shared by every parsed page, extracted identically for all kinds. */
export interface ParsedPageBase {
  /** Configured source id the page was fetched for. */
  readonly sourceId: string;
  /** Absolute `link[rel="canonical"]` URL; verified to match the fetched URL. */
  readonly canonicalUrl: string;
  /** Collapsed `<title>` text (official page title, <= 200 chars). */
  readonly title: string;
  /** Collapsed `meta[name="description"]` copy, trimmed to <= 500 chars. */
  readonly description: string;
  /** UTC ISO timestamp of the fetch, passed through untouched. */
  readonly retrievedAt: string;
}

/**
 * Discriminated union of every approved page shape. Parser kinds are FINER
 * than the configured {@link SourcePageKind}: both overview seeds share
 * 'marketing-overview' but have structurally unrelated payloads, so detection
 * subdivides and {@link sourcePageKindOf} maps back.
 */
export type ParsedPage =
  | (ParsedPageBase & {
      readonly kind: 'products-overview';
      /** One section per family figure; heading = family name. */
      readonly families: readonly ProductTaxonomySection[];
    })
  | (ParsedPageBase & {
      readonly kind: 'solutions-overview';
      /** One card per solution benefit tile. */
      readonly solutions: readonly RawEntityCard[];
    })
  | (ParsedPageBase & {
      readonly kind: 'marketing-product';
      /** Explicit use-case cards; empty only when the section is absent. */
      readonly useCases: readonly RawEntityCard[];
    })
  | (ParsedPageBase & {
      readonly kind: 'marketing-solution';
      /** Official solution name from the hero eyebrow. */
      readonly solutionName: string;
      /** Explicit use-case cards; empty only when the section is absent. */
      readonly useCases: readonly RawEntityCard[];
    })
  | (ParsedPageBase & {
      readonly kind: 'developer-docs';
      /** One card per docs-directory entry. */
      readonly entries: readonly RawEntityCard[];
    });

/** Union of the finer parser-level page kinds. */
export type ParsedPageKind = ParsedPage['kind'];

/**
 * Map a finer parser kind back to the catalog {@link SourcePageKind}. This is
 * the single source of that mapping: 'products-overview' and
 * 'solutions-overview' both fold into 'marketing-overview'; every other kind
 * maps to itself.
 */
export function sourcePageKindOf(kind: ParsedPageKind): SourcePageKind {
  switch (kind) {
    case 'products-overview':
    case 'solutions-overview':
      return 'marketing-overview';
    case 'marketing-product':
    case 'marketing-solution':
    case 'developer-docs':
      return kind;
  }
}
