import { z } from 'zod';

import { canonicalSourceUrl, idSlugSchema, nonBlankString, utcInstant } from './schema.js';

/**
 * The only `schemaVersion` value the curated dataset can carry.
 *
 * Versioned independently of the crawled catalog: the two documents evolve
 * on different cadences (curation edits vs crawler releases).
 */
export const CURATED_SCHEMA_VERSION = '1';

/**
 * Every lane of the path-and-layer map, in display order.
 *
 * `public-web` is the visitor→origin journey; `zero-trust` is the
 * workforce→internet/private-app journey. A product may appear in both.
 */
export const CURATED_LANES = ['public-web', 'zero-trust'] as const;

/** Union of the supported lanes. */
export type CuratedLane = (typeof CURATED_LANES)[number];

/**
 * Layers per lane, in request-traversal order (top of the map first).
 * `observability` is the one off-path layer: monitoring products observe
 * the other layers instead of sitting on the request path, so it renders
 * as a side band rather than a traversal step.
 *
 * Layer slugs are globally unique across lanes so a layer value alone
 * identifies one map row; the placement schema still validates the pair.
 */
export const CURATED_LANE_LAYERS = {
  'public-web': [
    'dns-connectivity',
    'network-l3-l4',
    'application-security',
    'application-performance',
    'compute-platform',
    'observability',
  ],
  'zero-trust': ['access-control', 'data-protection', 'network-services'],
} as const satisfies Record<CuratedLane, readonly string[]>;

const ALL_CURATED_LAYERS = [
  ...CURATED_LANE_LAYERS['public-web'],
  ...CURATED_LANE_LAYERS['zero-trust'],
] as const;

/** Union of every layer slug across both lanes. */
export type CuratedLayer = (typeof ALL_CURATED_LAYERS)[number];

const placementSchema = z
  .strictObject({
    lane: z.enum(CURATED_LANES),
    layer: z.enum(ALL_CURATED_LAYERS),
  })
  .check((ctx) => {
    const laneLayers: readonly string[] = CURATED_LANE_LAYERS[ctx.value.lane];
    if (!laneLayers.includes(ctx.value.layer)) {
      ctx.issues.push({
        code: 'custom',
        message: `Layer '${ctx.value.layer}' does not belong to lane '${ctx.value.lane}'`,
        path: ['layer'],
        input: ctx.value.layer,
      });
    }
  });

const curatedProductSchema = z.strictObject({
  productId: idSlugSchema,
  roleKo: nonBlankString(200),
  placements: z
    .array(placementSchema)
    .min(1)
    .refine(
      (placements) =>
        new Set(placements.map((placement) => `${placement.lane} ${placement.layer}`)).size ===
        placements.length,
      { error: 'placements must not contain duplicate lane/layer pairs' },
    ),
  sourceUrl: canonicalSourceUrl,
  verifiedAt: utcInstant,
});

const curatedCompositionSchema = z.strictObject({
  solutionId: idSlugSchema,
  productIds: z
    .array(idSlugSchema)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      error: 'productIds must not contain duplicate ids',
    }),
  sourceUrl: canonicalSourceUrl,
  verifiedAt: utcInstant,
});

/**
 * A quota shown on the pricing panel; not used for cost math.
 *
 * `per` is absent for static caps (e.g. total storage) and present for
 * recurring allowances. `invocation` covers per-call limits like CPU time.
 */
const includedLimitSchema = z.strictObject({
  metric: idSlugSchema,
  included: z.number().positive(),
  per: z.enum(['day', 'month', 'invocation']).optional(),
  labelKo: nonBlankString(80).optional(),
  noteKo: nonBlankString(200).optional(),
});

/**
 * A billable usage dimension the calculator consumes directly:
 * monthly cost = max(0, usage - included) / perUnits * overage.usd.
 */
const usageMeterSchema = z.strictObject({
  metric: idSlugSchema,
  included: z.number().nonnegative(),
  per: z.literal('month'),
  overage: z.strictObject({
    usd: z.number().positive(),
    perUnits: z.number().int().positive(),
  }),
  labelKo: nonBlankString(80).optional(),
});

/** `monthlyUsd: null` means custom/contact-sales pricing. */
const pricingTierSchema = z.strictObject({
  id: idSlugSchema,
  name: nonBlankString(80),
  monthlyUsd: z.number().nonnegative().nullable(),
  noteKo: nonBlankString(200).optional(),
  featuresKo: z.array(nonBlankString(200)).min(1).optional(),
  limits: z.array(includedLimitSchema).min(1).optional(),
  meters: z.array(usageMeterSchema).min(1).optional(),
});

const curatedPricingSchema = z.strictObject({
  productId: idSlugSchema,
  tiers: z
    .array(pricingTierSchema)
    .min(1)
    .refine((tiers) => new Set(tiers.map((tier) => tier.id)).size === tiers.length, {
      error: 'tiers must not contain duplicate ids',
    }),
  sourceUrl: canonicalSourceUrl,
  verifiedAt: utcInstant,
});

/**
 * Learner-facing note for one product, written quote-first: each field
 * leans on cited official wording, and `sourceUrl`/`verifiedAt` attribute
 * the page the note was checked against. The three required fields are
 * the learning card's core (왜 존재하나 / 흔한 오해 / 대표 고객 질문);
 * the optional fields add an analogy and role-specific footnotes.
 */
const learningNoteSchema = z.strictObject({
  productId: idSlugSchema,
  whyKo: nonBlankString(400),
  misconceptionKo: nonBlankString(400),
  customerQuestionKo: nonBlankString(400),
  analogyKo: nonBlankString(400).optional(),
  seNoteKo: nonBlankString(400).optional(),
  aeNoteKo: nonBlankString(400).optional(),
  sourceUrl: canonicalSourceUrl,
  verifiedAt: utcInstant,
});

/**
 * A customer-situation lens: a short narrative plus the products it lights
 * up on the map. Solutions already act as lenses through compositions;
 * scenarios cover situations that cut across solution boundaries (a flash
 * sale, a VPN-replacement mandate). Grounded like every other entry:
 * `sourceUrl` is the official page the mapping was checked against.
 */
const curatedScenarioSchema = z.strictObject({
  id: idSlugSchema,
  titleKo: nonBlankString(80),
  situationKo: nonBlankString(400),
  productIds: z
    .array(idSlugSchema)
    .min(2)
    .refine((ids) => new Set(ids).size === ids.length, {
      error: 'productIds must not contain duplicate ids',
    }),
  talkTrackKo: nonBlankString(400).optional(),
  sourceUrl: canonicalSourceUrl,
  verifiedAt: utcInstant,
});

/**
 * One stop of the replay documentary: what the request experiences at this
 * product, quote-first like every learning surface. Array order in
 * `narration` IS the journey order — authored order is meaning (the same
 * rule pricing tiers follow), so normalization never sorts it.
 */
const narrationStopSchema = z.strictObject({
  productId: idSlugSchema,
  captionKo: nonBlankString(400),
  sourceUrl: canonicalSourceUrl,
  verifiedAt: utcInstant,
});

/**
 * Runtime schema for the curated dataset — knowledge that official pages do
 * not carry in structured form (map placements, beginner-friendly Korean
 * role lines, solution compositions, tier pricing, learning notes,
 * scenario lenses, the replay narration). Every entry cites the official
 * page it was verified against and when.
 *
 * Prefer {@link parseCuratedData} / {@link safeParseCuratedData}; catalog
 * cross-references are validated separately by
 * {@link collectCuratedReferenceIssues} because they need a parsed Catalog.
 */
export const curatedDataSchema = z.strictObject({
  schemaVersion: z.literal(CURATED_SCHEMA_VERSION),
  products: z.array(curatedProductSchema),
  compositions: z.array(curatedCompositionSchema),
  pricing: z.array(curatedPricingSchema),
  learningNotes: z.array(learningNoteSchema),
  scenarios: z.array(curatedScenarioSchema),
  narration: z.array(narrationStopSchema),
});

/** A fully validated curated dataset document. */
export type CuratedData = z.output<typeof curatedDataSchema>;

/** Curated per-product knowledge: role line and map placements. */
export type CuratedProduct = CuratedData['products'][number];

/** One lane/layer position of a product on the map. */
export type ProductPlacement = CuratedProduct['placements'][number];

/** Curated membership of one solution (the crawl has no such edges). */
export type CuratedComposition = CuratedData['compositions'][number];

/** Curated pricing for one product. */
export type CuratedPricing = CuratedData['pricing'][number];

/** One pricing tier; `monthlyUsd: null` means contact sales. */
export type PricingTier = CuratedPricing['tiers'][number];

/** Display-only quota of a tier. */
export type IncludedLimit = NonNullable<PricingTier['limits']>[number];

/** Calculator-consumable usage dimension of a tier. */
export type UsageMeter = NonNullable<PricingTier['meters']>[number];

/** Quote-first learner note for one product. */
export type LearningNote = CuratedData['learningNotes'][number];

/** Customer-situation lens over the map. */
export type CuratedScenario = CuratedData['scenarios'][number];

/** One journey stop of the replay documentary (array order = journey). */
export type NarrationStop = CuratedData['narration'][number];
