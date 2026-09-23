import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
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
import type { EdpireEmbedInstance, EdpireSubmissionReview } from './edpire-sdk.types'

/**
 * <edpire-review [submissionId]="..."> -- one past attempt, as the corrected
 * paper. The twin of <edpire-assessment>: copy this file too.
 *
 * It renders exactly what the learner saw the moment they submitted -- their
 * answers, locked, every mark, the expected answer on anything missed -- plus
 * whatever arrived since: a teacher's marks and written comments on open
 * responses.
 *
 * Two differences from <edpire-assessment> worth knowing:
 *
 *   - No token. Your server fetches the review with its API key after checking
 *     the attempt is this learner's, and the player only draws it. So the
 *     browser never talks to Edpire here, and the origin allow-list is not
 *     involved.
 *   - Nothing to submit, so no `completed` output. `loaded` hands you the
 *     attempt's header (number, score, date) for your own chrome around it.
 *
 *   <edpire-review
 *     [submissionId]="attempt.submissionId"
 *     (loaded)="header = $event" />
 */
@Component({
  selector: 'edpire-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (status() === 'loading') {
      <p class="edpire-status">Loading the corrected paper…</p>
    }
    @if (status() === 'error') {
      <p class="edpire-status edpire-status--error">{{ errorMessage() }}</p>
    }
    <!-- Same rule as the player: the container needs a real height. -->
    <div #host class="edpire-host"></div>
  `,
  styles: `
    :host { display: block; height: 100%; min-height: 600px; }
    .edpire-host { height: 100%; }
    .edpire-status { padding: 2rem; text-align: center; color: #6b7280; font-family: system-ui, sans-serif; }
    .edpire-status--error { color: #dc2626; }
  `,
})
export class EdpireReviewComponent {
  /** The Edpire submission ID, from your own attempts table. */
  readonly submissionId = input.required<string>()

  /** Same meaning as on <edpire-assessment>. */
  readonly contentMaxWidth = input<string | undefined>(undefined)

  /** The attempt's header fields, for your own UI around the paper. */
  readonly loaded = output<EdpireSubmissionReview['submission']>()

  private readonly hostEl = viewChild.required<ElementRef<HTMLDivElement>>('host')
  private readonly api = inject(EdpireApiService)
  private readonly sdk = inject(EdpireSdkService)
  private readonly zone = inject(NgZone)

  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading')
  protected readonly errorMessage = signal('')

  private view: EdpireEmbedInstance | null = null
  private destroyed = false
  /** Guards against a slow response for attempt 1 landing after attempt 2 was picked. */
  private generation = 0

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true
      this.view?.unmount()
      this.view = null
    })

    // Switching attempts re-renders the paper. Cheap: nothing is being answered.
    effect(() => {
      void this.render(this.submissionId(), this.contentMaxWidth())
    })
  }

  private async render(submissionId: string, maxWidth: string | undefined): Promise<void> {
    const generation = ++this.generation
    this.view?.unmount()
    this.view = null
    this.status.set('loading')

    try {
      const [review, sdk] = await Promise.all([this.api.review(submissionId), this.sdk.load()])
      if (this.destroyed || generation !== this.generation) return

      // Pass the payload through untouched. The player owns its shape.
      this.view = sdk.EdpireAssessment.review({
        review,
        container: this.hostEl().nativeElement,
        layout: maxWidth ? { maxWidth } : undefined,
      })
      this.status.set('ready')
      this.zone.run(() => this.loaded.emit(review.submission))
    } catch (err) {
      if (this.destroyed || generation !== this.generation) return
      this.status.set('error')
      this.errorMessage.set(describeError(err, 'Could not load this attempt.'))
    }
  }
}
