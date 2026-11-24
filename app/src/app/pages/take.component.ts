import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import { EdpireApiService } from '../edpire/edpire-api.service'
import { EdpireAssessmentComponent } from '../edpire/edpire-assessment.component'
import type { EdpireEmbedResult } from '../edpire/edpire-sdk.types'

/**
 * Taking an assessment, first time or retry. They are the same thing: every
 * token mints a fresh attempt, and Edpire numbers it and enforces the
 * assessment's attempt limit. There is no "retry" API to call.
 *
 * When the learner submits, two things happen and it is worth being precise
 * about which is which:
 *
 *   - the player turns into the corrected paper, in place. So this screen does
 *     NOT navigate away; the learner reads their corrections right here.
 *   - this screen tells your backend "attempt X finished", with only the ID.
 *     Your backend reads the score from Edpire and stores it, so the card is
 *     already correct when the learner clicks back.
 *
 * The "All attempts" link waits for that second call. Offer it straight away
 * and a quick learner lands on a history that does not have this attempt yet:
 * your table is only as fresh as the last write to it.
 *
 * If that call fails (network blip, tab closed), nothing is lost: the
 * `submission.graded` webhook records the same attempt on the server, and the
 * write is idempotent on the submission ID.
 */
@Component({
  selector: 'app-take',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EdpireAssessmentComponent],
  template: `
    <header class="bar">
      <a routerLink="/" class="back">&larr; My assessments</a>
      @if (result(); as r) {
        <span class="done">
          @if (r.awaiting_manual_grading || r.ai_pending) {
            Submitted. Some answers are still being marked.
          } @else if (r.score_hidden) {
            Submitted.
          } @else {
            Submitted: {{ r.score }} / {{ r.max_score }} ({{ r.percentage }}%)
          }
        </span>
        @if (recorded()) {
          <a class="btn btn--ghost" [routerLink]="['/assessments', id()]" [queryParams]="{ attempt: r.submission_id }">
            All attempts
          </a>
        }
      }
    </header>

    <edpire-assessment class="player" [assessmentId]="id()" (completed)="onCompleted($event)" />
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 100vh; }
    .bar { display: flex; align-items: center; gap: 1rem; padding: .75rem 1.5rem; border-bottom: 1px solid #e5e7eb; flex: none; }
    .back { color: #6b7280; text-decoration: none; font-size: .875rem; }
    .back:hover { color: #111827; }
    .done { margin-inline-start: auto; font-size: .875rem; font-weight: 600; }
    .btn { border-radius: .5rem; padding: .375rem .75rem; font-size: .8125rem; text-decoration: none; }
    .btn--ghost { color: #dc2626; box-shadow: inset 0 0 0 1px #dc2626; }
    /* The player grows with the paper and the page scrolls: no fixed height here. */
    .player { flex: 1; }
  `,
})
export class TakeComponent {
  /** `:id` route parameter: the Edpire assessment ID. */
  readonly id = input.required<string>()

  private readonly api = inject(EdpireApiService)
  protected readonly result = signal<EdpireEmbedResult | null>(null)
  protected readonly recorded = signal(false)

  protected onCompleted(result: EdpireEmbedResult): void {
    this.result.set(result)
    this.api
      .recordAttempt(result.submission_id)
      // Offer the history either way: on failure the webhook is on its way,
      // and the corrected paper is already on screen.
      .catch(() => undefined)
      .finally(() => this.recorded.set(true))
  }
}
