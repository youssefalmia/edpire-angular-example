import { Routes } from '@angular/router'

/**
 * `:id` and query parameters bind straight to each component's inputs, because
 * app.config.ts enables withComponentInputBinding(). No ActivatedRoute, no
 * subscription.
 *
 * Every route lazy-loads, which matters more than usual here: the Edpire bundle
 * is fetched by the screen that needs it, so the card list stays small.
 */
export const routes: Routes = [
  // -- My assessments: the flow most products want ---------------------------
  {
    path: '',
    loadComponent: () => import('./pages/library.component').then((m) => m.LibraryComponent),
  },
  {
    path: 'assessments/:id',
    loadComponent: () => import('./pages/attempts.component').then((m) => m.AttemptsComponent),
  },
  {
    path: 'assessments/:id/take',
    loadComponent: () => import('./pages/take.component').then((m) => m.TakeComponent),
  },

  // -- The two integration modes, side by side --------------------------------
  {
    path: 'modes',
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
