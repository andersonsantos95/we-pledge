import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home').then(m => m.HomeComponent),
  },
  {
    path: 'criar',
    loadComponent: () => import('./pages/create/create').then(m => m.CreateComponent),
  },
  {
    path: 'campanha/:id',
    loadComponent: () => import('./pages/campaign/campaign').then(m => m.CampaignComponent),
  },
  { path: '**', redirectTo: '' },
];
