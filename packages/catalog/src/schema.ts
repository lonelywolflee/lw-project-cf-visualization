import { z } from 'zod';

/**
 * The only `schemaVersion` value this package can parse.
 *
 * Bump on breaking catalog changes, shipped together with the matching web
 * and crawler updates in a single issue.
 */
export const CATALOG_SCHEMA_VERSION = '1';

/**
 * Every supported source page kind, in canonical order.
 *
 * Marketing kinds live on `www.cloudflare.com`; `developer-docs` lives on
 * `developers.cloudflare.com`. The coupling is validated per source.
 */
export const SOURCE_PAGE_KINDS = [
  'marketing-product',
  'marketing-solution',
  'marketing-overview',
  'developer-docs',
] as const;

/** Union of the supported source page kinds. */
export type SourcePageKind = (typeof SOURCE_PAGE_KINDS)[number];

/**
 * Every supported relationship type.
 *
 * The from/to entity collections are implied by the name and enforced by
 * the referential-integrity validation.
 */
export const RELATIONSHIP_TYPES = [
  'product-solution',
  'product-use-case',
  'solution-use-case',
] as const;

/** Union of the supported relationship types. */
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/**
 * Exact hostnames a canonical source URL may use.
 *
 * The marketing site canonicalizes to `www.cloudflare.com` (the apex host
 * redirects there), and Developer Docs have no `www` variant.
 */
export const APPROVED_SOURCE_HOSTNAMES = [
  'www.cloudflare.com',
  'developers.cloudflare.com',
] as const;

const approvedHostnamePattern = new RegExp(
  `^(?:${APPROVED_SOURCE_HOSTNAMES.map((hostname) => hostname.replaceAll('.', '\\.')).join('|')})$`,
);

/**
 * Stable lowercase kebab-case identifier; never a URL or an array index.
 *
 * Shared contract: crawler source config ids must satisfy this schema
 * because they become catalog Source ids verbatim.
 */
export const idSlugSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error: 'Id must be a lowercase kebab-case slug',
  });

/**
 * Non-empty text with an explicit length cap; whitespace-only is rejected.
 *
 * Package-internal (not re-exported from the index): shared by the catalog
 * and curated schemas so both enforce identical text rules.
 */
export const nonBlankString = (maxLength: number) =>
  z
    .string()
    .min(1, { abort: true })
    .max(maxLength)
    .regex(/\S/, { error: 'Value must not be blank' });

/** At least one source reference, without duplicates. */
const sourceIdList = z
  .array(idSlugSchema)
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length, {
    error: 'sourceIds must not contain duplicate ids',
  });

/**
 * ISO-8601 UTC instant with a mandatory trailing `Z` (offsets rejected).
 *
 * Package-internal (not re-exported from the index).
 */
export const utcInstant = z.iso.datetime();

/**
 * Canonical `https` URL on an approved Cloudflare hostname, free of query,
 * fragment, port, and credentials so provenance stays deterministic.
 *
 * Package-internal (not re-exported from the index).
 */
export const canonicalSourceUrl = z
  .url({
    protocol: /^https$/,
    hostname: approvedHostnamePattern,
    error: 'URL must be https on an approved Cloudflare hostname',
  })
  .max(300)
  .refine(
    (value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return true; // Unparseable input is already reported by z.url().
      }
      return (
        url.search === '' &&
        url.hash === '' &&
        url.port === '' &&
        url.username === '' &&
        url.password === ''
      );
    },
    { error: 'URL must not contain a query, fragment, port, or credentials' },
  );

const sourceSchema = z
  .strictObject({
    id: idSlugSchema,
    url: canonicalSourceUrl,
    pageKind: z.enum(SOURCE_PAGE_KINDS),
    title: nonBlankString(200),
    retrievedAt: utcInstant,
  })
  .check((ctx) => {
    let hostname: string;
    try {
      hostname = new URL(ctx.value.url).hostname;
    } catch {
      return; // Unparseable URL is already reported by the field schema.
    }
    if (!approvedHostnamePattern.test(hostname)) {
      return; // Non-approved hostname is already reported by the field schema.
    }
    const expectedHostname =
      ctx.value.pageKind === 'developer-docs' ? 'developers.cloudflare.com' : 'www.cloudflare.com';
    if (hostname !== expectedHostname) {
      ctx.issues.push({
        code: 'custom',
        message: `pageKind '${ctx.value.pageKind}' requires hostname '${expectedHostname}'`,
        path: ['pageKind'],
        input: ctx.value.pageKind,
      });
    }
  });

const productFamilySchema = z.strictObject({
  id: idSlugSchema,
  name: nonBlankString(120),
  summary: nonBlankString(500),
  sourceIds: sourceIdList,
});

const productSchema = z.strictObject({
  id: idSlugSchema,
  name: nonBlankString(120),
  summary: nonBlankString(500),
  familyId: idSlugSchema,
  sourceIds: sourceIdList,
});

const solutionSchema = z.strictObject({
  id: idSlugSchema,
  name: nonBlankString(120),
  summary: nonBlankString(500),
  sourceIds: sourceIdList,
});

const useCaseSchema = z.strictObject({
  id: idSlugSchema,
  name: nonBlankString(120),
  summary: nonBlankString(500),
  sourceIds: sourceIdList,
});

const relationshipSchema = z.strictObject({
  type: z.enum(RELATIONSHIP_TYPES),
  fromId: idSlugSchema,
  toId: idSlugSchema,
  sourceIds: sourceIdList,
});

/**
 * Runtime schema for a whole catalog document — the single source of both
 * validation and the {@link Catalog} type.
 *
 * Prefer {@link parseCatalog} / {@link safeParseCatalog}, which apply the
 * full validation pipeline on top of this shape.
 */
export const catalogSchema = z.strictObject({
  schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
  generatedAt: utcInstant,
  sources: z.array(sourceSchema),
  productFamilies: z.array(productFamilySchema),
  products: z.array(productSchema),
  solutions: z.array(solutionSchema),
  useCases: z.array(useCaseSchema),
  relationships: z.array(relationshipSchema),
});

/** A fully validated catalog document. */
export type Catalog = z.output<typeof catalogSchema>;

/** Provenance record for one crawled official page. */
export type Source = Catalog['sources'][number];

/** Official top-level Cloudflare product taxonomy entry. */
export type ProductFamily = Catalog['productFamilies'][number];

/** Official Cloudflare product with its family reference. */
export type Product = Catalog['products'][number];

/** Official solution as stated on cloudflare.com. */
export type Solution = Catalog['solutions'][number];

/** Official use case as stated on official pages. */
export type UseCase = Catalog['useCases'][number];

/** Source-backed typed edge; identity is the (type, fromId, toId) triple. */
export type Relationship = Catalog['relationships'][number];

/**
 * From/to entity collections required by each relationship type.
 *
 * Package-internal: consumers derive endpoint kinds from the type name.
 */
export const RELATIONSHIP_ENDPOINTS = {
  'product-solution': ['products', 'solutions'],
  'product-use-case': ['products', 'useCases'],
  'solution-use-case': ['solutions', 'useCases'],
} as const satisfies Record<
  RelationshipType,
  readonly ['products' | 'solutions' | 'useCases', 'products' | 'solutions' | 'useCases']
>;
