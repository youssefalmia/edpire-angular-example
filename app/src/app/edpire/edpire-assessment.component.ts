import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  OnInit,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core'
import { EdpireApiService } from './edpire-api.service'
import { describeError } from './edpire-error'
import { EdpireSdkService } from './edpire-sdk.service'
import { EDPIRE_BASE_URL } from './edpire.config'
import type {
  EdpireEmbedError,
  EdpireEmbedInstance,
  EdpireEmbedResult,
} from './edpire-sdk.types'

/**
 * <edpire-assessment [assessmentId]="..."> -- the whole Exam Hall integration.
 *
 * Copy this file into your app, point it at your token endpoint, and you are
 * done. It mints a token, loads the CDN bundle, mounts the player, and tears
 * everything down on destroy.
 *
 * The player draws the complete paper: every question, a progress indicator,
 * reading passages in a side panel where the assessment has them, a timer if
 * one is configured, and a submit button. After submitting it rewrites itself
 * into the corrected paper -- score banner, per-question marks, answer key on
 * anything missed -- so this component does NOT navigate away in `completed`.
 * Let the learner read their corrections.
 *
 *   <edpire-assessment
 *     [assessmentId]="lesson.edpireAssessmentId"
 *     [locale]="'fr'"
 *     (completed)="onScore($event)"
 *     (failed)="onError($event)" />
 */
@Component({
  selector: 'edpire-assessment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (status() === 'loading') {
      <p class="edpire-status">Preparing the assessment…</p>
    }
    @if (status() === 'error') {
      <p class="edpire-status edpire-status--error">{{ errorMessage() }}</p>
    }

    <!--
      The player is at least as tall as the screen and grows with the paper, so
      the PAGE scrolls and the player's top bar sticks to the top of the screen
      (SDK 0.11.0 and later). Give the container a width, never a fixed height:
      a box of fixed height with overflow hidden cuts the paper off. If the
      player has to live in a box of its own height (a panel, a modal), give
      that box overflow: auto.
    -->
    <div #host class="edpire-host"></div>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
    }
    .edpire-status {
      padding: 2rem;
      text-align: center;
      color: #6b7280;
      font-family: system-ui, sans-serif;
    }
    .edpire-status--error {
      color: #dc2626;
    }
  `,
})
export class EdpireAssessmentComponent implements OnInit {
  /** The Edpire assessment UUID. Store one against each of your own lessons. */
  readonly assessmentId = input.required<string>()

  /**
   * Player UI language. Set it from the ASSESSMENT's language, not your app's,
   * so a French exercise reads left-to-right inside an Arabic product. Omit it
   * and the player uses the assessment's own language, which is usually right.
   */
  readonly locale = input<'en' | 'fr' | 'ar' | undefined>(undefined)

  /**
   * Width of the question column inside the player.
   *
   * Leave it alone when the player owns the page: the default 768px cap is a
   * reading measure, and long question text is materially harder to read
   * without it. Pass 'none' when you mount the player inside your own layout
   * and your container already sets the width, otherwise learners get a column
   * inside a column and a band of your page background down both sides.
   *
   * If you still see gutters after setting 'none', they are coming from your
   * own container, not from the player. Check the computed width of the
   * element you pass as `container` before changing anything here.
   */
  readonly contentMaxWidth = input<string | undefined>(undefined)

  /**
   * Fired when the learner submits. Treat it as a UI hint, not the record of
   * truth: it is a client callback, and a browser can be lied to. The
   * authoritative result arrives on the `submission.graded` webhook.
   */
  readonly completed = output<EdpireEmbedResult>()
  readonly failed = output<EdpireEmbedError>()

  private readonly hostEl = viewChild.required<ElementRef<HTMLDivElement>>('host')

  private readonly api = inject(EdpireApiService)
  private readonly sdk = inject(EdpireSdkService)
  private readonly zone = inject(NgZone)
  private readonly destroyRef = inject(DestroyRef)

  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading')
  protected readonly errorMessage = signal('')

  private embed: EdpireEmbedInstance | null = null
  private destroyed = false

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true
      this.embed?.unmount()
      this.embed = null
    })

    // Re-mount when the caller points this component at a different assessment.
    effect(() => {
      const id = this.assessmentId()
      void this.mount(id)
    })
  }

  ngOnInit(): void {
    // The effect above does the work; ngOnInit exists only to make the
    // lifecycle explicit for readers.
  }

  private async mount(assessmentId: string): Promise<void> {
    this.embed?.unmount()
    this.embed = null
    this.status.set('loading')

    try {
      // Both in parallel: the token is a round trip to your server, the bundle
      // is a round trip to a CDN, and neither depends on the other.
      const [token, sdk] = await Promise.all([
        this.api.mintToken(assessmentId),
        this.sdk.load(),
      ])

      // The learner may have navigated away during those two round trips.
      if (this.destroyed) return

      this.embed = sdk.EdpireAssessment.mount({
        token,
        container: this.hostEl().nativeElement,
        baseUrl: EDPIRE_BASE_URL,
        locale: this.locale(),
        layout: this.contentMaxWidth() ? { maxWidth: this.contentMaxWidth() } : undefined,

        /**
         * WHY ngZone.run()
         * These callbacks originate inside the SDK's own React tree, which is
         * not your application. On a zoneless app (Angular 20+ default) signal
         * writes are what schedule change detection, and those work anywhere.
         * On a zone.js app they may land outside the Angular zone, and then
         * your UI silently does not update -- the classic "the callback fired,
         * I logged it, nothing rendered" bug. Wrapping costs nothing in a
         * zoneless app, where NgZone.run simply calls the function, and it
         * saves an afternoon in a zone-based one. Keep it.
         */
        onComplete: (result) => {
          this.zone.run(() => this.completed.emit(result))
        },
        onError: (error) => {
          this.zone.run(() => {
            this.status.set('error')
            this.errorMessage.set(this.explain(error))
            this.failed.emit(error)
          })
        },
      })

      this.status.set('ready')
    } catch (err) {
      if (this.destroyed) return
      this.status.set('error')
      this.errorMessage.set(describeError(err, 'Could not start the assessment.'))
    }
  }

  /** Turn an SDK error code into something a human can act on. */
  private explain(error: EdpireEmbedError): string {
    switch (error.code) {
      case 'ORIGIN_NOT_ALLOWED':
        return `${location.origin} is not on this organisation's embed allow-list. Add it in Edpire under Integrations, then Origins. Origins are matched exactly, including scheme and port.`
      case 'TOKEN_EXPIRED':
        return 'This assessment session expired. Reload the page to start a new one.'
      case 'MAX_ATTEMPTS_REACHED':
        return 'You have used all your attempts at this assessment.'
      case 'NETWORK_ERROR':
        return 'Could not reach Edpire. Check the connection and try again.'
      default:
        return error.message
    }
  }
}
