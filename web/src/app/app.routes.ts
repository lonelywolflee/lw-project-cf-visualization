import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/catalog/catalog-shell').then((m) => m.CatalogShell),
    title: 'Cloudflare Product & Solution Explorer',
  },
  { path: '**', redirectTo: '' },
];
