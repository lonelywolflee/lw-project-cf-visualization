import type { Catalog } from '@cf-viz/catalog';

import {
  compareByNameThenId,
  familyGroups,
  productDetail,
  solutionDetail,
  sortedSolutions,
  toDetailState,
} from './catalog-selectors';

const source = (id: string, title: string) => ({
  id,
  url: `https://www.cloudflare.com/${id}/`,
  pageKind: 'marketing-product' as const,
  title,
  retrievedAt: '2026-07-14T00:00:00Z',
});

/** Deliberately unsorted fixture; selectors must impose the order. */
const catalog: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [source('src-b', 'Source B'), source('src-a', 'Source A')],
  productFamilies: [
    { id: 'security', name: 'Security', summary: 'Security family.', sourceIds: ['src-a'] },
    { id: 'compute', name: 'compute', summary: 'Compute family.', sourceIds: ['src-a'] },
    { id: 'empty-family', name: 'Zero', summary: 'No products yet.', sourceIds: ['src-a'] },
  ],
  products: [
    {
      id: 'waf',
      name: 'WAF',
      summary: 'Web application firewall.',
      familyId: 'security',
      sourceIds: ['src-b', 'src-a'],
    },
    {
      id: 'workers-2',
      name: 'workers',
      summary: 'Duplicate-name tie by id (second).',
      familyId: 'compute',
      sourceIds: ['src-a'],
    },
    {
      id: 'workers-1',
      name: 'Workers',
      summary: 'Duplicate-name tie by id (first).',
      familyId: 'compute',
      sourceIds: ['src-a'],
    },
    {
      id: 'bots',
      name: 'Bot Management',
      summary: 'Bot detection.',
      familyId: 'security',
      sourceIds: ['src-a'],
    },
  ],
  solutions: [
    { id: 'sase', name: 'SASE', summary: 'SASE solution.', sourceIds: ['src-a'] },
    { id: 'ai', name: 'AI', summary: 'AI solution.', sourceIds: ['src-a'] },
  ],
  useCases: [
    { id: 'uc-b', name: 'Use case B', summary: 'Second use case.', sourceIds: ['src-a'] },
    { id: 'uc-a', name: 'Use case A', summary: 'First use case.', sourceIds: ['src-a'] },
  ],
  relationships: [
    { type: 'product-use-case', fromId: 'waf', toId: 'uc-b', sourceIds: ['src-a'] },
    { type: 'product-use-case', fromId: 'waf', toId: 'uc-a', sourceIds: ['src-a'] },
    { type: 'solution-use-case', fromId: 'sase', toId: 'uc-a', sourceIds: ['src-a'] },
  ],
};

describe('compareByNameThenId', () => {
  it('orders case-insensitively by code point and breaks name ties by id', () => {
    const entities = [
      { id: 'b', name: 'workers' },
      { id: 'a', name: 'Workers' },
      { id: 'c', name: 'CDN' },
    ];
    expect([...entities].sort(compareByNameThenId).map((entity) => entity.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});

describe('familyGroups', () => {
  it('sorts families and their products by name, keeping empty families', () => {
    const groups = familyGroups(catalog);
    expect(groups.map((group) => group.family.id)).toEqual(['compute', 'security', 'empty-family']);
    expect(groups[0]?.products.map((product) => product.id)).toEqual(['workers-1', 'workers-2']);
    expect(groups[1]?.products.map((product) => product.id)).toEqual(['bots', 'waf']);
    expect(groups[2]?.products).toEqual([]);
  });
});

describe('sortedSolutions', () => {
  it('orders solutions by name', () => {
    expect(sortedSolutions(catalog).map((solution) => solution.id)).toEqual(['ai', 'sase']);
  });
});

describe('productDetail', () => {
  it('resolves family, ordered use cases, and sources in declared order', () => {
    const detail = productDetail(catalog, 'waf');
    expect(detail?.product.name).toBe('WAF');
    expect(detail?.family.id).toBe('security');
    expect(detail?.useCases.map((useCase) => useCase.id)).toEqual(['uc-a', 'uc-b']);
    expect(detail?.sources.map((entry) => entry.id)).toEqual(['src-b', 'src-a']);
  });

  it('returns an empty use case list for a product without edges', () => {
    expect(productDetail(catalog, 'bots')?.useCases).toEqual([]);
  });

  it('returns undefined for an unknown id', () => {
    expect(productDetail(catalog, 'does-not-exist')).toBeUndefined();
  });
});

describe('solutionDetail', () => {
  it('resolves use cases via solution-use-case edges only', () => {
    const detail = solutionDetail(catalog, 'sase');
    expect(detail?.solution.name).toBe('SASE');
    expect(detail?.useCases.map((useCase) => useCase.id)).toEqual(['uc-a']);
    expect(detail?.sources.map((entry) => entry.id)).toEqual(['src-a']);
  });

  it('returns an empty use case list for a solution without edges', () => {
    expect(solutionDetail(catalog, 'ai')?.useCases).toEqual([]);
  });

  it('returns undefined for an unknown id', () => {
    expect(solutionDetail(catalog, 'nope')).toBeUndefined();
  });
});

describe('toDetailState', () => {
  it('is pending without a catalog', () => {
    expect(toDetailState(undefined, 'waf', productDetail)).toEqual({ kind: 'pending' });
  });

  it('is not-found for an unknown id', () => {
    expect(toDetailState(catalog, 'nope', productDetail)).toEqual({
      kind: 'not-found',
      id: 'nope',
    });
  });

  it('is found with the selector result for a known id', () => {
    const state = toDetailState(catalog, 'waf', productDetail);
    expect(state.kind).toBe('found');
    if (state.kind === 'found') {
      expect(state.detail.product.id).toBe('waf');
    }
  });
});
