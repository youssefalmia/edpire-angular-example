import { Injectable } from '@angular/core'
import type { EdpireSdk } from './edpire-sdk.types'

/**
 * Loads the Edpire CDN bundle, once, on demand.
 *
 * WHY A SCRIPT TAG AND NOT `npm install`
 * The npm package is built for React and declares react and react-dom as peer
 * dependencies. The CDN bundle carries its own React sealed inside a closure,
 * so it needs no npm, no bundler configuration and no React in your project.
 * It does not touch `window.React` either, so it cannot collide with anything.
 * For Angular this is the supported path, not a fallback.
 *
 * WHY LAZILY AND NOT IN angular.json's `scripts` ARRAY
 * The bundle is around 700 KB gzipped, because it carries React, a maths
 * renderer and a rich-text engine. Listed in angular.json it lands in the
 * initial bundle and every page pays for it, including the ones with no
 * assessment on them. Loaded here it costs nothing until a learner opens an
 * assessment, and the browser caches it from there.
 */
@Injectable({ providedIn: 'root' })
export class EdpireSdkService {
  /**
   * Pin the version. @edpire/sdk is pre-1.0, so a minor release can change
   * behaviour. `@latest` means your production app silently changes on someone
   * else's release schedule. Bump this deliberately.
   */
  private static readonly VERSION = '0.6.12'

  private static readonly SRC = `https://cdn.jsdelivr.net/npm/@edpire/sdk@${EdpireSdkService.VERSION}/dist/umd/index.global.js`

  /**
   * Cached so that two components mounting at once share one network request
   * and one script tag, rather than racing to append two.
   */
  private loading: Promise<EdpireSdk> | null = null

  load(): Promise<EdpireSdk> {
    if (window.EdpireSDK) return Promise.resolve(window.EdpireSDK)
    if (this.loading) return this.loading

    this.loading = new Promise<EdpireSdk>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = EdpireSdkService.SRC
      script.async = true

      script.onload = () => {
        const sdk = window.EdpireSDK
        if (sdk) {
          resolve(sdk)
        } else {
          // The file arrived but defined no global. Almost always a Content
          // Security Policy that allowed the fetch and blocked the execution.
          this.loading = null
          reject(new Error('Edpire SDK loaded but window.EdpireSDK is undefined. Check your CSP script-src.'))
        }
      }

      script.onerror = () => {
        // Clear the cache so a later attempt can retry rather than being
        // handed back the rejected promise forever.
        this.loading = null
        reject(new Error(`Could not load the Edpire SDK from ${EdpireSdkService.SRC}`))
      }

      document.head.appendChild(script)
    })

    return this.loading
  }
}
