import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'monitor',
    loadComponent: () =>
      import('./layouts/monitor/monitor.component').then(
        (m) => m.MonitorComponent,
      ),
  },
  {
    path: '',
    redirectTo: 'monitor',
    pathMatch: 'full',
  },
];
