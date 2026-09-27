import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./layouts/dashboard/dashboard.component').then(
        (component) => component.DashboardComponent,
      ),
  },
  {
    path: 'monitor',
    loadComponent: () =>
      import('./layouts/monitor/monitor.component').then(
        (m) => m.MonitorComponent,
      ),
  },
  {
    path: 'overlay',
    loadComponent: () =>
      import('./layouts/overlay/overlay.component').then(
        (component) => component.OverlayComponent,
      ),
  },
  {
    path: '',
    redirectTo: 'monitor',
    pathMatch: 'full',
  },
];
