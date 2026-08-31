import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import { EdpireAssessmentComponent } from '../edpire/edpire-assessment.component'
import type { EdpireEmbedResult } from '../edpire/edpire-sdk.types'

/**
 * Exam Hall: the whole paper, drawn by Edpire.
 *
 * The integration is the single <edpire-assessment> tag below. Everything else
 * on this screen is your product's chrome.
 *
 * Note what does NOT happen on `completed`: this screen does not navigate away.
 * When the learner submits, the player rewrites itself into the corrected paper
 * -- score banner, per-question marks, the answer key on anything they missed.
 * Routing away on the callback throws that away and is the most common mistake
 * in a first integration. Record the result, show a thin bar, leave the
 * corrections on screen.
 */
@Component({
  selector: 'app-exam-hall',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EdpireAssessmentComponent],
  template: `
    <header class="bar">
      <a routerLink="/" class="back">&larr; All assessments</a>
      @if (result(); as r) {
        <span class="score">
          {{ r.score }} / {{ r.max_score }} &middot; {{ r.percentage }}%
          @if (r.awaiting_manual_grading) {
            <em>(provisional -- open responses awaiting a teacher)</em>
          }
        </span>
      }
    </header>

    <edpire-assessment
      class="player"
      [assessmentId]="id()"
      (completed)="onCompleted($event)" />
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; }
    .bar { display: flex; align-items: center; gap: 1rem; padding: .75rem 1.5rem;
           border-bottom: 1px solid #e5e7eb; flex: none; }
    .back { color: #6b7280; text-decoration: none; font-size: .875rem; }
    .back:hover { color: #111827; }
    .score { margin-left: auto; font-size: .875rem; font-weight: 600; }
    .score em { font-weight: 400; color: #6b7280; font-style: normal; }
    /* The player fills what is left. Without a real height it collapses to zero. */
    .player { flex: 1; min-height: 0; }
  `,
})
export class ExamHallComponent {
  /** Bound from the `:id` route parameter by withComponentInputBinding(). */
  readonly id = input.required<string>()

  protected readonly result = signal<EdpireEmbedResult | null>(null)

  protected onCompleted(result: EdpireEmbedResult): void {
    // A UI hint, not the record of truth. This is a client callback and a
    // browser can be lied to. The authoritative result arrives server-side on
    // the `submission.graded` webhook -- and if the assessment has open
    // responses, the final one only on `submission.grading.completed`.
    this.result.set(result)
  }
}
