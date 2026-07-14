import type { Catalog } from '@cf-viz/catalog';

import {
  EMPTY_CRITERIA,
  firstParamValue,
  parseDiscoveryParams,
  searchCatalog,
  toDiscoveryQueryParams,
  type DiscoveryCriteria,
} from './discovery-selectors';

const source = {
  id: 'products-overview',
  url: 'https://www.cloudflare.com/products/',
  pageKind: 'marketing-overview',
  title: 'Our products',
  retrievedAt: '2026-07-14T00:00:00Z',
} as const;

/** Deliberately unsorted fixture; searchCatalog must impose the order. */
const catalog: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [source],
  productFamilies: [
    { id: 'security', name: 'Security', summary: 'Security products.', sourceIds: [source.id] },
    { id: 'compute', name: 'Compute', summary: 'Compute products.', sourceIds: [source.id] },
    {
      id: 'performance',
      name: 'Performance',
      summary: 'Performance products.',
      sourceIds: [source.id],
    },
  ],
  products: [
    {
      id: 'workers',
      name: 'Workers',
      summary: 'Serverless compute at the edge.',
      familyId: 'compute',
      sourceIds: [source.id],
    },
    {
      id: 'waf',
      name: 'Web Application Firewall',
      summary: 'Filters malicious HTTP traffic.',
      familyId: 'security',
      sourceIds: [source.id],
    },
    {
      id: 'cdn',
      name: 'CDN',
      summary: 'Caches content close to users.',
      familyId: 'performance',
      sourceIds: [source.id],
    },
    {
      id: 'bots',
      name: 'Bot Management',
      summary: 'Detects automated traffic.',
      familyId: 'security',
      sourceIds: [source.id],
    },
  ],
  solutions: [
    {
      id: 'sase',
      name: 'SASE',
      summary: 'Secure access service edge platform.',
      sourceIds: [source.id],
    },
    { id: 'ai', name: 'AI', summary: 'Build intelligent applications.', sourceIds: [source.id] },
  ],
  useCases: [
    {
      id: 'edge-compute',
      name: 'Edge compute',
      summary: 'Run code close to users.',
      sourceIds: [source.id],
    },
    {
      id: 'zero-trust',
      name: 'Zero Trust',
      summary: 'Verify every request.',
      sourceIds: [source.id],
    },
  ],
  relationships: [
    { type: 'product-use-case', fromId: 'workers', toId: 'edge-compute', sourceIds: [source.id] },
    { type: 'product-use-case', fromId: 'cdn', toId: 'edge-compute', sourceIds: [source.id] },
    { type: 'solution-use-case', fromId: 'sase', toId: 'edge-compute', sourceIds: [source.id] },
    { type: 'solution-use-case', fromId: 'sase', toId: 'zero-trust', sourceIds: [source.id] },
  ],
};

const criteria = (partial: Partial<DiscoveryCriteria>): DiscoveryCriteria => ({
  ...EMPTY_CRITERIA,
  ...partial,
});

describe('firstParamValue', () => {
  it('passes a plain string through', () => {
    expect(firstParamValue('security')).toBe('security');
  });

  it('takes the first element of a repeated-param string array', () => {
    expect(firstParamValue(['security', 'compute'])).toBe('security');
  });

  it('returns undefined for non-string junk', () => {
    expect(firstParamValue(undefined)).toBeUndefined();
    expect(firstParamValue(null)).toBeUndefined();
    expect(firstParamValue(42)).toBeUndefined();
    expect(firstParamValue([42, 'security'])).toBeUndefined();
    expect(firstParamValue([])).toBeUndefined();
  });
});

describe('parseDiscoveryParams', () => {
  it('passes valid ids through with nothing dropped', () => {
    const parsed = parseDiscoveryParams(catalog, {
      q: 'edge',
      family: 'compute',
      useCase: 'edge-compute',
    });
    expect(parsed.criteria).toEqual({ q: 'edge', familyId: 'compute', useCaseId: 'edge-compute' });
    expect(parsed.dropped).toEqual([]);
  });

  it('drops unknown family and useCase ids and reports them', () => {
    const parsed = parseDiscoveryParams(catalog, { family: 'bogus', useCase: 'nope' });
    expect(parsed.criteria).toEqual(EMPTY_CRITERIA);
    expect(parsed.dropped).toEqual(['family', 'useCase']);
  });

  it('treats empty-string params as absent, not invalid', () => {
    const parsed = parseDiscoveryParams(catalog, { q: '', family: '', useCase: '' });
    expect(parsed.criteria).toEqual(EMPTY_CRITERIA);
    expect(parsed.dropped).toEqual([]);
  });

  it('takes the first value of repeated params', () => {
    const parsed = parseDiscoveryParams(catalog, {
      q: ['a', 'b'],
      family: ['security', 'compute'],
    });
    expect(parsed.criteria.q).toBe('a');
    expect(parsed.criteria.familyId).toBe('security');
  });

  it('trims q', () => {
    expect(parseDiscoveryParams(catalog, { q: '  edge  ' }).criteria.q).toBe('edge');
  });

  it('degrades all-junk input to the empty criteria without throwing', () => {
    const parsed = parseDiscoveryParams(catalog, {
      q: 42,
      family: { evil: true },
      useCase: [null],
    });
    expect(parsed.criteria).toEqual(EMPTY_CRITERIA);
    expect(parsed.dropped).toEqual([]);
  });
});

describe('searchCatalog — matching', () => {
  it('matches names case-insensitively', () => {
    const results = searchCatalog(catalog, criteria({ q: 'FIREWALL' }));
    expect(results.products.map((product) => product.id)).toEqual(['waf']);
    expect(results.solutions).toEqual([]);
    expect(results.total).toBe(1);
  });

  it('matches summaries', () => {
    const results = searchCatalog(catalog, criteria({ q: 'serverless' }));
    expect(results.products.map((product) => product.id)).toEqual(['workers']);
  });

  it('does NOT match ids', () => {
    // 'waf' appears in neither the official name nor the summary.
    const results = searchCatalog(catalog, criteria({ q: 'waf' }));
    expect(results.total).toBe(0);
  });

  it('matches everything when q is empty', () => {
    const results = searchCatalog(catalog, EMPTY_CRITERIA);
    expect(results.products.length).toBe(4);
    expect(results.solutions.length).toBe(2);
    expect(results.total).toBe(6);
  });

  it('yields total 0 when nothing matches', () => {
    expect(searchCatalog(catalog, criteria({ q: 'zzzznothing' })).total).toBe(0);
  });
});

describe('searchCatalog — filter composition', () => {
  it('applies the family filter to products alone', () => {
    const results = searchCatalog(catalog, criteria({ familyId: 'security' }));
    expect(results.products.map((product) => product.id)).toEqual(['bots', 'waf']);
  });

  it('empties solutions while a family filter is active (honest AND semantics)', () => {
    const results = searchCatalog(catalog, criteria({ familyId: 'security' }));
    expect(results.solutions).toEqual([]);
    expect(results.total).toBe(2);
  });

  it('applies the useCase filter via explicit edges only', () => {
    const results = searchCatalog(catalog, criteria({ useCaseId: 'edge-compute' }));
    // workers and cdn have product-use-case edges; sase has a
    // solution-use-case edge; waf/bots/ai have no edge and never match.
    expect(results.products.map((product) => product.id)).toEqual(['cdn', 'workers']);
    expect(results.solutions.map((solution) => solution.id)).toEqual(['sase']);
    expect(results.total).toBe(3);
  });

  it('does not let product edges satisfy the useCase filter for solutions', () => {
    const results = searchCatalog(catalog, criteria({ useCaseId: 'zero-trust' }));
    expect(results.products).toEqual([]);
    expect(results.solutions.map((solution) => solution.id)).toEqual(['sase']);
  });

  it('AND-combines q, family, and useCase', () => {
    const results = searchCatalog(
      catalog,
      criteria({ q: 'edge', familyId: 'compute', useCaseId: 'edge-compute' }),
    );
    // cdn survives the useCase filter but fails q + family; only workers
    // matches all three. Solutions are empty because family is active.
    expect(results.products.map((product) => product.id)).toEqual(['workers']);
    expect(results.solutions).toEqual([]);
    expect(results.total).toBe(1);
  });
});

describe('searchCatalog — determinism and purity', () => {
  it('orders products and solutions with compareByNameThenId', () => {
    const results = searchCatalog(catalog, EMPTY_CRITERIA);
    expect(results.products.map((product) => product.id)).toEqual([
      'bots',
      'cdn',
      'waf',
      'workers',
    ]);
    expect(results.solutions.map((solution) => solution.id)).toEqual(['ai', 'sase']);
  });

  it('does not mutate the catalog', () => {
    const before = JSON.stringify(catalog);
    searchCatalog(catalog, criteria({ q: 'edge', useCaseId: 'edge-compute' }));
    searchCatalog(catalog, criteria({ familyId: 'security' }));
    expect(JSON.stringify(catalog)).toBe(before);
  });

  it('returns identical output for the same input', () => {
    const input = criteria({ q: 'edge', useCaseId: 'edge-compute' });
    expect(searchCatalog(catalog, input)).toEqual(searchCatalog(catalog, input));
  });
});

describe('toDiscoveryQueryParams', () => {
  it('maps inactive keys to null so the router omits them', () => {
    expect(toDiscoveryQueryParams(EMPTY_CRITERIA)).toEqual({
      q: null,
      family: null,
      useCase: null,
    });
  });

  it('maps whitespace-only q to null', () => {
    expect(toDiscoveryQueryParams(criteria({ q: '   ' }))['q']).toBeNull();
  });

  it('preserves non-empty q untrimmed (typing must not be fought)', () => {
    expect(toDiscoveryQueryParams(criteria({ q: ' edge ' }))['q']).toBe(' edge ');
  });

  it('round-trips: parse after serialize is identity for valid criteria', () => {
    const cases: DiscoveryCriteria[] = [
      EMPTY_CRITERIA,
      criteria({ q: 'edge' }),
      criteria({ familyId: 'compute' }),
      criteria({ q: 'edge', familyId: 'compute', useCaseId: 'edge-compute' }),
    ];
    for (const input of cases) {
      const parsed = parseDiscoveryParams(catalog, toDiscoveryQueryParams(input));
      expect(parsed.criteria).toEqual(input);
      expect(parsed.dropped).toEqual([]);
    }
  });
});
