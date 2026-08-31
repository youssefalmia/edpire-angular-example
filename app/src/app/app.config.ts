import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core'
import { provideRouter, withComponentInputBinding } from '@angular/router'
import { provideHttpClient, withFetch } from '@angular/common/http'

import { routes } from './app.routes'

/**
 * Nothing Edpire-specific lives here, which is the point: the SDK is loaded by
 * a script tag at runtime, so it needs no provider, no module and no build
 * configuration.
 *
 * This app is zoneless, the default since Angular 20. If yours still uses
 * zone.js, nothing here changes -- but read the NgZone note in
 * edpire/edpire-assessment.component.ts, which is the one place the difference
 * can bite.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
  ],
}
