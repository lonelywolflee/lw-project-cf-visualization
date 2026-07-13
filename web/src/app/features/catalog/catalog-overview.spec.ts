import { computed, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Catalog } from '@cf-viz/catalog';

import { CatalogStore } from '../../core/catalog/catalog-store';
import { CatalogOverview } from './catalog-overview';

const source = {
  id: 'products-overview',
  url: 'https://www.cloudflare.com/products/',
  pageKind: 'marketing-overview',
  title: 'Our products',
  retrievedAt: '2026-07-14T00:00:00Z',
} as const;

const catalog: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [source],
  productFamilies: [
    {
      id: 'security',
      name: 'Security',
      summary: 'Security products.',
      sourceIds: ['products-overview'],
    },
    {
      id: 'compute',
      name: 'Compute',
      summary: 'Compute products.',
      sourceIds: ['products-overview'],
    },
  ],
  products: [
    {
      id: 'waf',
      name: 'WAF',
      summary: 'Web application firewall.',
      familyId: 'security',
      sourceIds: ['products-overview'],
    },
    {
      id: 'workers',
      name: 'Workers',
      summary: 'Serverless compute.',
      familyId: 'compute',
      sourceIds: ['products-overview'],
    },
    {
      id: 'containers',
      name: 'Containers',
      summary: 'Container platform.',
      familyId: 'compute',
      sourceIds: ['products-overview'],
    },
  ],
  solutions: [
    { id: 'sase', name: 'SASE', summary: 'SASE solution.', sourceIds: ['products-overview'] },
  ],
  useCases: [],
  relationships: [],
};

describe('CatalogOverview', () => {
  let state: WritableSignal<Catalog | undefined>;

  beforeEach(async () => {
    state = signal<Catalog | undefined>(catalog);
    await TestBed.configureTestingModule({
      imports: [CatalogOverview],
      providers: [
        provideRouter([]),
        { provide: CatalogStore, useValue: { catalog: computed(() => state()) } },
      ],
    }).compileComponents();
  });

  async function createOverview() {
    const fixture = TestBed.createComponent(CatalogOverview);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('renders one labelled section per family in display order with counts', async () => {
    const { element } = await createOverview();

    const headings = Array.from(element.querySelectorAll('section.family h2')).map((heading) =>
      heading.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(headings).toEqual(['Compute Product 2개', 'Security Product 1개']);

    const computeSection = element.querySelector('#family-compute');
    expect(computeSection?.getAttribute('aria-labelledby')).toBe('family-heading-compute');
    const computeLinks = Array.from(
      computeSection?.querySelectorAll<HTMLAnchorElement>('.link-list a') ?? [],
    );
    expect(computeLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/products/containers',
      '/products/workers',
    ]);
  });

  it('renders the solutions section with links and the compact summary line', async () => {
    const { element } = await createOverview();

    expect(element.querySelector('a[href="/solutions/sase"]')?.textContent).toContain('SASE');
    const summary = element.querySelector('.summary-line')?.textContent?.replace(/\s+/g, ' ');
    expect(summary).toContain('Product family 2');
    expect(summary).toContain('Product 3');
    expect(summary).toContain('출처 1곳');
  });

  it('keeps every product link keyboard focusable', async () => {
    const { element } = await createOverview();

    const firstLink = element.querySelector<HTMLAnchorElement>('.link-list a');
    firstLink?.focus();
    expect(document.activeElement).toBe(firstLink);
  });
});
