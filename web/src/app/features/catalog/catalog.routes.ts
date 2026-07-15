import { Routes } from '@angular/router';

import { LivingMapPage } from '../living-map/living-map-page';
import { CatalogShell } from './catalog-shell';

/**
 * Application routes, loaded lazily as one chunk via `loadChildren`.
 *
 * {@link CatalogShell} is the layout gate: it renders the loading, error,
 * invalid-data, and empty states itself and only places a `<router-outlet>`
 * on screen once BOTH documents reached `success`. Children may therefore
 * assume the catalog and curated signals are present.
 *
 * Three screens are the whole surface: the map at `/` (product selection
 * via `?product=`), the composition graph at `/solutions` (`?solution=` +
 * `?product=`), and the pricing calculator at `/calculator` (scenario
 * params, see calculator-params). Every retired v1 route stays as a
 * redirect so old deep links land on the equivalent view instead of a
 * dead end — the detail pages map onto the panel selection params.
 */
export const CATALOG_ROUTES: Routes = [
  {
    path: '',
    component: CatalogShell,
    children: [
      {
        path: '',
        pathMatch: 'full',
        component: LivingMapPage,
        title: 'Cloudflare Product & Solution Explorer',
      },
      {
        path: 'solutions',
        pathMatch: 'full',
        loadComponent: () => import('../graph/graph-page').then((m) => m.GraphPage),
        title: '솔루션 구성 | Cloudflare Product & Solution Explorer',
      },
      {
        path: 'calculator',
        loadComponent: () => import('../calculator/calculator-page').then((m) => m.CalculatorPage),
        title: '요금 계산기 | Cloudflare Product & Solution Explorer',
      },
      // Retired v1 routes, preserved as deep-link redirects.
      { path: 'browse', redirectTo: '' },
      { path: 'discovery', redirectTo: '' },
      { path: 'relationships', redirectTo: 'solutions' },
      {
        path: 'products/:productId',
        redirectTo: ({ params }) => `/?product=${params['productId'] ?? ''}`,
      },
      {
        path: 'solutions/:solutionId',
        redirectTo: ({ params }) => `/solutions?solution=${params['solutionId'] ?? ''}`,
      },
    ],
  },
];
