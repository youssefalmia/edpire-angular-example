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
 *
 * The width switch in the header is a demo, not a pattern to copy. Pick one
 * value in your own app and hard-code it. It is here because "there is white
 * space down both sides" is the first thing people notice, and seeing the two
 * side by side explains the cause faster than any paragraph can.
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

      <label class="width">
        Column
        <select [value]="width()" (change)="onWidth($event)">
          <option value="48rem">48rem (default reading measure)</option>
          <option value="none">none (fill the container)</option>
        </select>
      </label>
    </header>

    <!--
      Changing contentMaxWidth re-mounts the player, which is fine here because
      nothing has been answered yet. Do not wire it to a control a learner can
      reach mid-attempt: a re-mount discards their answers.
    -->
    <edpire-assessment
      class="player"
      [assessmentId]="id()"
      [contentMaxWidth]="width()"
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
    .width { margin-left: auto; display: flex; align-items: center; gap: .5rem;
             font-size: .8125rem; color: #6b7280; }
    .score + .width { margin-left: 0; }
    .width select { font: inherit; padding: .25rem .5rem; border: 1px solid #e5e7eb;
                    border-radius: .375rem; background: #fff; color: #111827; }
    /* The player fills what is left. Without a real height it collapses to zero. */
    .player { flex: 1; min-height: 0; }
  `,
})
export class ExamHallComponent {
  /** Bound from the `:id` route parameter by withComponentInputBinding(). */
  readonly id = input.required<string>()

  protected readonly result = signal<EdpireEmbedResult | null>(null)

  /** Demo only -- see the class comment. Hard-code one value in a real app. */
  protected readonly width = signal<string>('48rem')

  protected onWidth(event: Event): void {
    this.width.set((event.target as HTMLSelectElement).value)
  }

  protected onCompleted(result: EdpireEmbedResult): void {
    // A UI hint, not the record of truth. This is a client callback and a
    // browser can be lied to. The authoritative result arrives server-side on
    // the `submission.graded` webhook -- and if the assessment has open
    // responses, the final one only on `submission.grading.completed`.
    this.result.set(result)
  }
}
