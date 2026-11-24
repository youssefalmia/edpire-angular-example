import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core'
import { DatePipe } from '@angular/common'
import { RouterLink } from '@angular/router'
import { EdpireApiService } from '../edpire/edpire-api.service'
import { describeError } from '../edpire/edpire-error'
import { EdpireReviewComponent } from '../edpire/edpire-review.component'
import { EdpireReviewStepsComponent } from '../edpire/edpire-review-steps.component'
import type { AttemptSummary, LibraryCard } from '../edpire/edpire-sdk.types'

/**
 * One assessment: its attempt history, the selected attempt as the corrected
 * paper, and Retry.
 *
 * The history (the tabs) comes from YOUR attempts table: it is a list of
 * numbers, and your backend already has them. The paper below comes from
 * Edpire, fetched only for the attempt being looked at, because it is large,
 * it is read one attempt at a time, and it can change when a teacher re-marks.
 * Those two sentences are the whole storage design.
 *
 * Two ways to look at an attempt, same data underneath:
 *   Whole paper    <edpire-review>        the SDK draws everything at once
 *   One at a time  <edpire-review-steps>  you draw one locked question per screen
 * Exam Hall attempts and Arcade attempts can be viewed either way.
 *
 * The selected attempt and the view live in the URL (?attempt=, ?view=), so
 * Back, reload and a shared link all land on the same screen.
 */
@Component({
  selector: 'app-attempts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, EdpireReviewComponent, EdpireReviewStepsComponent],
  template: `
    <header class="bar">
      <a routerLink="/" class="back">&larr; My assessments</a>
      <h1 class="title">{{ card()?.title ?? '' }}</h1>
      @if (card(); as c) {
        @if (c.canRetry) {
          <a class="btn" [routerLink]="['/assessments', c.id, 'take']">
            {{ c.state === 'new' ? 'Start' : 'Retry' }}
          </a>
          @if (c.attemptsLeft !== null) {
            <span class="left">{{ c.attemptsLeft }} left</span>
          }
        } @else {
          <span class="left">No attempts left</span>
        }
      }
    </header>

    @if (error()) {
      <p class="status status--error">{{ error() }}</p>
    } @else if (attempts().length === 0 && !loading()) {
      <p class="status">No attempts yet.</p>
    } @else {
      <nav class="tabs" aria-label="Attempts">
        @for (a of attempts(); track a.submissionId) {
          <a
            class="tab"
            [class.tab--active]="a.submissionId === selectedId()"
            [routerLink]="[]"
            [queryParams]="{ attempt: a.submissionId }"
            queryParamsHandling="merge"
            replaceUrl>
            <span class="tab-n">Attempt {{ a.attemptNumber }}</span>
            <span class="tab-s" [class.pass]="a.passed && a.isFullyGraded" [class.fail]="a.passed === false && a.isFullyGraded">
              {{ a.isFullyGraded ? a.percentage + '%' : 'pending' }}
            </span>
            <span class="tab-d">{{ a.submittedAt | date: 'd MMM, HH:mm' }}</span>
          </a>
        }
        <div class="views" role="group" aria-label="View">
          <a class="view" [class.view--on]="!oneAtATime()" [routerLink]="[]"
             [queryParams]="{ view: null }" queryParamsHandling="merge" replaceUrl>Whole paper</a>
          <a class="view" [class.view--on]="oneAtATime()" [routerLink]="[]"
             [queryParams]="{ view: 'steps' }" queryParamsHandling="merge" replaceUrl>One at a time</a>
        </div>
      </nav>

      @if (selectedId(); as id) {
        @if (oneAtATime()) {
          <div class="steps-wrap">
            <edpire-review-steps class="steps" [submissionId]="id" />
          </div>
        } @else {
          <edpire-review class="paper" [submissionId]="id" contentMaxWidth="none" />
        }
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 100vh; }
    .bar { display: flex; align-items: center; gap: 1rem; padding: .75rem 1.5rem; border-bottom: 1px solid #e5e7eb; flex: none; }
    .back { color: #6b7280; text-decoration: none; font-size: .875rem; white-space: nowrap; }
    .back:hover { color: #111827; }
    .title { font-size: 1rem; font-weight: 600; margin: 0; flex: 1; min-width: 0;
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn { background: #dc2626; color: #fff; border-radius: .5rem; padding: .5rem .875rem; font-size: .875rem; text-decoration: none; }
    .left { font-size: .8125rem; color: #6b7280; white-space: nowrap; }
    .tabs { display: flex; gap: .5rem; padding: .75rem 1.5rem; border-bottom: 1px solid #e5e7eb; overflow-x: auto; flex: none; }
    .tab { display: grid; grid-template-columns: auto auto; column-gap: .75rem; padding: .5rem .75rem; border-radius: .625rem;
           border: 1px solid #e5e7eb; color: #111827; text-decoration: none; white-space: nowrap; font-size: .8125rem; }
    .tab:hover { border-color: #9ca3af; }
    .tab--active { border-color: #dc2626; box-shadow: inset 0 0 0 1px #dc2626; }
    .tab-n { font-weight: 600; }
    .tab-s { text-align: end; font-variant-numeric: tabular-nums; font-weight: 600; color: #8a5a08; }
    .tab-s.pass { color: #1f8a4c; }
    .tab-s.fail { color: #b42318; }
    .tab-d { grid-column: 1 / -1; color: #6b7280; font-size: .75rem; }
    .views { margin-inline-start: auto; display: flex; align-self: center; border: 1px solid #e5e7eb;
             border-radius: .5rem; overflow: hidden; flex: none; }
    .view { padding: .375rem .75rem; font-size: .8125rem; color: #4b5563; text-decoration: none; white-space: nowrap; }
    .view--on { background: #111827; color: #fff; }
    .steps-wrap { flex: 1; }
    .steps { display: block; max-width: 44rem; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
    /* The paper grows with its questions and the page scrolls: no fixed height here. */
    .paper { flex: 1; }
    .status { padding: 2rem 1.5rem; color: #6b7280; }
    .status--error { color: #dc2626; }
  `,
})
export class AttemptsComponent {
  /** `:id` route parameter: the Edpire assessment ID. */
  readonly id = input.required<string>()
  /** `?attempt=` query parameter: the submission to show. Defaults to the latest. */
  readonly attempt = input<string | undefined>(undefined)
  /** `?view=steps`: one question per screen instead of the whole paper. */
  readonly view = input<string | undefined>(undefined)
  protected readonly oneAtATime = computed(() => this.view() === 'steps')

  private readonly api = inject(EdpireApiService)

  protected readonly card = signal<LibraryCard | null>(null)
  protected readonly attempts = signal<AttemptSummary[]>([])
  protected readonly loading = signal(true)
  protected readonly error = signal('')

  protected readonly selectedId = computed(() => {
    const wanted = this.attempt()
    const list = this.attempts()
    // Only ever render an attempt that is in this learner's own list. The
    // server checks ownership anyway; this just avoids asking for a 404.
    if (wanted && list.some((a) => a.submissionId === wanted)) return wanted
    return list[0]?.submissionId ?? null
  })

  constructor() {
    effect(() => {
      const id = this.id()
      this.loading.set(true)
      this.api
        .card(id)
        .then(({ card, attempts }) => {
          this.card.set(card)
          this.attempts.set(attempts)
        })
        .catch((err: unknown) => this.error.set(describeError(err, 'Could not load this assessment.')))
        .finally(() => this.loading.set(false))
    })
  }
}
