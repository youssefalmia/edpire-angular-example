import { Routes } from '@angular/router'

/**
 * `:id` binds straight to each component's `id` input, because app.config.ts
 * enables withComponentInputBinding(). No ActivatedRoute, no subscription.
 *
 * Both routes lazy-load, which matters more than usual here: the Edpire bundle
 * is fetched by the screen that needs it, so the picker stays small.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/picker.component').then((m) => m.PickerComponent),
  },
  {
    path: 'exam/:id',
    loadComponent: () => import('./pages/exam-hall.component').then((m) => m.ExamHallComponent),
  },
  {
    path: 'arcade/:id',
    loadComponent: () => import('./pages/arcade.component').then((m) => m.ArcadeComponent),
  },
  { path: '**', redirectTo: '' },
]
