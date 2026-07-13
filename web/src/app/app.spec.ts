import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { App } from './app';
import { routes } from './app.routes';
import { CATALOG_URL } from './core/catalog/catalog-store';

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

  it('renders the primary navigation with catalog and discovery links', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const nav = compiled.querySelector('nav[aria-label="주요 메뉴"]');
    expect(nav).not.toBeNull();
    const catalogLink = nav?.querySelector<HTMLAnchorElement>('a[href="/"]');
    expect(catalogLink?.textContent).toContain('카탈로그');
    const discoveryLink = nav?.querySelector<HTMLAnchorElement>('a[href="/discovery"]');
    expect(discoveryLink?.textContent).toContain('검색');
  });

  it('marks the discovery link active on /discovery while 카탈로그 stays exact', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    await TestBed.inject(Router).navigateByUrl('/discovery');
    // Zoneless pattern: the activated shell holds a pending catalog request,
    // so whenStable() would deadlock; TestBed.tick() renders synchronously.
    TestBed.tick();

    const compiled = fixture.nativeElement as HTMLElement;
    const catalogLink = compiled.querySelector<HTMLAnchorElement>('nav a[href="/"]');
    const discoveryLink = compiled.querySelector<HTMLAnchorElement>('nav a[href="/discovery"]');
    expect(discoveryLink?.classList.contains('active')).toBe(true);
    expect(catalogLink?.classList.contains('active')).toBe(false);

    // Settle the outstanding request so verify() passes.
    TestBed.inject(HttpTestingController)
      .expectOne(CATALOG_URL)
      .flush('gone', { status: 404, statusText: 'Not Found' });
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

    // Settle the outstanding request so verify() passes; the resulting
    // fetch-error state is not under test here.
    TestBed.inject(HttpTestingController)
      .expectOne(CATALOG_URL)
      .flush('gone', { status: 404, statusText: 'Not Found' });
  });
});
