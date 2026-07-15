import type { Catalog, CuratedData } from '@cf-viz/catalog';

import { focusView, layoutMembers, solutionCards } from './graph-selectors';

const source = {
  id: 'solutions-overview',
  url: 'https://www.cloudflare.com/solutions/',
  pageKind: 'marketing-overview',
  title: 'Solutions',
  retrievedAt: '2026-07-14T00:00:00Z',
} as const;

const catalog: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [source],
  productFamilies: [
    { id: 'security', name: 'Security', summary: 'Security products.', sourceIds: [source.id] },
  ],
  products: [
    {
      id: 'waf',
      name: 'WAF',
      summary: 'Filters malicious traffic.',
      familyId: 'security',
      sourceIds: [source.id],
    },
    {
      id: 'ddos',
      name: 'DDoS Protection',
      summary: 'Absorbs attacks.',
      familyId: 'security',
      sourceIds: [source.id],
    },
    {
      id: 'gateway',
      name: 'Gateway',
      summary: 'Filters outbound traffic.',
      familyId: 'security',
      sourceIds: [source.id],
    },
  ],
  solutions: [
    { id: 'security', name: 'Security', summary: 'Protect apps.', sourceIds: [source.id] },
    { id: 'sase', name: 'Cloudflare One', summary: 'SASE platform.', sourceIds: [source.id] },
    { id: 'retail', name: 'Retail', summary: 'Retail experiences.', sourceIds: [source.id] },
  ],
  useCases: [],
  relationships: [],
};

const curated: CuratedData = {
  schemaVersion: '1',
  learningNotes: [],
  scenarios: [],
  narration: [],
  solutionNotes: [],
  products: [],
  compositions: [
    {
      solutionId: 'security',
      productIds: ['waf', 'ddos', 'ghost-member'],
      sourceUrl: 'https://www.cloudflare.com/solutions/security/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
    {
      solutionId: 'sase',
      productIds: ['gateway', 'ddos'],
      sourceUrl: 'https://www.cloudflare.com/sase/',
      verifiedAt: '2026-07-14T00:00:00Z',
    },
  ],
  pricing: [],
};

describe('solutionCards', () => {
  it('lists every catalog solution in display order with real member counts', () => {
    const cards = solutionCards(catalog, curated);
    expect(cards.map((card) => card.id)).toEqual(['sase', 'retail', 'security']);
    // ghost-member is not in the catalog, so security counts 2, not 3.
    expect(cards.find((card) => card.id === 'security')?.memberCount).toBe(2);
    expect(cards.find((card) => card.id === 'sase')?.memberCount).toBe(2);
    expect(cards.find((card) => card.id === 'retail')?.memberCount).toBeNull();
  });
});

describe('focusView', () => {
  it('joins members in display order and enumerates sharing solutions', () => {
    const view = focusView(catalog, curated, 'security');
    expect(view?.solution.name).toBe('Security');
    expect(view?.members?.map((member) => member.id)).toEqual(['ddos', 'waf']);
    expect(view?.members?.find((member) => member.id === 'ddos')?.sharedWith).toEqual([
      { id: 'sase', name: 'Cloudflare One' },
    ]);
    expect(view?.members?.find((member) => member.id === 'waf')?.sharedWith).toEqual([]);
    expect(view?.source?.url).toContain('/solutions/security/');
  });

  it('drops curated member ids that are missing from the catalog', () => {
    const view = focusView(catalog, curated, 'security');
    expect(view?.members?.map((member) => member.id)).not.toContain('ghost-member');
  });

  it('returns the explicit empty state for a solution without a composition', () => {
    const view = focusView(catalog, curated, 'retail');
    expect(view?.solution.name).toBe('Retail');
    expect(view?.members).toBeNull();
    expect(view?.source).toBeNull();
  });

  it('yields undefined for an unknown solution id from the URL', () => {
    expect(focusView(catalog, curated, 'does-not-exist')).toBeUndefined();
  });
});

describe('layoutMembers', () => {
  it("is deterministic and starts at 12 o'clock", () => {
    const positions = layoutMembers(4, 720, 520);
    expect(positions).toEqual(layoutMembers(4, 720, 520));
    expect(positions[0]).toEqual({ x: 360, y: Math.round(260 - 520 * 0.36), anchor: 'middle' });
    // Clockwise: the second of four sits to the right of the hub.
    expect(positions[1]?.x).toBeGreaterThan(360);
    expect(positions[1]?.anchor).toBe('start');
    // And the fourth sits to the left, labeled outward.
    expect(positions[3]?.x).toBeLessThan(360);
    expect(positions[3]?.anchor).toBe('end');
  });

  it('places every member on the ellipse for any count', () => {
    for (const count of [1, 2, 7, 13]) {
      expect(layoutMembers(count, 720, 520)).toHaveLength(count);
    }
  });
});
