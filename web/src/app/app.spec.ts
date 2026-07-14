import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { App } from './app';
import { routes } from './app.routes';
import { CATALOG_URL } from './core/catalog/catalog-store';
import { CURATED_URL } from './core/catalog/curated-store';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('renders the header brand and the router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand')?.textContent).toContain(
      'Cloudflare Product & Solution Explorer',
    );
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
  });

  it('renders the primary navigation with map, catalog, discovery, and relationships links', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const nav = compiled.querySelector('nav[aria-label="주요 메뉴"]');
    expect(nav).not.toBeNull();
    const mapLink = nav?.querySelector<HTMLAnchorElement>('a[href="/"]');
    expect(mapLink?.textContent).toContain('지도');
    const solutionsLink = nav?.querySelector<HTMLAnchorElement>('a[href="/solutions"]');
    expect(solutionsLink?.textContent).toContain('솔루션');
    const catalogLink = nav?.querySelector<HTMLAnchorElement>('a[href="/browse"]');
    expect(catalogLink?.textContent).toContain('카탈로그');
    const discoveryLink = nav?.querySelector<HTMLAnchorElement>('a[href="/discovery"]');
    expect(discoveryLink?.textContent).toContain('검색');
    const relationshipsLink = nav?.querySelector<HTMLAnchorElement>('a[href="/relationships"]');
    expect(relationshipsLink?.textContent).toContain('관계');
  });

  it('marks the discovery link active on /discovery while 지도 stays exact', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    await TestBed.inject(Router).navigateByUrl('/discovery');
    // Zoneless pattern: the activated shell holds a pending catalog request,
    // so whenStable() would deadlock; TestBed.tick() renders synchronously.
    TestBed.tick();

    const compiled = fixture.nativeElement as HTMLElement;
    const mapLink = compiled.querySelector<HTMLAnchorElement>('nav a[href="/"]');
    const discoveryLink = compiled.querySelector<HTMLAnchorElement>('nav a[href="/discovery"]');
    expect(discoveryLink?.classList.contains('active')).toBe(true);
    expect(mapLink?.classList.contains('active')).toBe(false);

    // Settle both outstanding document requests so verify() passes.
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(CATALOG_URL).flush('gone', { status: 404, statusText: 'Not Found' });
    http.expectOne(CURATED_URL).flush('gone', { status: 404, statusText: 'Not Found' });
  });

  it('lazy-loads the catalog shell on the root route with accessible landmarks', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    await TestBed.inject(Router).navigateByUrl('/');
    // Zoneless pattern: the freshly activated shell holds a pending catalog
    // request, so awaiting whenStable() here would deadlock; TestBed.tick()
    // synchronously dispatches the request and renders the loading view.
    TestBed.tick();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('header')).not.toBeNull();
    expect(compiled.querySelector('main')).not.toBeNull();
    expect(compiled.querySelectorAll('h1')).toHaveLength(1);
    expect(compiled.querySelector('[role="status"]')?.textContent).toContain('불러오는 중');

    // Settle both outstanding document requests so verify() passes; the
    // resulting fetch-error state is not under test here.
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(CATALOG_URL).flush('gone', { status: 404, statusText: 'Not Found' });
    http.expectOne(CURATED_URL).flush('gone', { status: 404, statusText: 'Not Found' });
  });
});
